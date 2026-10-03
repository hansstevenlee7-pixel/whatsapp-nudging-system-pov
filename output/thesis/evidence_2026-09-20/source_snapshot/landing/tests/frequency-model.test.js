"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateDataset, datasetHash } = require("../../scripts/generate-frequency-dataset");
const { train } = require("../../scripts/train-frequency-model");
const { FEATURE_NAMES, predictProbability, scoreFrequencies, recommendFrequency, recentHistory, ordinaryReply } = require("../api/_lib/frequency-model");

test("synthetic frequency data is fixed-seed, longitudinal, and contains no hidden profile fields", () => {
  const first = generateDataset(); const second = generateDataset();
  assert.equal(datasetHash(first.rows), datasetHash(second.rows));
  assert.equal(first.users.length, 300); assert.equal(first.weeks, 12);
  assert.ok(first.rows.length > 6000); assert.ok(first.rows.some(row => row.interacted_within_24h === 1));
  assert.deepEqual(Object.keys(first.rows[0]), ["synthetic_user_id", "week", "message_index", "candidate_frequency", "current_frequency",
    "recent_interaction_rate", "noninteraction_streak", "has_previous_interaction", "interacted_within_24h"]);
});

test("training is reproducible and beats the constant Brier baseline on frozen test data", () => {
  const first = train(); const second = train();
  assert.deepEqual(first.coefficients, second.coefficients);
  assert.deepEqual(first.feature_names, FEATURE_NAMES);
  assert.ok(first.evaluation.test.brier_score < first.evaluation.test.constant_brier_score);
  assert.ok(first.evaluation.test.pr_auc > first.evaluation.test.prevalence);
  assert.equal(first.policy_comparison.every(row => row.constraint_violations === 0), true);
});

test("runtime inference validates the frozen feature contract", () => {
  const model = train();
  const probability = predictProbability(model, { candidate_frequency: 2, current_frequency: 2,
    recent_interaction_rate: 0.5, noninteraction_streak: 0, has_previous_interaction: true });
  assert.ok(probability > 0 && probability < 1);
  assert.throws(() => predictProbability(Object.assign({}, model, { feature_names: ["wrong"] }), {}), /feature contract/);
});

test("frequency policy is bounded and cannot increase from silence", () => {
  const model = train(); const silent = recentHistory([0, 0, 0, 0]);
  const scores = scoreFrequencies(model, Object.assign({}, silent, { current_frequency: 2, frequency_min: 1, frequency_max: 3 }));
  const decision = recommendFrequency(scores, Object.assign({}, silent, { current_frequency: 2 }));
  assert.ok([1, 2].includes(decision.recommended_frequency));
  const forced = recommendFrequency({ 3: 0.9 }, { current_frequency: 2, has_recent_interaction: false });
  assert.equal(forced.recommended_frequency, 2);
  assert.equal(forced.reason, "increase_blocked_without_recent_interaction");
});

test("control replies are excluded from the ordinary-interaction target", () => {
  for (const value of ["STOP", "pause", "MORE", "less", ""]) assert.equal(ordinaryReply(value), false);
  assert.equal(ordinaryReply("Thanks, that was useful"), true);
});
