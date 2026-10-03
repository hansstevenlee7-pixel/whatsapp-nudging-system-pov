"use strict";

const crypto = require("node:crypto");
const { sendJson, method, jsonBody, apiError, httpError } = require("./http");
const { requireUser } = require("./auth");
const { requireWorker } = require("./internal-auth");
const { allPatients, loadClinicalData, batchWrite, operation } = require("./clinical-data");
const { assertPatientAccess } = require("./policy");
const { defaultEnvelope, validateEnvelope, validateSummary, selectPool, behaviourKey, decide } = require("./adaptive-core");
const store = require("./adaptive-store");
const { discover } = require("./media-discovery");
const { processInteraction, queuePatientBehaviours } = require("./adaptive-service");
const { sendMessage } = require("./twilio");
const { buildPatientDictionary } = require("./patient-dictionary");
const { exportPatientDictionary } = require("./patient-dictionary-export");
const { evaluateAdaptive, policyRows } = require("./frequency-shadow");
const { applyAdaptiveSchedule } = require("./schedule-store");

function origin(req) {
  const configured = String(process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
  return `${proto}://${host}`;
}

const RESERVED_DELIVERY_STATES = new Set(["sending", "accepted", "queued", "sent", "delivered", "read"]);

function adaptiveApplyEnabled(envelope) {
  if (String(process.env.ADAPTIVE_SCHEDULE_APPLY_ENABLED || "false") !== "true") return false;
  return envelope && envelope.automatic_schedule_apply === true;
}

function policyStateUpdate(result, row, now) {
  if (!row || row.outcome !== "applied") return null;
  const next = row.next_state || {}; const previous = result.state || {};
  return {
    user_id: row.user_id, behaviour_key: row.behaviour_key,
    preferred_format: next.preferred_format || null,
    preferred_summary_length: previous.preferred_summary_length || null,
    preferred_tone: previous.preferred_tone || null,
    preferred_time: next.preferred_time || null,
    preferred_frequency: Number(next.preferred_frequency) || null,
    preferred_action: previous.preferred_action || null,
    format_scores: previous.format_scores || {},
    last_asset_id: previous.last_asset_id || null,
    asset_history: previous.asset_history || [],
    media_selection_mode: previous.media_selection_mode || null,
    state_version: Math.max(0, Number(previous.state_version) || 0) + 1,
    last_signal_at: now, updated_at: now
  };
}

function reserveDelivery(data, state, now, attemptId) {
  return operation("schedule_state", data.schedule_state, Object.assign({}, state, {
    status: "sending", delivery_attempt_id: attemptId, submission_started_at: now, last_updated: now
  }), state);
}

function manualCandidate(body, behaviourKeyValue, profileId) {
  const kind = String(body.media_kind || "").trim();
  const title = String(body.title || "").trim();
  const sourceName = String(body.source_name || "").trim();
  const sourceUrl = String(body.source_url || "").trim();
  if (!["video", "paper", "reading"].includes(kind)) throw httpError(400, "media_kind is invalid");
  if (!title || title.length > 180) throw httpError(400, "title is required and must be 180 characters or fewer");
  if (!sourceName || sourceName.length > 120) throw httpError(400, "source_name is required and must be 120 characters or fewer");
  let parsed;
  try { parsed = new URL(sourceUrl); } catch (_) { throw httpError(400, "source_url must be a valid HTTPS URL"); }
  if (parsed.protocol !== "https:") throw httpError(400, "source_url must be a valid HTTPS URL");
  const summary = validateSummary({ source_title: title, original_url: sourceUrl,
    short_summary: body.short_summary, detailed_summary: body.detailed_summary, limitations: body.limitations });
  return candidateRow({ behaviour_key: behaviourKeyValue, media_kind: kind, title, source_name: sourceName,
    source_url: sourceUrl, source_id: null, open_access: kind === "paper" ? Boolean(body.open_access) : false,
    short_summary: summary.short_summary, detailed_summary: summary.detailed_summary, limitations: summary.limitations,
    ranking_score: 100, ranking_reasons: ["clinician_added"], metadata: { entry_mode: "manual", added_by: profileId } });
}

async function plan(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  try {
    if (!store.configured()) throw httpError(503, "Adaptive media database is not configured");
    const { profile } = await requireUser(req);
    const url = new URL(req.url, "https://portal.invalid");
    const body = req.method === "POST" ? await jsonBody(req) : {};
    const userId = String(body.user_id || url.searchParams.get("user_id") || "").trim();
    const patient = assertPatientAccess(profile, await allPatients(), userId);
    if (req.method === "POST" && body.operation === "populate") {
      const slots = (patient.weekly_schedule && patient.weekly_schedule.length ? patient.weekly_schedule : patient.nudges || [])
        .filter(slot => String(slot.status || "approved") !== "rejected");
      if (!slots.length) throw httpError(409, "Approve at least one intake behaviour before populating media");
      const jobs = await queuePatientBehaviours(userId, slots, patient.prescriptions || []);
      return sendJson(res, 200, { status: "queued", user_id: userId, jobs: jobs.map(job => ({ job_id: job.job_id, behaviour_key: job.behaviour_key, status: job.status })) });
    }
    if (req.method === "POST" && body.operation === "manual_resource") {
      let key = String(body.behaviour_key || "").trim();
      const plan = await store.call("plansForUser", userId);
      let envelope = (plan.envelopes || []).find(item => String(item.behaviour_key) === key);
      if (!envelope && body.source_nudge_id) {
        const sourceId = String(body.source_nudge_id).trim();
        const slot = [].concat(patient.weekly_schedule || [], patient.nudges || [])
          .find(item => String(item.source_nudge_id || item.nudge_id) === sourceId);
        if (!slot) throw httpError(404, "The scheduled behaviour was not found for this patient");
        const prescription = (patient.prescriptions || []).find(item => String(item.prescription_id) === String(slot.prescription_id)) || {};
        const input = Object.assign({}, slot, { category: slot.category || prescription.category,
          frequency_per_week: Number(prescription.frequency_per_week) || 1 });
        const derivedKey = behaviourKey(input);
        if (key && key !== derivedKey) throw httpError(400, "behaviour_key does not match the scheduled behaviour");
        key = derivedKey;
        envelope = await store.call("saveDraftEnvelope", Object.assign(defaultEnvelope(input), {
          user_id: userId, behaviour_key: key, status: "draft", updated_at: new Date().toISOString()
        }));
      }
      if (!key || !envelope) {
        throw httpError(404, "The media plan was not found for this patient");
      }
      const saved = await store.call("saveCandidates", [manualCandidate(body, key, profile.auth_user_id)]);
      return sendJson(res, 200, { status: "saved", candidate: saved[0] || null, duplicate_merged: !saved.length });
    }
    if (req.method === "GET") {
      const data = await store.call("plansForUser", userId);
      data.proposed_pools = Object.fromEntries((data.envelopes || []).map(item => [item.behaviour_key,
        selectPool((data.candidates || []).filter(candidate => candidate.behaviour_key === item.behaviour_key))]));
      return sendJson(res, 200, data);
    }
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
    if (event.user_id) {
      try {
        const [patients, adaptive] = await Promise.all([allPatients(), store.call("plansForUser", event.user_id)]);
        const patient = patients.find(item => String(item.user_id) === String(event.user_id));
        if (patient) await exportPatientDictionary(buildPatientDictionary({ patient, adaptive }));
      } catch (error) { console.error("patient dictionary export failed", error); }
    }
    if (decision && decision.outcome === "applied" && event.event_type === "inbound_reply" && event.raw_payload && event.raw_payload.from) {
      await sendMessage({ to: event.raw_payload.from, body: "Got it — your request will be used for future messages within your approved plan." });
    }
    return sendJson(res, 200, { status: "complete", interaction_id: event.interaction_id, decision });
  } catch (error) { return apiError(res, error); }
}

async function frequencyWorker(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    requireWorker(req);
    const body = await jsonBody(req); const requestedUser = String(body.user_id || "").trim();
    const patients = await allPatients();
    for (const patient of patients) {
      if (requestedUser && String(patient.user_id) !== requestedUser) continue;
      if (String(patient.user_status || "active") !== "active") continue;
      const adaptive = await store.call("plansForUser", patient.user_id);
      for (const envelope of (adaptive.envelopes || []).filter(item => item.status === "approved")) {
        const mode = adaptiveApplyEnabled(envelope) ? "apply" : "shadow";
        const result = evaluateAdaptive({ patient, adaptive, envelope, behaviour_key: envelope.behaviour_key, now: body.now, mode });
        if (result.status !== "evaluated") continue;
        const duplicate = (adaptive.decisions || []).some(decision => {
          let interpretation = decision.interpretation || {};
          if (typeof interpretation === "string") {
            try { interpretation = JSON.parse(interpretation); } catch (_) { interpretation = {}; }
          }
          return String(decision.signal_type || "").startsWith("adaptive_policy_") && interpretation.evaluation_key === result.evaluation_key;
        });
        if (duplicate) continue;
        let schedule = { applied: false, reason: mode === "apply" ? "schedule_already_matches_policy" : "shadow_mode" };
        // Assigned before the schedule write so changed slots can name this policy decision.
        const policyDecisionId = crypto.randomUUID();
        if (mode === "apply" && (result.recommended_frequency !== result.current_frequency ||
            result.time_recommendation.recommended_time && result.time_recommendation.recommended_time !== result.current_time)) {
          schedule = await applyAdaptiveSchedule({ user_id: patient.user_id, behaviour_key: envelope.behaviour_key,
            target_frequency: result.recommended_frequency, target_time: result.time_recommendation.recommended_time,
            adaptation_decision_id: policyDecisionId, now: body.now || new Date().toISOString() });
        }
        const now = body.now || new Date().toISOString();
        const decisions = policyRows({ user_id: patient.user_id, result, mode, schedule_applied: schedule.applied, now, policy_decision_id: policyDecisionId });
        const stateUpdate = policyStateUpdate(result, decisions[1], now);
        const saved = await store.call("savePolicyEvaluation", decisions, stateUpdate);
        try {
          const [refreshedPatient, refreshedAdaptive] = await Promise.all([
            allPatients().then(items => items.find(item => String(item.user_id) === String(patient.user_id)) || patient),
            store.call("plansForUser", patient.user_id)
          ]);
          await exportPatientDictionary(buildPatientDictionary({ patient: refreshedPatient, adaptive: refreshedAdaptive }));
        } catch (error) { console.error("adaptive policy dictionary export failed", error); }
        return sendJson(res, 200, { status: "complete", user_id: patient.user_id, mode, result, schedule,
          decision_ids: saved.map(row => row.decision_id) });
      }
    }
    return sendJson(res, 200, { status: "idle" });
  } catch (error) { return apiError(res, error); }
}

