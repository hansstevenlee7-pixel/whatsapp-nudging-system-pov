"use strict";

const crypto = require("node:crypto");
const { sendJson, method, jsonBody, apiError, httpError } = require("./http");
const { requireUser } = require("./auth");
const { requireWorker } = require("./internal-auth");
const { allPatients, loadClinicalData, batchWrite, operation } = require("./clinical-data");
const { assertPatientAccess } = require("./policy");
const { validateEnvelope, selectPool, behaviourKey, decide } = require("./adaptive-core");
const store = require("./adaptive-store");
const { discover } = require("./media-discovery");
const { processInteraction } = require("./adaptive-service");
const { sendMessage } = require("./twilio");

function origin(req) {
  const configured = String(process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
  return `${proto}://${host}`;
}

async function plan(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    if (!store.configured()) throw httpError(503, "Adaptive media database is not configured");
    const { profile } = await requireUser(req);
    const url = new URL(req.url, "https://portal.invalid");
    const body = req.method === "POST" ? await jsonBody(req) : {};
    const userId = String(body.user_id || url.searchParams.get("user_id") || "").trim();
    assertPatientAccess(profile, await allPatients(), userId);
    if (req.method === "GET") return sendJson(res, 200, await store.call("plansForUser", userId));
    const key = String(body.behaviour_key || "").trim();
    if (!key) throw httpError(400, "behaviour_key is required");
    const candidates = selectPool(await store.call("candidates", key));
    if (!candidates.length) throw httpError(409, "Media search has not produced an approvable pool yet");
    const result = await store.call("approvePlan", { userId, behaviourKey: key, profileId: profile.auth_user_id,
      envelope: validateEnvelope(body.envelope || {}), candidates });
    return sendJson(res, 200, { status: "approved", pool: result.assets, envelope: result.envelope });
  } catch (error) { return apiError(res, error); }
}

function candidateRow(candidate) {
  return { behaviour_key: candidate.behaviour_key, media_kind: candidate.media_kind, title: candidate.title,
    source_name: candidate.source_name, source_url: candidate.source_url, source_id: candidate.source_id || null,
    published_at: candidate.published_at || null, open_access: Boolean(candidate.open_access), short_summary: candidate.short_summary || "",
    detailed_summary: candidate.detailed_summary || "", limitations: candidate.limitations || "", ranking_score: candidate.ranking_score || 0,
    ranking_reasons: candidate.ranking_reasons || [], metadata: candidate.metadata || {} };
}

