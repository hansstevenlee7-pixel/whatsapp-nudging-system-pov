"use strict";

const { behaviourKey } = require("./adaptive-core");
const { ordinaryReply, recentHistory } = require("./frequency-model");

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = [
  { key: "morning", anchor: "09:00", order: 0 },
  { key: "afternoon", anchor: "13:00", order: 1 },
  { key: "evening", anchor: "18:30", order: 2 }
];

function text(value) { return String(value == null ? "" : value).trim(); }
function timestamp(value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; }
function minutesBetween(from, to) {
  const start = timestamp(from); const end = timestamp(to);
  return start == null || end == null || end < start ? null : Math.round((end - start) / 60000);
}
function sameBehaviour(row, key) { try { return behaviourKey(row) === key; } catch (_) { return false; } }
function earliest(events) {
  return (events || []).filter(event => timestamp(event.event_at) != null)
    .slice().sort((left, right) => timestamp(left.event_at) - timestamp(right.event_at))[0] || null;
}
function localClock(value) {
  const parsed = timestamp(value); if (parsed == null) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(parsed));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.hour}:${fields.minute}`;
}
function windowForClock(clock) {
  const hour = Number(text(clock).slice(0, 2));
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
function assetKindFor(nudge, events, assetsById) {
  const event = (events || []).find(item => item.asset_id && assetsById.has(text(item.asset_id)));
  const assetId = text(nudge && nudge.media_asset_id) || text(event && event.asset_id);
  const asset = assetsById.get(assetId);
  return asset && text(asset.media_kind) || null;
}

function buildBehaviourEvidence(input = {}) {
  const patient = input.patient || {}; const adaptive = input.adaptive || {}; const key = text(input.behaviour_key);
  const nowMs = timestamp(input.now || new Date().toISOString());
  if (nowMs == null) throw new Error("Behaviour evaluation time is invalid");
  const nudges = (patient.schedule_nudges || []).concat(patient.nudges || []);
  const nudgeById = new Map(nudges.map(row => [text(row.nudge_id), row]));
  const assets = (adaptive.assets || []).concat(adaptive.historical_assets || [], adaptive.candidates || []);
  const assetsById = new Map(assets.filter(asset => asset && asset.asset_id).map(asset => [text(asset.asset_id), asset]));
  const allEvents = adaptive.events || [];
  const records = (patient.schedule_state || []).map(state => {
    const nudge = nudgeById.get(text(state.nudge_id));
    const deliveredMs = timestamp(state.delivered_at);
    if (!nudge || !sameBehaviour(nudge, key) || deliveredMs == null) return null;
    if (!["delivered", "read"].includes(text(state.status)) && !state.delivered_at) return null;
    const related = allEvents.filter(event => text(event.nudge_id) === text(state.nudge_id));
    const visits = related.filter(event => text(event.event_type) === "link_visit");
    const replies = related.filter(event => text(event.event_type) === "inbound_reply" && ordinaryReply(event.body));
    const withinWindow = visits.concat(replies).filter(event => {
      const at = timestamp(event.event_at); return at != null && at >= deliveredMs && at <= deliveredMs + DAY_MS;
    });
    const firstVisit = earliest(visits); const firstReply = earliest(replies); const firstInteraction = earliest(withinWindow);
    const closed = deliveredMs + DAY_MS <= nowMs;
    return {
      nudge_id: text(state.nudge_id), delivered_at: new Date(deliveredMs).toISOString(), read_at: text(state.read_at) || null,
      scheduled_time: text(nudge.scheduled_time) || null, media_kind: assetKindFor(nudge, related, assetsById),
      first_visit_at: firstVisit && text(firstVisit.event_at) || null, first_reply_at: firstReply && text(firstReply.event_at) || null,
      first_interaction_at: firstInteraction && text(firstInteraction.event_at) || null,
      read_latency_minutes: minutesBetween(state.delivered_at, state.read_at),
      visit_latency_minutes: minutesBetween(state.delivered_at, firstVisit && firstVisit.event_at),
      reply_latency_minutes: minutesBetween(state.delivered_at, firstReply && firstReply.event_at),
      interaction_window: firstInteraction ? windowForClock(localClock(firstInteraction.event_at)) : null,
      link_visit_count: visits.length, ordinary_reply_count: replies.length, closed_24h: closed,
      interacted_within_24h: withinWindow.length ? 1 : 0,
      outcome: closed ? (withinWindow.length ? "ordinary_interaction" : "no_observable_interaction") : "window_open"
    };
  }).filter(Boolean).sort((left, right) => left.delivered_at.localeCompare(right.delivered_at));
  const closed = records.filter(record => record.closed_24h);
  const history = recentHistory(closed.map(record => record.interacted_within_24h));
  const mediaVisits = {};
  for (const record of records) if (record.media_kind && record.link_visit_count) {
    mediaVisits[record.media_kind] = (mediaVisits[record.media_kind] || 0) + record.link_visit_count;
  }
  const interactionWindows = {};
  for (const record of closed) if (record.interacted_within_24h && record.interaction_window) {
    interactionWindows[record.interaction_window] = (interactionWindows[record.interaction_window] || 0) + 1;
  }
  const readLatencies = records.map(record => record.read_latency_minutes).filter(Number.isFinite).sort((a, b) => a - b);
  const medianReadLatency = readLatencies.length ? readLatencies[Math.floor((readLatencies.length - 1) / 2)] : null;
  return {
    behaviour_key: key, records, closed_records: closed, recent_history: history, media_visits: mediaVisits,
    interaction_windows: interactionWindows, delivered_count: records.length,
    read_count: records.filter(record => record.read_at).length,
    read_unknown_count: records.filter(record => !record.read_at).length,
    visit_count: records.reduce((sum, record) => sum + record.link_visit_count, 0),
    reply_count: records.reduce((sum, record) => sum + record.ordinary_reply_count, 0),
    no_observable_interaction_count: closed.filter(record => !record.interacted_within_24h).length,
    open_24h_count: records.filter(record => !record.closed_24h).length,
    median_read_latency_minutes: medianReadLatency
  };
}

function allowedWindows(envelope = {}) {
  const earliest = text(envelope.earliest_time).slice(0, 5) || "00:00";
  const latest = text(envelope.latest_time).slice(0, 5) || "23:59";
  return WINDOWS.filter(item => item.anchor >= earliest && item.anchor <= latest);
}

function recommendTime(input = {}) {
  const evidence = input.evidence || {}; const envelope = input.envelope || {}; const state = input.state || {};
  const currentTimes = (input.current_times || []).map(value => text(value).slice(0, 5)).filter(Boolean);
  const current = currentTimes[0] || text(state.preferred_time).slice(0, 5) || null;
  const explicit = text(state.preferred_time).slice(0, 5);
  if (explicit && explicit >= text(envelope.earliest_time).slice(0, 5) && explicit <= text(envelope.latest_time).slice(0, 5)) {
    return { recommended_time: explicit, direction: explicit === current ? "hold" : "change", source: "explicit_request",
      reason: explicit === current ? "explicit_time_already_applied" : "explicit_time_inside_approved_window", evidence_count: 1 };
  }
  const options = allowedWindows(envelope);
  if (options.length < 2) return { recommended_time: current, direction: "hold", source: "policy", reason: "delivery_window_is_fixed", evidence_count: 0 };
  const ranked = Object.entries(evidence.interaction_windows || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  if (!ranked.length || Number(ranked[0][1]) < 2) return { recommended_time: current, direction: "hold", source: "policy",
    reason: "fewer_than_two_positive_timing_observations", evidence_count: ranked.length ? Number(ranked[0][1]) : 0 };
  const targetWindow = options.find(item => item.key === ranked[0][0]);
  if (!targetWindow) return { recommended_time: current, direction: "hold", source: "policy", reason: "observed_window_outside_approved_range", evidence_count: Number(ranked[0][1]) };
  const currentWindow = options.find(item => item.key === windowForClock(current)) || options[0];
  const targetIndex = options.indexOf(targetWindow); const currentIndex = options.indexOf(currentWindow);
  const nextWindow = options[Math.max(0, Math.min(options.length - 1, currentIndex + Math.sign(targetIndex - currentIndex)))];
  return { recommended_time: nextWindow.anchor, direction: nextWindow.anchor === current ? "hold" : "change", source: "observed_interaction_window",
    reason: nextWindow.anchor === current ? "current_window_matches_observed_interactions" : `shift_one_window_toward_${targetWindow.key}`,
    evidence_count: Number(ranked[0][1]), target_window: targetWindow.key };
}

function recommendMedia(input = {}) {
  const evidence = input.evidence || {}; const envelope = input.envelope || {}; const state = input.state || {};
  const formats = (envelope.formats || []).map(text).filter(Boolean);
  const explicit = text(state.preferred_format);
  if (explicit && formats.includes(explicit)) return { recommended_format: explicit, direction: "hold", source: "explicit_request",
    reason: "explicit_format_inside_approved_pool", evidence_count: 1 };
  const scores = Object.assign({}, evidence.media_visits || {}, state.format_scores || {});
  const ranked = Object.entries(scores).filter(([kind]) => formats.includes(kind))
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  if (!ranked.length || Number(ranked[0][1]) <= 0) return { recommended_format: null, direction: "rotate", source: "novelty_policy",
    reason: "no_format_signal_rotate_least_recently_used", evidence_count: 0 };
  return { recommended_format: ranked[0][0], direction: ranked[0][0] === explicit ? "hold" : "change", source: "tracked_link_visits",
    reason: "highest_observed_visit_score_within_approved_pool", evidence_count: Number(ranked[0][1]) };
}

module.exports = { DAY_MS, WINDOWS, buildBehaviourEvidence, allowedWindows, recommendTime, recommendMedia,
  localClock, windowForClock, minutesBetween };
