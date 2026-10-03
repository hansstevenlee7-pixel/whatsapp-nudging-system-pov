"use strict";

const { behaviourKey } = require("./adaptive-core");

const DELIVERED = new Set(["delivered", "read"]);
const SENT = new Set(["accepted", "queued", "sending", "sent", "delivered", "read"]);
const MEDIA_MODES = new Set(["automatic", "text_only", "clinician_selected"]);
const INTERACTIONS = new Set(["link_visit", "inbound_reply"]);

function text(value) { return String(value == null ? "" : value).trim(); }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function json(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return value ? JSON.parse(String(value)) : fallback; } catch (_) { return fallback; }
}
function dateOnly(value) { return text(value).slice(0, 10); }
function parseDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function isoDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}
function monday(value) {
  const parsed = value instanceof Date ? new Date(value) : new Date(`${dateOnly(value)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCDate(parsed.getUTCDate() - (parsed.getUTCDay() + 6) % 7);
  return isoDate(parsed);
}
function addDays(value, days) {
  const parsed = new Date(`${dateOnly(value)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoDate(parsed);
}
function inDateRange(value, from, to) {
  const date = dateOnly(value);
  return (!from || date >= from) && (!to || date <= to);
}
function weekFor(value) { return monday(value); }
function weeksBetween(from, to) {
  const result = [];
  if (!from || !to) return result;
  let cursor = monday(from);
  const last = monday(to);
  while (cursor && cursor <= last && result.length < 106) {
    result.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return result;
}
function localTimestamp(date, time) {
  const day = dateOnly(date);
  const clock = /^([01]\d|2[0-3]):[0-5]\d$/.test(text(time)) ? text(time) : "00:00";
  return day ? `${day}T${clock}:00` : "";
}
function firstTimestamp(values) {
  return values.map(value => text(value)).filter(Boolean).sort()[0] || "";
}
function latestTimestamp(values) {
  return values.map(value => text(value)).filter(Boolean).sort().pop() || "";
}
function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}
function latencyHours(start, end) {
  const a = parseDate(start); const b = parseDate(end);
  if (a == null || b == null || b < a) return null;
  return Math.round(((b - a) / 3600000) * 100) / 100;
}
function safeBehaviourKey(row) {
  if (text(row && row.behaviour_key)) return text(row.behaviour_key);
  try { return behaviourKey(row || {}); } catch (_) {
    const fallback = [row && row.action_text, row && row.pillar, row && row.category].map(text).join("|");
    return fallback === "||" ? "unknown" : `legacy:${fallback}`;
  }
}
function modeFor(row, slot) {
  const mode = text(row && row.media_selection_mode) || text(slot && slot.media_selection_mode) || "automatic";
  return MEDIA_MODES.has(mode) ? mode : "automatic";
}
function statusFor(state, row) { return text(state && state.status) || text(row && row.status) || "scheduled"; }
function assetKind(asset) { return asset && text(asset.media_kind) || null; }

function normaliseState(state) {
  const value = Object.assign({}, state || {});
  value.format_scores = json(value.format_scores, {});
  value.asset_history = Array.isArray(value.asset_history) ? value.asset_history.slice() : json(value.asset_history, []);
  if (!Array.isArray(value.asset_history)) value.asset_history = [];
  return value;
}

function makeOccurrence(row, slot, state, deliveryEvents, interactions, assetsById) {
  const relatedDelivery = deliveryEvents.filter(event => String(event.nudge_id || "") === String(row.nudge_id || "") ||
    (state && state.wa_message_id && String(event.wa_message_id || "") === String(state.wa_message_id)));
  const relatedInteractions = interactions.filter(event => String(event.nudge_id || "") === String(row.nudge_id || ""));
  const latestStatus = relatedDelivery.slice().sort((a, b) => text(a.event_at).localeCompare(text(b.event_at))).pop();
  const status = statusFor(state, Object.assign({}, slot, row, latestStatus && { status: latestStatus.status }));
  const sentAt = text(state && state.sent_at) || text(row.sent_at) || text(relatedDelivery.find(event => text(event.status) === "sent") && relatedDelivery.find(event => text(event.status) === "sent").event_at);
  const deliveredAt = text(state && state.delivered_at) || text(relatedDelivery.find(event => DELIVERED.has(text(event.status))) && relatedDelivery.find(event => DELIVERED.has(text(event.status))).event_at);
  const readAt = text(state && state.read_at) || text(relatedDelivery.find(event => text(event.status) === "read") && relatedDelivery.find(event => text(event.status) === "read").event_at);
  const visitedAt = firstTimestamp(relatedInteractions.filter(event => text(event.event_type) === "link_visit").map(event => event.event_at));
  const repliedAt = firstTimestamp(relatedInteractions.filter(event => text(event.event_type) === "inbound_reply").map(event => event.event_at));
  const assetId = text(row.media_asset_id) || text(slot && slot.media_asset_id);
  const asset = assetId ? assetsById.get(assetId) : null;
  const scheduledDate = dateOnly(row.scheduled_date) || dateOnly(slot && slot.scheduled_date);
  const scheduledTime = text(row.scheduled_time) || text(slot && slot.scheduled_time) || "09:00";
  const mode = modeFor(row, slot);
  return {
    nudge_id: text(row.nudge_id), schedule_slot_id: text(row.schedule_slot_id) || text(slot && slot.schedule_slot_id),
    behaviour_key: safeBehaviourKey(Object.assign({}, slot || {}, row)),
    scheduled_date: scheduledDate, scheduled_time: scheduledTime,
    scheduled_at: localTimestamp(scheduledDate, scheduledTime), status,
    sent_at: sentAt || null, delivered_at: deliveredAt || null, read_at: readAt || null,
    read_status: readAt || status === "read" ? "read" : "unknown", visited_at: visitedAt || null, replied_at: repliedAt || null,
    interacted_at: firstTimestamp([visitedAt, repliedAt]),
    media_selection_mode: mode, media_asset_id: assetId || null, media_kind: mode === "text_only" ? null : assetKind(asset),
    source_url: asset && text(asset.source_url) || null, media_title: asset && text(asset.title) || null,
    send_to_delivery_hours: latencyHours(sentAt, deliveredAt), send_to_read_hours: latencyHours(sentAt, readAt),
    send_to_visit_hours: latencyHours(sentAt, visitedAt), send_to_reply_hours: latencyHours(sentAt, repliedAt),
    delivery_events: relatedDelivery, interactions: relatedInteractions
  };
}

function scheduleRowsFor(patient) {
  const canonical = (patient.weekly_schedule || []).filter(row => text(row.status || "active") === "active");
  if (canonical.length) return canonical;
  return (patient.nudges || []).filter(row => !String(row.nudge_id || "").startsWith("schd_") && text(row.status) !== "rejected");
}

function passiveEvidence(rows, now) {
  const nowMs = parseDate(now); const delivered = (rows || []).filter(row => row.delivered_at || DELIVERED.has(row.status));
  const closed = delivered.filter(row => parseDate(row.delivered_at) != null && nowMs != null && parseDate(row.delivered_at) + 86400000 <= nowMs);
  const latest = delivered.slice().sort((a, b) => text(b.delivered_at).localeCompare(text(a.delivered_at))).slice(0, 5).map(row => ({
    nudge_id: row.nudge_id, delivered_at: row.delivered_at, read_at: row.read_at, visited_at: row.visited_at, replied_at: row.replied_at,
    read_status: row.read_at ? "read" : "unknown", media_kind: row.media_kind, scheduled_time: row.scheduled_time,
    send_to_read_hours: row.send_to_read_hours, send_to_visit_hours: row.send_to_visit_hours, send_to_reply_hours: row.send_to_reply_hours,
    outcome_24h: parseDate(row.delivered_at) + 86400000 > nowMs ? "window_open" : row.visited_at || row.replied_at ? "ordinary_interaction" : "no_observable_interaction"
  }));
  return {
    delivered_count: delivered.length, read_count: delivered.filter(row => row.read_at).length,
    read_unknown_count: delivered.filter(row => !row.read_at).length,
    visit_count: delivered.filter(row => row.visited_at).length, reply_count: delivered.filter(row => row.replied_at).length,
    no_observable_interaction_count: closed.filter(row => !row.visited_at && !row.replied_at).length,
    open_24h_count: delivered.length - closed.length,
    median_send_to_read_hours: median(delivered.map(row => row.send_to_read_hours)),
    median_send_to_visit_hours: median(delivered.map(row => row.send_to_visit_hours)),
    median_send_to_reply_hours: median(delivered.map(row => row.send_to_reply_hours)), latest
  };
}

function buildPatientDictionary(input = {}) {
  const patient = input.patient || {};
  const adaptive = input.adaptive || {};
  const now = input.now || new Date().toISOString();
  const requestedFrom = dateOnly(input.from);
  const requestedTo = dateOnly(input.to);
  const currentWeek = monday(now);
  const from = requestedFrom || currentWeek;
  const to = requestedTo || addDays(currentWeek, 6);
  const assets = (adaptive.assets || []).concat(adaptive.historical_assets || [], adaptive.candidates || []);
  const assetsById = new Map(assets.filter(asset => asset && asset.asset_id).map(asset => [String(asset.asset_id), asset]));
  const states = new Map((adaptive.states || []).filter(state => state && state.behaviour_key).map(state => [String(state.behaviour_key), normaliseState(state)]));
  const globalState = normaliseState(adaptive.global_state || {});
  const scheduleRows = scheduleRowsFor(patient);
  const hasCanonicalSchedule = (patient.weekly_schedule || []).some(row => text(row.status || "active") === "active");
  const sourceById = new Map((patient.nudges || []).map(row => [String(row.nudge_id), row]));
  const slotById = new Map(scheduleRows.map(row => [String(row.schedule_slot_id || row.nudge_id), row]));
  const statesByNudge = new Map((patient.schedule_state || []).map(row => [String(row.nudge_id), row]));
  const deliveryEvents = patient.delivery_events || [];
  const interactions = [];
  const seenInteractions = new Set();
  for (const event of (patient.interaction_events || []).concat(adaptive.events || [])) {
    const id = text(event.interaction_id || event.event_id) || `${event.event_type}:${event.event_at}:${event.nudge_id}`;
    if (seenInteractions.has(id)) continue;
    seenInteractions.add(id); interactions.push(event);
  }
  const datedRows = (patient.schedule_nudges || []).filter(row => dateOnly(row.scheduled_date));
  const occurrenceRows = datedRows.length ? datedRows : (patient.nudges || []).filter(row => dateOnly(row.scheduled_date));
  const occurrences = occurrenceRows.map(row => {
    const slot = slotById.get(String(row.schedule_slot_id || "")) || sourceById.get(String(row.source_nudge_id || "")) || {};
    return makeOccurrence(row, slot, statesByNudge.get(String(row.nudge_id)), deliveryEvents, interactions, assetsById);
  }).filter(row => row.behaviour_key && row.scheduled_date);

  const keys = new Set(scheduleRows.concat(occurrences).map(row => safeBehaviourKey(row)).filter(key => key !== "unknown"));
  for (const key of states.keys()) keys.add(key);
  const decisions = (adaptive.decisions || []).slice().sort((a, b) => text(a.decided_at).localeCompare(text(b.decided_at)));
  const timeline = [];
  for (const decision of decisions) {
    const previous = json(decision.previous_state, {}); const next = json(decision.next_state, {});
    const selected = decision.selected_asset_id && assetsById.get(String(decision.selected_asset_id));
    timeline.push({
      id: text(decision.decision_id), at: text(decision.effective_at || decision.decided_at), event_type: "adaptation_decision",
      source: text(decision.decision_source) || (text(decision.signal_type) === "scheduled_selection" ? "system" : "patient"),
      scope: text(decision.scope) || (text(decision.behaviour_key) ? "behaviour" : "global"), behaviour_key: text(decision.behaviour_key) || null,
      signal: text(decision.signal_type), interpretation: json(decision.interpretation, {}), rule: text(decision.rule_applied),
      outcome: text(decision.outcome), reason: text(decision.reason), previous_state: previous, new_state: next,
      changed_fields: json(decision.changed_fields, []), state_version: number(decision.state_version),
      selected_asset_id: text(decision.selected_asset_id) || null, selected_media_kind: assetKind(selected), interaction_id: text(decision.interaction_id) || null,
      nudge_id: text(decision.nudge_id) || null
    });
  }
  for (const event of interactions) {
    if (!INTERACTIONS.has(text(event.event_type))) continue;
    timeline.push({ id: text(event.interaction_id), at: text(event.event_at), event_type: text(event.event_type), source: "patient",
      scope: text(event.behaviour_key) ? "behaviour" : "global", behaviour_key: text(event.behaviour_key) || null,
      signal: text(event.event_type), interpretation: {}, rule: "pending_or_observed", outcome: "observed", reason: "Interaction evidence only",
      previous_state: {}, new_state: {}, changed_fields: [], state_version: null, selected_asset_id: text(event.asset_id) || null,
      selected_media_kind: assetKind(event.asset_id && assetsById.get(String(event.asset_id))), interaction_id: text(event.interaction_id) || null,
      nudge_id: text(event.nudge_id) || null });
  }
  for (const event of deliveryEvents) {
    timeline.push({ id: text(event.event_id), at: text(event.event_at), event_type: "delivery_status", source: "provider",
      scope: "behaviour", behaviour_key: null, signal: text(event.status), interpretation: {}, rule: "exposure_only", outcome: "observed",
      reason: "Provider exposure evidence only", previous_state: {}, new_state: {}, changed_fields: [], state_version: null,
      selected_asset_id: null, selected_media_kind: null, interaction_id: text(event.event_id) || null, nudge_id: text(event.nudge_id) || null });
  }
  timeline.sort((a, b) => text(a.at).localeCompare(text(b.at)) || text(a.id).localeCompare(text(b.id)));

  function weekSummary(key, filterKey) {
    const weekEnd = addDays(key, 6);
    const planned = hasCanonicalSchedule ? scheduleRows.filter(row => {
      const rowKey = safeBehaviourKey(row); if (filterKey && rowKey !== filterKey) return false;
      return text(row.status || "active") === "active" && (!row.start_date || dateOnly(row.start_date) <= weekEnd) && (!row.end_date || dateOnly(row.end_date) >= key);
    }).length : 0;
    const datedPlanned = occurrenceRows.filter(row => dateOnly(row.scheduled_date) >= key && dateOnly(row.scheduled_date) <= weekEnd && (!filterKey || safeBehaviourKey(row) === filterKey)).length;
    const relevant = occurrences.filter(row => weekFor(row.scheduled_date) === key && (!filterKey || row.behaviour_key === filterKey));
    const actual = relevant.filter(row => row.sent_at || SENT.has(row.status));
    const delivered = relevant.filter(row => row.delivered_at || DELIVERED.has(row.status));
    const read = relevant.filter(row => row.read_at);
    const visits = interactions.filter(event => text(event.event_type) === "link_visit" && dateOnly(event.event_at) >= key && dateOnly(event.event_at) <= weekEnd && (!filterKey || String(event.behaviour_key || "") === filterKey)).length;
    const replies = interactions.filter(event => text(event.event_type) === "inbound_reply" && dateOnly(event.event_at) >= key && dateOnly(event.event_at) <= weekEnd && (!filterKey || String(event.behaviour_key || "") === filterKey)).length;
    const weekDecisions = decisions.filter(decision => dateOnly(decision.effective_at || decision.decided_at) >= key && dateOnly(decision.effective_at || decision.decided_at) <= weekEnd && (!filterKey || String(decision.behaviour_key || "") === filterKey));
    const requested = weekDecisions.slice().reverse().map(decision => number(json(decision.next_state, {}).preferred_frequency)).find(value => value != null) || null;
    const mediaMix = {}; const modeMix = {};
    for (const row of relevant) { if (row.media_kind) mediaMix[row.media_kind] = (mediaMix[row.media_kind] || 0) + 1; modeMix[row.media_selection_mode] = (modeMix[row.media_selection_mode] || 0) + 1; }
    return { week_start: key, week_end: weekEnd, frequency: {
      planned_frequency: planned || datedPlanned, delivered_frequency: delivered.length, requested_frequency: requested,
      observed_frequency: visits + replies, sent_count: actual.length, read_count: read.length
    }, media: { kinds: mediaMix, selection_modes: modeMix }, interaction_count: visits + replies, visit_count: visits, reply_count: replies };
  }

  const weekKeys = new Set(weeksBetween(from, to));
  for (const occurrence of occurrences) if (inDateRange(occurrence.scheduled_date, from, to)) weekKeys.add(weekFor(occurrence.scheduled_date));
  const weekly = Array.from(weekKeys).sort().map(key => weekSummary(key));
  const behaviourEntries = Array.from(keys).sort().map(key => {
    const state = states.get(key) || {};
    const effective = Object.assign({}, globalState, state);
    const behaviourWeeks = Array.from(weekKeys).sort().map(week => weekSummary(week, key));
    const last = timeline.slice().reverse().find(item => item.behaviour_key === key);
    const latestOccurrence = occurrences.filter(item => item.behaviour_key === key).sort((a, b) => text(b.scheduled_at).localeCompare(text(a.scheduled_at)))[0] || null;
    const behaviourOccurrences = occurrences.filter(item => item.behaviour_key === key).sort((a, b) => text(a.scheduled_at).localeCompare(text(b.scheduled_at)));
    return { behaviour_key: key, current_state: state, effective_state: effective, frequency: {
      requested_frequency: number(state.preferred_frequency) || number(globalState.preferred_frequency),
      planned_frequency: behaviourWeeks.reduce((sum, item) => sum + Number(item.frequency.planned_frequency || 0), 0),
      delivered_frequency: behaviourWeeks.reduce((sum, item) => sum + Number(item.frequency.delivered_frequency || 0), 0),
      observed_frequency: behaviourWeeks.reduce((sum, item) => sum + Number(item.frequency.observed_frequency || 0), 0)
    }, media: { preference: effective.preferred_format || "automatic", summary_length: effective.preferred_summary_length || null,
      last_asset_id: state.last_asset_id || null, last_media_kind: latestOccurrence && latestOccurrence.media_kind || null },
      last_change_at: last && last.at || null, latest_occurrence: latestOccurrence,
      passive_evidence: passiveEvidence(behaviourOccurrences, now), occurrences: behaviourOccurrences, weekly: behaviourWeeks };
  });
  const current = weekly.find(item => item.week_start === currentWeek) || weekSummary(currentWeek);
  const timelineOutput = (requestedFrom || requestedTo) ? timeline.filter(item => inDateRange(item.at, from, to)) : timeline;
  const preferences = behaviourEntries.map(item => item.media.preference).filter(Boolean);
  const uniquePreferences = Array.from(new Set(preferences));
  const latestChange = timeline.slice().reverse().find(item => item.event_type === "adaptation_decision") || null;
  const latestFrequencyDecision = decisions.slice().reverse().find(item => text(item.signal_type) === "frequency_policy_shadow" || text(item.signal_type).startsWith("adaptive_policy_")) || null;
  const frequencyInterpretation = latestFrequencyDecision ? json(latestFrequencyDecision.interpretation, {}) : {};
  const aggregateEvidence = passiveEvidence(occurrences, now);
  const latestPolicyState = latestFrequencyDecision ? { mode: text(frequencyInterpretation.mode) || (text(latestFrequencyDecision.signal_type).endsWith("shadow") ? "shadow" : "apply"),
    outcome: text(latestFrequencyDecision.outcome), changed_fields: json(latestFrequencyDecision.changed_fields, []),
    previous_state: json(latestFrequencyDecision.previous_state, {}), next_state: json(latestFrequencyDecision.next_state, {}),
    reason: text(latestFrequencyDecision.reason), evaluated_at: text(latestFrequencyDecision.effective_at || latestFrequencyDecision.decided_at),
    time_recommendation: frequencyInterpretation.time_recommendation || null,
    media_recommendation: frequencyInterpretation.media_recommendation || null } : null;
  return {
    patient: { user_id: text(patient.user_id), name: text(patient.name), user_status: text(patient.user_status) || "active", timezone: "Australia/Melbourne" },
    summary: { planned_frequency: current.frequency.planned_frequency, delivered_frequency: current.frequency.delivered_frequency,
      requested_frequency: current.frequency.requested_frequency, observed_frequency: current.frequency.observed_frequency,
      media_preference: uniquePreferences.length === 1 ? uniquePreferences[0] : uniquePreferences.length ? "mixed" : "automatic",
      frequency_model: latestFrequencyDecision ? { mode: text(frequencyInterpretation.mode) || "shadow", model_id: text(frequencyInterpretation.model_id),
        current_frequency: number(latestFrequencyDecision.frequency_before), recommended_frequency: number(frequencyInterpretation.recommended_frequency),
        direction: text(frequencyInterpretation.direction) || "hold", reason: text(frequencyInterpretation.policy_reason),
        evaluated_at: text(latestFrequencyDecision.effective_at || latestFrequencyDecision.decided_at) } : null,
      delivery_time: latestPolicyState && latestPolicyState.next_state.preferred_time || behaviourEntries.map(item => item.effective_state.preferred_time).filter(Boolean)[0] || null,
      passive_evidence: aggregateEvidence, latest_policy: latestPolicyState,
      latest_change_at: latestChange && latestChange.at || null, latest_change_reason: latestChange && latestChange.reason || null,
      read_status_note: "A missing read receipt is unknown, not unread." },
    global_state: globalState, behaviour_states: behaviourEntries, occurrences, weekly, timeline: timelineOutput,
    generated_at: now, range: { from, to }
  };
}

function stateExportRows(dictionary) {
  const rows = [];
  const patient = dictionary.patient || {};
  rows.push({ user_id: patient.user_id, scope: "global", behaviour_key: "", state_version: number(dictionary.global_state && dictionary.global_state.state_version) || "",
    preferred_format: dictionary.global_state && dictionary.global_state.preferred_format || "", preferred_frequency: dictionary.global_state && dictionary.global_state.preferred_frequency || "",
    updated_at: dictionary.global_state && dictionary.global_state.updated_at || dictionary.generated_at });
  for (const item of dictionary.behaviour_states || []) rows.push({ user_id: patient.user_id, scope: "behaviour", behaviour_key: item.behaviour_key,
    state_version: number(item.current_state && item.current_state.state_version) || "", preferred_format: item.effective_state.preferred_format || "",
    preferred_frequency: item.frequency.requested_frequency || "", planned_frequency: item.frequency.planned_frequency || 0,
    delivered_frequency: item.frequency.delivered_frequency || 0, observed_frequency: item.frequency.observed_frequency || 0,
    last_change_at: item.last_change_at || "", updated_at: item.current_state.updated_at || dictionary.generated_at });
  return rows;
}

function timelineExportRows(dictionary) {
  return (dictionary.timeline || []).map(item => ({ user_id: dictionary.patient && dictionary.patient.user_id || "", event_id: item.id,
    event_at: item.at, event_type: item.event_type, source: item.source, scope: item.scope, behaviour_key: item.behaviour_key || "",
    signal: item.signal, rule_applied: item.rule, outcome: item.outcome, reason: item.reason,
    previous_state: JSON.stringify(item.previous_state || {}), new_state: JSON.stringify(item.new_state || {}),
    changed_fields: JSON.stringify(item.changed_fields || []), selected_asset_id: item.selected_asset_id || "",
    selected_media_kind: item.selected_media_kind || "", nudge_id: item.nudge_id || "", interaction_id: item.interaction_id || "" }));
}

module.exports = { buildPatientDictionary, stateExportRows, timelineExportRows, latencyHours, weekFor, normaliseState };