async function mediaWorker(req, res) {
  if (!method(req, res, ["POST"])) return;
  let job;
  try {
    requireWorker(req); job = await store.call("pendingSearch");
    if (!job) return sendJson(res, 200, { status: "idle" });
    await store.call("updateSearch", job.job_id, { status: "processing", attempts: Number(job.attempts || 0) + 1, updated_at: new Date().toISOString() });
    const result = await discover(job);
    await store.call("saveCandidates", result.all.map(candidateRow));
    await store.call("updateSearch", job.job_id, { status: "complete", error_message: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    return sendJson(res, 200, { status: "complete", job_id: job.job_id, candidates: result.all.length, proposed_pool: result.pool.length });
  } catch (error) {
    if (job) await store.call("updateSearch", job.job_id, { status: "failed", error_message: String(error.message || error).slice(0, 500), updated_at: new Date().toISOString() }).catch(() => {});
    return apiError(res, error);
  }
}

async function adaptationWorker(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    requireWorker(req);
    const event = await store.call("pendingInteraction");
    if (!event) return sendJson(res, 200, { status: "idle" });
    const decision = await processInteraction(event);
    if (decision && decision.outcome === "applied" && event.event_type === "inbound_reply" && event.raw_payload && event.raw_payload.from) {
      await sendMessage({ to: event.raw_payload.from, body: "Got it — your request will be used for future messages within your approved plan." });
    }
    return sendJson(res, 200, { status: "complete", interaction_id: event.interaction_id, decision });
  } catch (error) { return apiError(res, error); }
}

async function prepareDelivery(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    requireWorker(req);
    const body = await jsonBody(req); const nudgeId = String(body.nudge_id || "").trim();
    if (!nudgeId) throw httpError(400, "nudge_id is required");
    const data = await loadClinicalData(["nudges", "media_assignments", "adaptation_decisions"]);
    const nudge = data.nudges.rows.find(row => String(row.nudge_id) === nudgeId);
    if (!nudge) throw httpError(404, "nudge not found");
    if (nudge.media_asset_id && nudge.adaptation_decision_id) {
      return sendJson(res, 200, { adapted: true, idempotent: true, nudge_id: nudgeId, message_body: nudge.message_body,
        media_asset_id: nudge.media_asset_id, adaptation_decision_id: nudge.adaptation_decision_id });
    }
    const key = behaviourKey(nudge); const envelope = await store.call("envelopeFor", nudge.user_id, key);
    if (!envelope) return sendJson(res, 200, { adapted: false, nudge_id: nudgeId, message_body: nudge.message_body, reason: "no_approved_envelope" });
    const assets = await store.call("assetsFor", key, envelope.approved_asset_ids || []);
    const state = await store.call("adaptationState", nudge.user_id, key);
    const decision = decide({ event_type: "scheduled_selection", state, envelope, assets });
    if (!decision.selected_asset) return sendJson(res, 200, { adapted: false, nudge_id: nudgeId, message_body: nudge.message_body, reason: "no_approved_asset" });
    const saved = await store.call("saveSelectionDecision", { user_id: nudge.user_id, behaviour_key: key }, decision);
    const asset = decision.selected_asset;
    const tracked = await store.call("createTrackedLink", { asset_id: asset.asset_id, user_id: nudge.user_id, behaviour_key: key, nudge_id: nudgeId, target_url: asset.source_url });
    const trackedUrl = `${origin(req)}/api/r/${tracked.token}`;
    const summary = (decision.next_state.preferred_summary_length || "short") === "detailed" ? asset.detailed_summary : asset.short_summary;
    const messageBody = [nudge.message_body, [summary, `${asset.title} — ${asset.source_name}`, trackedUrl].filter(Boolean).join("\n")].filter(Boolean).join("\n\n").slice(0, 1500);
    const assignmentId = "ma_" + crypto.createHash("sha256").update(`${nudgeId}|${asset.asset_id}`).digest("hex").slice(0, 24);
    const now = new Date().toISOString();
    await batchWrite([
      operation("nudges", data.nudges, Object.assign({}, nudge, { message_body: messageBody, media_asset_id: asset.asset_id, adaptation_decision_id: saved.decision_id }), nudge),
      operation("media_assignments", data.media_assignments, { assignment_id: assignmentId, assigned_at: now, user_id: nudge.user_id, nudge_id: nudgeId,
        behaviour_key: key, media_asset_id: asset.asset_id, adaptation_decision_id: saved.decision_id, media_kind: asset.media_kind,
        source_url: asset.source_url, tracked_url: trackedUrl }),
      operation("adaptation_decisions", data.adaptation_decisions, { decision_id: saved.decision_id, decided_at: saved.decided_at || now, user_id: nudge.user_id,
        behaviour_key: key, interaction_id: "", signal_type: "scheduled_selection", rule_applied: decision.rule, outcome: decision.outcome,
        reason: decision.reason, selected_asset_id: asset.asset_id, interpretation: JSON.stringify(decision.interpretation || {}),
        previous_state: JSON.stringify(decision.previous_state || {}), next_state: JSON.stringify(decision.next_state || {}) })
    ]);
    return sendJson(res, 200, { adapted: true, nudge_id: nudgeId, message_body: messageBody, media_asset_id: asset.asset_id,
      adaptation_decision_id: saved.decision_id, tracked_url: trackedUrl, media_kind: asset.media_kind });
  } catch (error) { return apiError(res, error); }
}

async function link(req, res) {
  if (req.method !== "GET") { res.statusCode = 405; res.setHeader("allow", "GET"); return res.end(); }
  try {
    const url = new URL(req.url, "https://portal.invalid");
    const token = String(url.searchParams.get("token") || req.query && req.query.token || "").trim();
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) { res.statusCode = 404; return res.end("Not found"); }
    const now = new Date().toISOString(); const tracked = await store.call("visitLink", token, now);
    if (!tracked || !/^https:\/\//.test(String(tracked.target_url || ""))) { res.statusCode = 404; return res.end("Link expired or unavailable"); }
    const interactionId = "click_" + crypto.createHash("sha256").update(`${token}|${tracked.visit_count}`).digest("hex").slice(0, 24);
    await store.call("recordInteraction", { interaction_id: interactionId, event_at: now, event_type: "link_visit", user_id: tracked.user_id,
      behaviour_key: tracked.behaviour_key, nudge_id: tracked.nudge_id || null, asset_id: tracked.asset_id,
      correlation_method: "tracked_link", raw_payload: { visit_count: tracked.visit_count } });
    res.statusCode = 302; res.setHeader("location", tracked.target_url); res.setHeader("cache-control", "no-store"); return res.end();
  } catch (_) { res.statusCode = 500; return res.end("Link temporarily unavailable"); }
}

module.exports = { plan, mediaWorker, adaptationWorker, prepareDelivery, link };
