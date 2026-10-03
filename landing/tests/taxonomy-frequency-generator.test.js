"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const schema = require("../lifestyle_nudging_schema.json");
const { BEHAVIOURS, TYPES, TONES, SCENARIO_EFFECTS, cohort, scheduledSlot, historyFeatures, generateDataset, datasetHash } = require("../../scripts/taxonomy-frequency/generate");

test("synthetic behaviours, types, and tones come from the live schema", () => {
  for (const row of BEHAVIOURS) {
    assert.ok(schema.$defs.pillar.enum.includes(row.pillar));
    assert.ok(schema.$defs.category.enum.includes(row.category));
    assert.ok(row.action_text);
  }
  assert.deepEqual(TYPES, schema.$defs.nudge_type.enum);
  assert.deepEqual(TONES, schema.$defs.tone_variant.enum.filter(Boolean));
  for (const field of ["pillar", "category", "nudge_type", "tone_variant"])
    assert.deepEqual(Object.keys(SCENARIO_EFFECTS[field]).sort(), schema.$defs[field].enum.filter(Boolean).sort());
});
test("only a clinician-approved action is assigned to each synthetic slot", () => {
  for (const user of cohort()) for (let week = 1; week <= 12; week++) for (let message = 1; message <= 3; message++) {
    const slot = scheduledSlot(user, week, message);
    assert.ok(user.approved_behaviours.some(b => b.action_text === slot.action_text && b.pillar === slot.pillar && b.category === slot.category));
  }
});
test("response evidence uses only previous messages and taxonomy-matched recent history", () => {
  const a = { nudge_type: "reminder", pillar: "sleep", interacted_within_24h: 1 };
  const b = { nudge_type: "challenge", pillar: "nutrition", interacted_within_24h: 0 };
  assert.deepEqual(historyFeatures([a, b], { nudge_type: "reminder", pillar: "nutrition" }), {
    recent_interaction_rate: 0.5, noninteraction_streak: 1, has_previous_interaction: 1,
    recent_type_exposures: 1, recent_type_interaction_rate: 1,
    recent_pillar_exposures: 1, recent_pillar_interaction_rate: 0
  });
});
test("generator is reproducible and its public rows exclude hidden preferences", () => {
  const first = generateDataset(), second = generateDataset();
  assert.equal(datasetHash(first.rows), datasetHash(second.rows));
  assert.equal(first.rows.length, second.rows.length);
  const serialized = JSON.stringify(first.rows);
  for (const field of ["preferred_frequency", "baseline_logit", "fatigue", "hidden_type_affinity", "hidden_pillar_affinity", "hidden_tone_affinity"]) assert.ok(!serialized.includes(field));
  assert.equal(first.rows.filter(r => r.interacted_within_24h).length > 0, true);
});
