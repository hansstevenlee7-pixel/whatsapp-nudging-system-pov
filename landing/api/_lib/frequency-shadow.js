"use strict";

const model = require("../_models/frequency-logistic-v1.json");
const { behaviourKey } = require("./adaptive-core");
const { scoreFrequencies, recommendFrequency, recentHistory, ordinaryReply } = require("./frequency-model");
const { buildBehaviourEvidence, recommendTime, recommendMedia } = require("./behaviour-policy");

const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) { return String(value == null ? "" : value).trim(); }
function timestamp(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function sameBehaviour(row, key) { try { return behaviourKey(row) === key; } catch (_) { return false; } }

function confirmedOutcomes(patient, adaptive, key, now = new Date().toISOString()) {
  const cutoff = timestamp(now); if (cutoff == null) throw new Error("Frequency evaluation time is invalid");
  const deliveries = (patient.schedule_nudges || []).concat(patient.nudges || []);
  const nudgeById = new Map(deliveries.map(row => [text(row.nudge_id), row]));
  const events = (adaptive.events || []).filter(event => ["link_visit", "inbound_reply"].includes(text(event.event_type)));
  return (patient.schedule_state || []).map(state => {
    const nudge = nudgeById.get(text(state.nudge_id)); const deliveredAt = timestamp(state.delivered_at);
    if (!nudge || !sameBehaviour(nudge, key) || deliveredAt == null || deliveredAt + DAY_MS > cutoff) return null;
    if (!["delivered", "read"].includes(text(state.status)) && !state.delivered_at) return null;
    const positive = events.some(event => {
      if (text(event.nudge_id) !== text(state.nudge_id)) return false;
      const at = timestamp(event.event_at); if (at == null || at < deliveredAt || at > deliveredAt + DAY_MS) return false;
      return text(event.event_type) === "link_visit" || ordinaryReply(event.body);
    });
    return { nudge_id: text(state.nudge_id), delivered_at: new Date(deliveredAt).toISOString(), interacted_within_24h: positive ? 1 : 0 };
  }).filter(Boolean).sort((left, right) => left.delivered_at.localeCompare(right.delivered_at));
}

function currentFrequency(patient, key) {
  return (patient.weekly_schedule || []).filter(row => text(row.status || "active") === "active" && sameBehaviour(row, key)).length || 2;
}

function evaluateShadow(input = {}) {
  const key = text(input.behaviour_key); const outcomes = confirmedOutcomes(input.patient || {}, input.adaptive || {}, key, input.now);
  if (!outcomes.length) return { status: "insufficient_evidence", reason: "no_closed_24h_outcome", behaviour_key: key };
  const history = recentHistory(outcomes.map(row => row.interacted_within_24h));
  const current = currentFrequency(input.patient || {}, key);
  const envelope = input.envelope || {};
  const frequencyMin = Math.max(1, Math.min(3, Number(envelope.frequency_min) || 1));
  const frequencyMax = Math.max(frequencyMin, Math.min(3, Number(envelope.frequency_max) || 3));
  const modelInput = Object.assign({}, history, { current_frequency: current, frequency_min: frequencyMin, frequency_max: frequencyMax });
  const scores = scoreFrequencies(model, modelInput); const recommendation = recommendFrequency(scores, modelInput);
  const last = outcomes[outcomes.length - 1];
  return { status: "evaluated", mode: "shadow", model_id: model.model_id, behaviour_key: key,
    evaluation_key: `${model.model_id}:${key}:${last.nudge_id}:${last.delivered_at}`, current_frequency: current,
    closed_delivery_count: outcomes.length, recent_outcomes: outcomes.slice(-4), features: history,
    candidate_scores: scores, recommended_frequency: recommendation.recommended_frequency,
    direction: recommendation.direction, policy_reason: recommendation.reason, applied: false };
}

function parsed(value) {
  if (!value || typeof value === "object") return value || {};
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function latestState(adaptive, key) {
  return (adaptive.states || []).find(state => text(state.behaviour_key) === key) || {};
}

function patientExplicitValue(adaptive, key, field) {
  const decision = (adaptive.decisions || []).filter(item => text(item.behaviour_key) === key &&
    text(item.decision_source) === "patient" && text(item.outcome) === "applied")
    .find(item => {
      const changed = parsed(item.changed_fields);
      return Array.isArray(changed) && changed.includes(field);
    });
  return decision ? parsed(decision.next_state)[field] : null;
}

function recentAppliedFrequency(adaptive, key, now) {
  const cutoff = timestamp(now) - 7 * DAY_MS;
  return (adaptive.decisions || []).some(decision => text(decision.behaviour_key) === key &&
    text(decision.signal_type) === "adaptive_policy_applied" && Number(decision.frequency_before) !== Number(decision.frequency_after) &&
    timestamp(decision.effective_at || decision.decided_at) >= cutoff);
}

function evaluateAdaptive(input = {}) {
  const key = text(input.behaviour_key); const patient = input.patient || {}; const adaptive = input.adaptive || {};
  const now = input.now || new Date().toISOString(); const envelope = input.envelope || {};
  const evidence = buildBehaviourEvidence({ patient, adaptive, behaviour_key: key, now });
  if (!evidence.closed_records.length) return { status: "insufficient_evidence", reason: "no_closed_24h_outcome", behaviour_key: key };
  const current = currentFrequency(patient, key); const state = latestState(adaptive, key);
  const frequencyMin = Math.max(1, Math.min(3, Number(envelope.frequency_min) || 1));
  const frequencyMax = Math.max(frequencyMin, Math.min(3, Number(envelope.frequency_max) || 3));
  const modelInput = Object.assign({}, evidence.recent_history, { current_frequency: current, frequency_min: frequencyMin, frequency_max: frequencyMax });
  const scores = scoreFrequencies(model, modelInput); const modelRecommendation = recommendFrequency(scores, modelInput);
  const explicitFrequency = Number(state.preferred_frequency);
  const explicitInside = Number.isInteger(explicitFrequency) && explicitFrequency >= frequencyMin && explicitFrequency <= frequencyMax && explicitFrequency !== current;
  let recommended = explicitInside ? explicitFrequency : modelRecommendation.recommended_frequency;
  let frequencyReason = explicitInside ? "explicit_frequency_inside_approved_range" : modelRecommendation.reason;
  recommended = Math.max(current - 1, Math.min(current + 1, recommended));
  const recentPositiveCount = evidence.closed_records.slice(-4).reduce((sum, record) => sum + record.interacted_within_24h, 0);
  if (!explicitInside && recommended > current && recentPositiveCount < 2) {
    recommended = current; frequencyReason = "increase_blocked_without_two_recent_interactions";
  }
  if (!explicitInside && recommended < current && evidence.recent_history.noninteraction_streak < 2) {
    recommended = current; frequencyReason = "decrease_held_until_two_closed_noninteractions";
  }
  if (recommended !== current && recentAppliedFrequency(adaptive, key, now)) {
    recommended = current; frequencyReason = "weekly_frequency_step_already_used";
  }
  const rows = (patient.weekly_schedule || []).filter(row => text(row.status || "active") === "active" && sameBehaviour(row, key));
  const explicitTime = patientExplicitValue(adaptive, key, "preferred_time");
  const explicitFormat = patientExplicitValue(adaptive, key, "preferred_format");
  const time = recommendTime({ evidence, envelope, state: explicitTime ? { preferred_time: explicitTime } : {},
    current_times: rows.map(row => row.scheduled_time) });
  const media = recommendMedia({ evidence, envelope, state: { preferred_format: explicitFormat || null, format_scores: state.format_scores || {} } });
  const last = evidence.closed_records.at(-1);
  return {
    status: "evaluated", mode: input.mode || "shadow", model_id: model.model_id, behaviour_key: key,
    evaluation_key: `${model.model_id}:${key}:${last.nudge_id}:${last.delivered_at}`, current_frequency: current,
    closed_delivery_count: evidence.closed_records.length, recent_outcomes: evidence.closed_records.slice(-4), features: evidence.recent_history,
    candidate_scores: scores, model_recommended_frequency: modelRecommendation.recommended_frequency,
    recommended_frequency: recommended, direction: recommended > current ? "increase" : recommended < current ? "decrease" : "hold",
    policy_reason: frequencyReason, time_recommendation: time, media_recommendation: media, evidence,
    current_time: rows[0] && text(rows[0].scheduled_time) || null, current_media_format: text(state.preferred_format) || null,
    state, explicit_preferences: { preferred_time: explicitTime || null, preferred_format: explicitFormat || null }, applied: false
  };
}

function compactEvidence(evidence) {
  return { delivered_count: evidence.delivered_count, read_count: evidence.read_count, read_unknown_count: evidence.read_unknown_count,
    visit_count: evidence.visit_count, reply_count: evidence.reply_count, no_observable_interaction_count: evidence.no_observable_interaction_count,
    open_24h_count: evidence.open_24h_count, median_read_latency_minutes: evidence.median_read_latency_minutes,
    interaction_windows: evidence.interaction_windows, media_visits: evidence.media_visits };
}

function policyRows(input) {
  const now = input.now || new Date().toISOString(); const result = input.result; const mode = input.mode || result.mode || "shadow";
  const state = result.state || {}; const scheduleApplied = Boolean(input.schedule_applied);
  const next = Object.assign({}, state, {
    preferred_frequency: result.recommended_frequency,
    preferred_time: result.time_recommendation.recommended_time || state.preferred_time || null,
    preferred_format: result.media_recommendation.recommended_format || state.preferred_format || null
  });
  const changedFields = [];
  if (result.current_frequency !== result.recommended_frequency) changedFields.push("planned_frequency");
  if (result.time_recommendation.recommended_time && result.time_recommendation.recommended_time !== result.current_time) changedFields.push("preferred_time");
  if (result.media_recommendation.recommended_format && result.media_recommendation.recommended_format !== result.current_media_format) changedFields.push("preferred_format");
  const applied = mode === "apply" && (scheduleApplied || changedFields.includes("preferred_format"));
  const interpretation = { evaluation_key: result.evaluation_key, model_id: result.model_id, mode,
    closed_delivery_count: result.closed_delivery_count, recent_outcomes: result.recent_outcomes,
    features: result.features, candidate_scores: result.candidate_scores,
    model_recommended_frequency: result.model_recommended_frequency, recommended_frequency: result.recommended_frequency,
    direction: result.direction, policy_reason: result.policy_reason,
    time_recommendation: result.time_recommendation, media_recommendation: result.media_recommendation,
    passive_evidence: compactEvidence(result.evidence), schedule_applied: scheduleApplied };
  const previousState = Object.assign({}, state, { planned_frequency: result.current_frequency,
    preferred_time: result.current_time || state.preferred_time || null, preferred_format: result.current_media_format || null });
  const nextState = Object.assign({}, next, { planned_frequency: applied ? result.recommended_frequency : result.current_frequency });
  const shared = { decided_at: now, effective_at: now, user_id: input.user_id, behaviour_key: result.behaviour_key,
    interaction_id: null, nudge_id: result.recent_outcomes.at(-1).nudge_id, scope: "behaviour", decision_source: "system",
    media_mode_before: null, media_mode_after: null, media_kind_before: result.current_media_format,
    media_kind_after: applied ? next.preferred_format : result.current_media_format, selected_asset_id: null };
  return [
    Object.assign({}, shared, { signal_type: "frequency_model_recommendation", interpretation,
      scores_before: {}, scores_after: result.candidate_scores, rule_applied: "regularized_logistic_regression",
      previous_state: previousState, next_state: Object.assign({}, previousState, { planned_frequency: result.model_recommended_frequency }),
      changed_fields: result.model_recommended_frequency === result.current_frequency ? [] : ["planned_frequency"],
      frequency_before: result.current_frequency, frequency_after: result.model_recommended_frequency,
      outcome: "no_change", reason: `Model recommendation: ${result.model_recommended_frequency} per week`, fulfilled_at: null }),
    Object.assign({}, shared, input.policy_decision_id ? { decision_id: input.policy_decision_id } : {}, {
      signal_type: applied ? "adaptive_policy_applied" : mode === "apply" ? "adaptive_policy_no_change" : "adaptive_policy_shadow",
      interpretation, scores_before: result.candidate_scores, scores_after: result.candidate_scores,
      rule_applied: "bounded_frequency_time_media_policy", previous_state: previousState,
      next_state: applied ? nextState : previousState, changed_fields: applied ? changedFields : [],
      frequency_before: result.current_frequency, frequency_after: applied ? result.recommended_frequency : result.current_frequency,
      outcome: applied ? "applied" : "no_change",
      reason: applied ? `Applied future schedule: frequency ${result.current_frequency} to ${result.recommended_frequency}; time ${result.current_time || "unchanged"} to ${result.time_recommendation.recommended_time || "unchanged"}; media ${result.current_media_format || "automatic"} to ${result.media_recommendation.recommended_format || "automatic"}`
        : mode === "apply" ? "Policy evaluated; future schedule already matches or no bounded change was supported" : `Not applied in shadow mode: ${result.policy_reason}`,
      fulfilled_at: applied ? now : null })
  ];
}

function shadowRows(input) {
  const now = input.now || new Date().toISOString(); const result = input.result;
  const interpretation = { evaluation_key: result.evaluation_key, model_id: result.model_id, mode: "shadow",
    closed_delivery_count: result.closed_delivery_count, recent_outcomes: result.recent_outcomes, features: result.features,
    candidate_scores: result.candidate_scores, recommended_frequency: result.recommended_frequency,
    direction: result.direction, policy_reason: result.policy_reason };
  const shared = { decided_at: now, effective_at: now, user_id: input.user_id, behaviour_key: result.behaviour_key,
    interaction_id: null, nudge_id: result.recent_outcomes.at(-1).nudge_id, scope: "behaviour", decision_source: "system",
    previous_state: { planned_frequency: result.current_frequency }, next_state: { planned_frequency: result.current_frequency },
    changed_fields: [], frequency_before: result.current_frequency, frequency_after: result.current_frequency,
    media_mode_before: null, media_mode_after: null, media_kind_before: null, media_kind_after: null,
    selected_asset_id: null, outcome: "no_change", fulfilled_at: null };
  return [
    Object.assign({}, shared, { signal_type: "frequency_model_recommendation", interpretation,
      scores_before: {}, scores_after: result.candidate_scores, rule_applied: "regularized_logistic_regression",
      reason: `Shadow recommendation: ${result.direction} to ${result.recommended_frequency} per week` }),
    Object.assign({}, shared, { signal_type: "frequency_policy_shadow", interpretation,
      scores_before: result.candidate_scores, scores_after: result.candidate_scores, rule_applied: "bounded_frequency_shadow_policy",
      reason: `Not applied in shadow mode: ${result.policy_reason}` })
  ];
}

module.exports = { DAY_MS, confirmedOutcomes, currentFrequency, evaluateShadow, shadowRows, evaluateAdaptive, policyRows, compactEvidence };
