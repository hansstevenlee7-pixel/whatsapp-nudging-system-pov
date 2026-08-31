"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { behaviourKey } = require("../api/_lib/adaptive-core");
const { confirmedOutcomes, evaluateShadow, shadowRows } = require("../api/_lib/frequency-shadow");

function setup() {
  const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
  const key = behaviourKey(behaviour);
  const patient = { weekly_schedule: [1, 2].map(index => Object.assign({ schedule_slot_id: `slot-${index}`, status: "active" }, behaviour)),
    nudges: [1, 2, 3, 4].map(index => Object.assign({ nudge_id: `n-${index}` }, behaviour)),
    schedule_state: [1, 2, 3, 4].map(index => ({ nudge_id: `n-${index}`, status: "delivered",
      delivered_at: `2026-08-${20 + index}T00:00:00Z` })) };
  const adaptive = { events: [
    { event_type: "inbound_reply", nudge_id: "n-1", event_at: "2026-08-21T02:00:00Z", body: "Thanks" },
    { event_type: "inbound_reply", nudge_id: "n-2", event_at: "2026-08-22T01:00:00Z", body: "STOP" },
    { event_type: "link_visit", nudge_id: "n-3", event_at: "2026-08-23T20:00:00Z" },
    { event_type: "link_visit", nudge_id: "n-4", event_at: "2026-08-26T20:00:00Z" }
  ] };
  const envelope = Object.assign({}, behaviour, { behaviour_key: key, status: "approved", frequency_min: 1, frequency_max: 3 });
  return { key, patient, adaptive, envelope };
}

test("closed outcomes use confirmed delivery and only ordinary interactions inside 24 hours", () => {
  const value = setup(); const rows = confirmedOutcomes(value.patient, value.adaptive, value.key, "2026-08-27T00:00:00Z");
  assert.deepEqual(rows.map(row => row.interacted_within_24h), [1, 0, 1, 0]);
});

test("closed outcomes read canonical dated deliveries from the patient payload", () => {
  const value = setup(); value.patient.schedule_nudges = value.patient.nudges; delete value.patient.nudges;
  const rows = confirmedOutcomes(value.patient, value.adaptive, value.key, "2026-08-27T00:00:00Z");
  assert.deepEqual(rows.map(row => row.interacted_within_24h), [1, 0, 1, 0]);
});

test("shadow evaluation scores bounded frequencies without changing the schedule", () => {
  const value = setup(); const result = evaluateShadow(Object.assign({}, value, { behaviour_key: value.key, now: "2026-08-27T00:00:00Z" }));
  assert.equal(result.status, "evaluated"); assert.equal(result.mode, "shadow"); assert.equal(result.current_frequency, 2);
  assert.equal(result.applied, false); assert.ok([1, 2, 3].includes(result.recommended_frequency));
  assert.deepEqual(Object.keys(result.candidate_scores), ["1", "2", "3"]);
  assert.equal(value.patient.weekly_schedule.length, 2);
});

test("recommendation and policy are logged separately with actual frequency unchanged", () => {
  const value = setup(); const result = evaluateShadow(Object.assign({}, value, { behaviour_key: value.key, now: "2026-08-27T00:00:00Z" }));
  const rows = shadowRows({ user_id: "patient-1", result, now: "2026-08-27T00:00:00Z" });
  assert.deepEqual(rows.map(row => row.signal_type), ["frequency_model_recommendation", "frequency_policy_shadow"]);
  assert.equal(rows[0].frequency_before, 2); assert.equal(rows[0].frequency_after, 2);
  assert.equal(rows[1].outcome, "no_change"); assert.match(rows[1].reason, /shadow mode/);
});
