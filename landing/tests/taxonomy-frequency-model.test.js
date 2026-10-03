"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateDataset, scheduledSlot, historyFeatures } = require("../../scripts/taxonomy-frequency/generate");
const { FEATURE_NAMES, featureVector, scaler, fit, predict, scoreFrequency, posteriorTerms, aggregate } = require("../../scripts/taxonomy-frequency/model");

const data = generateDataset({ users: 35, weeks: 4 });
const training = data.rows.filter(r => Number(r.synthetic_user_id.slice(4)) <= 30 && r.week <= 3);

test("one-hot features capture each taxonomy dimension without hidden affinities", () => {
  assert.equal(featureVector(training[0]).length, FEATURE_NAMES.length);
  for (const value of ["pillar=", "category=", "nudge_type=", "tone_variant="])
    assert.ok(FEATURE_NAMES.some(f => f.startsWith(value)));
  const changed = { ...training[0], nudge_type: training[0].nudge_type === "challenge" ? "affirmation" : "challenge" };
  assert.notDeepEqual(featureVector(training[0]), featureVector(changed));
});
test("taxonomy posterior is numerically converged and predicts probabilities", () => {
  const scale = scaler(training), model = fit(training, scale);
  assert.ok(model.iterations < 100);
  assert.equal(model.training_rows, training.length);
  assert.ok(Math.max(...posteriorTerms(model.beta, aggregate(training, scale)).grad.map(Math.abs)) < 1e-6);
  assert.ok(training.every(r => predict(model, r) > 0 && predict(model, r) < 1));
});
test("frequency score uses only the visible approved future slots", () => {
  const user = data.users[30], events = [];
  const model = fit(training, scaler(training));
  const slots = [1, 2, 3].map(i => scheduledSlot(user, 9, i));
  const direct = predict(model, { ...slots[0], ...historyFeatures(events, slots[0]), candidate_frequency: 1, current_frequency: 2 });
  assert.ok(Math.abs(scoreFrequency(model, 2, events, slots, 1) - direct) < 1e-12);
});
