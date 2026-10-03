"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../scripts/adaptability-scenarios/core");
const { replay } = require("../../scripts/policy-baselines");
const { cohort, probability, stableUniform } = require("../../scripts/generate-frequency-dataset");

const artifact = core.loadArtifact();

test("settling week is the first post-shift week that holds the target to the end", () => {
  assert.equal(core.settleWeek([2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1], 1), 8);
  assert.equal(core.settleWeek([2, 2, 2, 2, 2, 2, 1, 1, 2, 1, 1, 1], 1), 10);
  assert.equal(core.settleWeek([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 1), 7);
  assert.equal(core.settleWeek([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1], 2), null);
});

test("reversals follow the policy-baselines definition and holds reset the comparison", () => {
  const decisions = directions => directions.map(direction => ({ direction }));
  assert.equal(core.reversals(decisions(["increase", "decrease", "increase"])), 2);
  assert.equal(core.reversals(decisions(["increase", "hold", "decrease"])), 0);
});

test("decisions are labelled by the preference behind the latest evidence", () => {
  const decisions = [
    { week: 1, from: 2, to: 1 }, { week: 2, from: 1, to: 2 }, { week: 3, from: 2, to: 2 }, { week: 4, from: 2, to: 1 }
  ];
  // Week 2 is judged against pref(1) = 2, week 3 against pref(2) = 2, week 4 against pref(3) = 3.
  const counts = core.classifyDecisions(decisions, week => (week >= 3 ? 3 : 2));
  assert.equal(counts.change_needed_up, 2);
  assert.equal(counts.toward_up, 1);
  assert.equal(counts.away, 1);
  assert.equal(counts.hold_needed, 1);
  assert.equal(counts.held, 1);
});

test("silence increases and operative-gate breaches are counted as violations", () => {
  const result = core.violations([
    { from: 1, to: 2, direction: "increase", positives_last4: 0 },
    { from: 2, to: 3, direction: "increase", positives_last4: 1 }
  ], "model_operative");
  assert.equal(result.silence_increase, 1);
  assert.equal(result.operative_gate, 2);
});

test("the operative fixture exposes exactly the logged closed outcomes to the deployed policy", () => {
  const log = [1, 0, 0, 1, 1, 0].map((value, index) => ({ id: `w1m${index + 1}`, week: 1, message: index + 1,
    at: Date.parse("2026-01-05T09:00:00Z") + index * 36e5 * 30, status: "delivered", interacted: value }));
  const { patient, adaptive } = core.buildFixture(log, 2);
  const outcomes = core.confirmedOutcomes(patient, adaptive, core.KEY, new Date(core.decisionAt(3)).toISOString());
  assert.deepEqual(outcomes.map(row => row.interacted_within_24h), [1, 0, 0, 1, 1, 0]);
});

test("the deployed policy holds when no delivery has closed", () => {
  const run = core.simulate({ arm: "model_operative", artifact, outcome: () => null });
  assert.ok(run.frequencies.every(value => value === 2));
  assert.ok(run.decisions.every(decision => decision.reason === "no_closed_24h_outcome"));
});

test("the simulator reproduces the frozen stationary replay exactly", () => {
  const users = cohort(300, 5128);
  for (const [arm, policy] of [["deterministic", "deterministic"], ["model_selector", "model_plus_safety"]]) {
    let delivered = 0; let interactions = 0;
    for (const user of users) {
      const run = core.simulate({ arm, artifact, outcome: ({ week, message, current, history }) =>
        (stableUniform(5128, user.synthetic_user_id, week, message, "matched-policy") < probability(user, current, history) ? 1 : 0) });
      delivered += run.log.length; interactions += run.log.reduce((sum, entry) => sum + entry.interacted, 0);
    }
    const reference = replay(users, policy, artifact, 5128);
    assert.equal(delivered, reference.delivered_messages, arm);
    assert.equal(interactions, reference.ordinary_interactions, arm);
  }
});

test("persona and drift results are deterministic", () => {
  assert.deepEqual(core.runPartB(artifact), core.runPartB(artifact));
  assert.deepEqual(core.runPartA(1, "model_operative", artifact), core.runPartA(1, "model_operative", artifact));
});