async function prepareDelivery(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    requireWorker(req);
    const body = await jsonBody(req); const nudgeId = String(body.nudge_id || "").trim();
    if (!nudgeId) throw httpError(400, "nudge_id is required");
    const data = await loadClinicalData(["user", "questionnaire", "nudges", "weekly_schedule", "schedule_state", "media_assignments", "adaptation_decisions"]);
    const nudge = data.nudges.rows.find(row => String(row.nudge_id) === nudgeId);
    if (!nudge) throw httpError(404, "nudge not found");
    if (String(nudge.status) !== "approved" || nudge.sent_at) throw httpError(409, "nudge is not eligible for delivery");
    const user = data.user.rows.find(row => String(row.user_id) === String(nudge.user_id));
    const questionnaire = data.questionnaire.rows.find(row => String(row.user_id) === String(nudge.user_id));
    const optedIn = questionnaire && [true, 1, "1", "true", "TRUE", "yes", "YES"].includes(questionnaire.opt_in_whatsapp);
    if (!user || String(user.user_status || "active") !== "active") throw httpError(409, "patient is not active");
    if (!optedIn) throw httpError(409, "WhatsApp consent is missing or inactive");
    const stateRow = data.schedule_state.rows.find(row => String(row.nudge_id) === nudgeId);
    if (!stateRow) throw httpError(409, "delivery state is missing");
    if (RESERVED_DELIVERY_STATES.has(String(stateRow.status || "")) || stateRow.wa_message_id || stateRow.sent_at) {
      throw httpError(409, "delivery is already reserved or submitted");
    }
    const now = new Date().toISOString(); const attemptId = `att_${crypto.randomUUID()}`;
    const mode = String(nudge.media_selection_mode || "automatic");
    const key = behaviourKey(nudge);
    const plannedFrequency = data.weekly_schedule.rows.filter(row => String(row.user_id) === String(nudge.user_id) && String(row.status || "active") === "active" && (() => {
      try { return behaviourKey(row) === key; } catch (_) { return false; }
    })()).length;
    const scheduledAt = nudge.scheduled_date ? `${nudge.scheduled_date}T${nudge.scheduled_time || "00:00"}:00` : "";
    if (mode === "text_only") {
      const state = await store.call("adaptationState", nudge.user_id, key);
      const decision = { outcome: "no_change", rule: "clinician_text_only", reason: "Clinician selected text only for this recurring nudge",
        interpretation: { explicit: true, format: "text" }, previous_state: Object.assign({}, state, { media_selection_mode: "text_only" }),
        next_state: Object.assign({}, state, { media_selection_mode: "text_only" }),
        scores_before: state.format_scores || {}, scores_after: state.format_scores || {}, selected_asset: null };
      const saved = await store.call("saveSelectionDecision", { user_id: nudge.user_id, behaviour_key: key }, decision);
      await batchWrite([
        operation("nudges", data.nudges, Object.assign({}, nudge, { adaptation_decision_id: saved.decision_id }), nudge),
        operation("adaptation_decisions", data.adaptation_decisions, { decision_id: saved.decision_id, decided_at: saved.decided_at || now,
          user_id: nudge.user_id, behaviour_key: key, interaction_id: "", signal_type: "scheduled_selection", rule_applied: decision.rule,
          outcome: decision.outcome, reason: decision.reason, selected_asset_id: "", interpretation: JSON.stringify(decision.interpretation),
          previous_state: JSON.stringify(state), next_state: JSON.stringify(state), scope: "behaviour", decision_source: "system",
          effective_at: saved.effective_at || now, state_version: saved.state_version || 0, changed_fields: JSON.stringify([]),
          frequency_before: state.preferred_frequency || "", frequency_after: state.preferred_frequency || "", media_mode_before: mode,
          media_mode_after: "text_only", media_kind_before: state.preferred_format || "", media_kind_after: "", nudge_id: nudgeId }),
        reserveDelivery(data, stateRow, now, attemptId)
      ]);
      return sendJson(res, 200, { adapted: false, prepared: true, nudge_id: nudgeId, message_body: nudge.message_body,
        media_asset_id: "", adaptation_decision_id: saved.decision_id, delivery_attempt_id: attemptId, reason: "clinician_text_only" });
    }
    const envelope = await store.call("envelopeFor", nudge.user_id, key);
    if (!envelope) {
      await batchWrite([reserveDelivery(data, stateRow, now, attemptId)]);
      return sendJson(res, 200, { adapted: false, prepared: true, nudge_id: nudgeId, message_body: nudge.message_body,
        delivery_attempt_id: attemptId, reason: "no_approved_envelope" });
    }
    const assets = await store.call("assetsFor", key, envelope.approved_asset_ids || []);
    const state = await store.call("adaptationState", nudge.user_id, key);
    const override = mode === "clinician_selected"
      ? assets.find(asset => String(asset.asset_id) === String(nudge.media_override_asset_id || "")) : null;
    if (mode === "clinician_selected" && !override) {
      return sendJson(res, 409, { error: "clinician media override is no longer in the approved pool" });
    }
    const decision = override ? { outcome: "applied", rule: "clinician_media_override", reason: "Clinician selected this approved resource",
      interpretation: { explicit: true, format: override.media_kind }, previous_state: state, next_state: state,
      scores_before: state.format_scores || {}, scores_after: state.format_scores || {}, selected_asset: override }
      : decide({ event_type: "scheduled_selection", state, envelope, assets });
    decision.previous_state = Object.assign({}, decision.previous_state || state, { media_selection_mode: mode });
    decision.next_state = Object.assign({}, decision.next_state || state, { media_selection_mode: mode });
    if (!decision.selected_asset) {
      await batchWrite([reserveDelivery(data, stateRow, now, attemptId)]);
      return sendJson(res, 200, { adapted: false, prepared: true, nudge_id: nudgeId, message_body: nudge.message_body,
        delivery_attempt_id: attemptId, reason: "no_approved_asset" });
    }
    const saved = await store.call("saveSelectionDecision", { user_id: nudge.user_id, behaviour_key: key }, decision);
    const asset = decision.selected_asset;
    const targetUrl = asset.storage_path ? await store.call("signedDownloadUrl", asset.storage_path) : asset.source_url;
    const tracked = await store.call("createTrackedLink", { asset_id: asset.asset_id, user_id: nudge.user_id, behaviour_key: key, nudge_id: nudgeId, target_url: targetUrl });
    const trackedUrl = `${origin(req)}/api/r/${tracked.token}`;
    const summary = (decision.next_state.preferred_summary_length || "short") === "detailed" ? asset.detailed_summary : asset.short_summary;
    const tail = [`${asset.title} — ${asset.source_name}`, trackedUrl].filter(Boolean).join("\n");
    const lead = [nudge.message_body, summary].filter(Boolean).join("\n\n");
    const messageBody = [lead.slice(0, Math.max(0, 900 - tail.length - 2)).trim(), tail].filter(Boolean).join("\n\n");
    const assignmentId = "ma_" + crypto.createHash("sha256").update(`${nudgeId}|${asset.asset_id}`).digest("hex").slice(0, 24);
    await batchWrite([
      operation("nudges", data.nudges, Object.assign({}, nudge, { message_body: messageBody, media_asset_id: asset.asset_id, adaptation_decision_id: saved.decision_id }), nudge),
      operation("media_assignments", data.media_assignments, { assignment_id: assignmentId, assigned_at: now, user_id: nudge.user_id, nudge_id: nudgeId,
        behaviour_key: key, media_asset_id: asset.asset_id, adaptation_decision_id: saved.decision_id, media_kind: asset.media_kind,
        selection_mode: mode, source_url: asset.source_url, tracked_url: trackedUrl, planned_frequency: plannedFrequency,
        scheduled_at: scheduledAt, sent_at: "", delivered_at: "", read_at: "", visited_at: "", replied_at: "",
        send_to_read_hours: "", send_to_visit_hours: "", send_to_reply_hours: "" }),
      operation("adaptation_decisions", data.adaptation_decisions, { decision_id: saved.decision_id, decided_at: saved.decided_at || now, user_id: nudge.user_id,
        behaviour_key: key, interaction_id: "", signal_type: "scheduled_selection", rule_applied: decision.rule, outcome: decision.outcome,
        reason: decision.reason, selected_asset_id: asset.asset_id, interpretation: JSON.stringify(decision.interpretation || {}),
        previous_state: JSON.stringify(decision.previous_state || {}), next_state: JSON.stringify(decision.next_state || {}),
        scope: "behaviour", decision_source: "system", effective_at: saved.effective_at || now, state_version: saved.state_version || 0,
        changed_fields: JSON.stringify(saved.changed_fields || []), frequency_before: saved.frequency_before || "", frequency_after: saved.frequency_after || "",
        media_mode_before: saved.media_mode_before || mode, media_mode_after: saved.media_mode_after || mode,
        media_kind_before: saved.media_kind_before || "", media_kind_after: saved.media_kind_after || asset.media_kind, nudge_id: nudgeId }),
      reserveDelivery(data, stateRow, now, attemptId)
    ]);
    return sendJson(res, 200, { adapted: true, nudge_id: nudgeId, message_body: messageBody, media_asset_id: asset.asset_id,
      adaptation_decision_id: saved.decision_id, tracked_url: trackedUrl, media_kind: asset.media_kind, delivery_attempt_id: attemptId });
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

module.exports = { plan, mediaWorker, adaptationWorker, frequencyWorker, prepareDelivery, link };
