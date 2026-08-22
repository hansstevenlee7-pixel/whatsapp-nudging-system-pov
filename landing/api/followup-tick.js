"use strict";

// One pass of the outcome-follow-up scheduler. Replaces Workflow F's 16 nodes.
//
// Called every five minutes by a two-node n8n workflow (Schedule Trigger → HTTP
// Request). n8n stays the clock — Vercel's Hobby tier caps cron at once per day,
// and the two-stage window needs five-minute resolution — but all the logic lives
// here, where it is ordinary tested JS.
//
// Protected by a shared secret rather than a Supabase session: the caller is a
// machine, and there is no clinician to authenticate.

const crypto = require("node:crypto");
const { method, jsonBody, sendJson, apiError, httpError } = require("./_lib/http");
const { loadClinicalData, batchWrite } = require("./_lib/clinical-data");
const { sendMessage } = require("./_lib/twilio");
const { melbourneTimestamp } = require("./_lib/followup");
const { planWork, expiryOperations, sentOperation } = require("./_lib/followup-scheduler");

function text(value) {
  return String(value == null ? "" : value).trim();
}

function authorize(req) {
  const expected = text(process.env.FOLLOWUP_TICK_SECRET);
  if (!expected) throw httpError(500, "FOLLOWUP_TICK_SECRET is not configured");
  const supplied = text(req.headers["x-followup-secret"]);
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw httpError(401, "unauthorized");
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    authorize(req);

    const contentSid = text(process.env.TWILIO_OUTCOME_CONTENT_SID);
    // The clock is the real one unless the localhost harness explicitly opts in.
    // Walking a 4-hour delay by hand is the whole reason the harness exists, and
    // gating it on an env var no deployment sets keeps production unable to be
    // told what time it is by a caller.
    const body = await jsonBody(req).catch(() => ({}));
    const override = process.env.ALLOW_TICK_TIME_TRAVEL === "1" ? text(body.now) : "";
    const now = override || melbourneTimestamp();
    const data = await loadClinicalData(["user", "nudges", "schedule_state"]);

    const jobs = planWork({
      states: data.schedule_state.rows,
      users: data.user.rows,
      nudges: data.nudges.rows,
      now,
      outcomeWindowHours: process.env.FOLLOWUP_OUTCOME_WINDOW_HOURS
    });
    const sends = jobs.filter(job => job.job === "send");

    // Expiries first and in one batch: they touch no external service, so they
    // cannot half-apply, and a Twilio outage must not block closing stale windows.
    const operations = expiryOperations({ jobs, stateTable: data.schedule_state, now });

    const sent = [];
    const failed = [];
    for (const job of sends) {
      if (!/^HX[0-9a-fA-F]{32}$/.test(contentSid)) {
        failed.push({ nudge_id: job.nudge_id, error: "TWILIO_OUTCOME_CONTENT_SID is missing or invalid" });
        continue;
      }
      try {
        const result = await sendMessage({
          to: job.recipient_phone,
          contentSid,
          contentVariables: { 1: job.recipient_name, 2: job.action_text }
        });
        operations.push(sentOperation({ job, stateTable: data.schedule_state, messageSid: result.sid, now }));
        sent.push({ nudge_id: job.nudge_id, sid: result.sid });
      } catch (error) {
        // No claim is written, so this row stays eligible for the next tick.
        console.error("followup-tick send failed", job.nudge_id, error);
        failed.push({ nudge_id: job.nudge_id, error: String((error && error.message) || "send failed") });
      }
    }

    if (operations.length) await batchWrite(operations);

    // Returned so the n8n execution list still shows what a tick did, which is
    // the one thing the thin workflow gives up by not doing the work itself.
    return sendJson(res, 200, {
      status: "ok",
      now,
      considered: (data.schedule_state.rows || []).length,
      sent: sent.length,
      expired_commitment: jobs.filter(job => job.job === "expire_commitment").length,
      expired_outcome: jobs.filter(job => job.job === "expire_outcome").length,
      failed: failed.length,
      details: { sent, failed }
    });
  } catch (error) {
    return apiError(res, error);
  }
};
