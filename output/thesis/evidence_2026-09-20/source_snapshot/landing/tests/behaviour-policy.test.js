"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { behaviourKey } = require("../api/_lib/adaptive-core");
const { buildBehaviourEvidence, recommendTime, recommendMedia } = require("../api/_lib/behaviour-policy");

function scenario() {
  const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
  const key = behaviourKey(behaviour);
  const nudges = [1, 2, 3].map(index => Object.assign({ nudge_id: `n-${index}`, user_id: "patient-1",
    scheduled_time: "09:00", media_asset_id: index < 3 ? "video-1" : "paper-1" }, behaviour));
  const patient = { schedule_nudges: nudges, schedule_state: [
    { nudge_id: "n-1", status: "read", delivered_at: "2026-08-20T00:00:00Z", read_at: "2026-08-20T00:30:00Z" },
    { nudge_id: "n-2", status: "delivered", delivered_at: "2026-08-21T00:00:00Z" },
    { nudge_id: "n-3", status: "delivered", delivered_at: "2026-08-22T00:00:00Z" }
  ] };
  const adaptive = { assets: [
    { asset_id: "video-1", media_kind: "video" }, { asset_id: "paper-1", media_kind: "paper" }
  ], events: [
    { event_type: "link_visit", nudge_id: "n-1", asset_id: "video-1", event_at: "2026-08-20T09:00:00Z" },
    { event_type: "inbound_reply", nudge_id: "n-2", body: "Thanks", event_at: "2026-08-21T09:30:00Z" }
  ] };
  return { key, patient, adaptive };
}

test("passive evidence keeps missing reads unknown and closes only elapsed 24-hour windows", function () {
  const value = scenario();
  const evidence = buildBehaviourEvidence(Object.assign(value, { behaviour_key: value.key, now: "2026-08-24T12:00:00Z" }));
  assert.equal(evidence.delivered_count, 3);
  assert.equal(evidence.read_count, 1);
  assert.equal(evidence.read_unknown_count, 2);
  assert.equal(evidence.no_observable_interaction_count, 1);
  assert.equal(evidence.median_read_latency_minutes, 30);
  assert.equal(evidence.records[2].outcome, "no_observable_interaction");
});

test("two ordinary evening interactions shift delivery one approved window at a time", function () {
  const value = scenario();
  const evidence = buildBehaviourEvidence(Object.assign(value, { behaviour_key: value.key, now: "2026-08-24T12:00:00Z" }));
  const recommendation = recommendTime({ evidence, envelope: { earliest_time: "08:00", latest_time: "20:00" },
    state: {}, current_times: ["09:00"] });
  assert.equal(recommendation.recommended_time, "13:00");
  assert.equal(recommendation.target_window, "evening");
  assert.equal(recommendation.evidence_count, 2);
});

test("tracked media visits choose only an approved format while explicit preference remains strongest", function () {
  const formats = { formats: ["video", "paper", "reading"] };
  assert.equal(recommendMedia({ evidence: { media_visits: { video: 2 } }, envelope: formats, state: {} }).recommended_format, "video");
  assert.equal(recommendMedia({ evidence: { media_visits: { video: 5 } }, envelope: formats,
    state: { preferred_format: "paper" } }).recommended_format, "paper");
  assert.equal(recommendMedia({ evidence: { media_visits: {} }, envelope: formats, state: {} }).direction, "rotate");
});
