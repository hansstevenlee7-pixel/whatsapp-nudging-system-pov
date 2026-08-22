"use strict";

// The outcome-follow-up scheduler, ported from Workflow F.
//
// Runs every five minutes. Two jobs: send outcome checks whose followup_due_at
// has passed, and close commitment/outcome windows that expired unanswered.
//
// Writes ONLY schedule_state. The delayed check is a feedback event, never a
// clinician-approved nudge, so it must not create a `nudges` row — that would put
// a message in the plan the clinician never approved.

const { operation } = require("./google-sheets");
const {
  melbourneTimestamp, followupEligible, commitmentExpired, outcomeExpired,
  FOLLOWUP_OUTCOME_WINDOW_HOURS
} = require("./followup");

const PHONE_RE = /^\+[1-9]\d{7,14}$/;

function text(value) {
  return String(value == null ? "" : value).trim();
}

// One pass, three mutually exclusive jobs, so a row can never be both sent to and
// expired in the same tick.
function planWork({ states, users, nudges, now, outcomeWindowHours }) {
  const nowIso = now || melbourneTimestamp();
  const windowHours = Number(outcomeWindowHours) || FOLLOWUP_OUTCOME_WINDOW_HOURS;
  const userById = new Map((users || []).map(user => [text(user.user_id), user]));
  const nudgeById = new Map((nudges || []).map(nudge => [text(nudge.nudge_id), nudge]));
  const jobs = [];

  for (const state of states || []) {
    const nudgeId = text(state.nudge_id);
    if (!nudgeId) continue;
    const status = text(state.status);

    // Stage 1 expired. Deliberately reuses followup_due_at rather than a second
    // window: if the patient has not committed by the time the check would have
    // gone out, there is nothing left to check on.
    if (status === "awaiting_commitment" && !text(state.commitment_response)) {
      if (commitmentExpired(state, nowIso)) {
        jobs.push({ job: "expire_commitment", nudge_id: nudgeId, state });
      }
      continue;
    }

    if (status !== "awaiting_followup") continue;

    // Stage 2 already sent: either still open, or expired unanswered.
    if (text(state.followup_sent_at) || text(state.followup_wa_id)) {
      if (!text(state.outcome_response) && outcomeExpired(state, nowIso, windowHours)) {
        jobs.push({ job: "expire_outcome", nudge_id: nudgeId, state });
      }
      continue;
    }

    // Stage 2 not yet sent. followup_sent_at / followup_wa_id above are the claim
    // check that makes a duplicate execution a no-op.
    if (!followupEligible(state, nowIso)) continue;

    const user = userById.get(text(state.user_id));
    if (!user || text(user.user_status) !== "active") continue;
    const phone = text(user.phone);
    if (!PHONE_RE.test(phone)) continue;

    const nudge = nudgeById.get(nudgeId) || {};
    const action = text(nudge.action_text);
    // Without an action there is nothing to ask about, and the template needs it.
    if (!action) continue;

    jobs.push({
      job: "send",
      nudge_id: nudgeId,
      state,
      schedule_id: text(state.schedule_id) || `sch_${nudgeId}`,
      user_id: text(state.user_id),
      // Self-anchoring: the outcome check is a feedback event on the delivery it
      // follows, not a new nudge, so it reuses the parent rather than minting an id.
      parent_nudge_id: text(state.parent_nudge_id) || nudgeId,
      recipient_phone: phone,
      recipient_name: text(user.name) || "there",
      action_text: action,
      followup_due_at: text(state.followup_due_at)
    });
  }
  return jobs;
}

// The expiries write NO_FEEDBACK to the column matching the stage that closed.
// Never NOT_YET: a window nobody answered is a different observation from a
// patient saying they did not manage it.
function expiryOperations({ jobs, stateTable, now }) {
  const stamp = now || melbourneTimestamp();
  return jobs
    .filter(job => job.job === "expire_commitment" || job.job === "expire_outcome")
    .map(job => {
      const changes = job.job === "expire_commitment"
        ? { status: "no_feedback", commitment_response: "NO_FEEDBACK", followup_due_at: "" }
        : { status: "no_feedback", outcome_response: "NO_FEEDBACK" };
      return operation("schedule_state", stateTable,
        Object.assign({}, job.state, changes, { last_updated: stamp }), job.state);
    });
}

// Claims the send. Written only after Twilio has accepted the message, so a
// failed send leaves the row eligible for the next tick rather than silently
// swallowing the check.
function sentOperation({ job, stateTable, messageSid, now }) {
  const stamp = now || melbourneTimestamp();
  return operation("schedule_state", stateTable, Object.assign({}, job.state, {
    followup_sent_at: stamp,
    followup_wa_id: text(messageSid),
    last_updated: stamp
  }), job.state);
}

module.exports = { planWork, expiryOperations, sentOperation, PHONE_RE };
