"use strict";

// Adaptability scenario suite. The frozen protocol is PROTOCOL.md in this
// folder; nothing here may change after results exist without a new protocol
// version and output directory. Read-only with respect to the frozen model.

const fs = require("node:fs");
const path = require("node:path");
const { recentHistory } = require("../../landing/api/_lib/frequency-model");
const { evaluateAdaptive, confirmedOutcomes } = require("../../landing/api/_lib/frequency-shadow");
const { behaviourKey } = require("../../landing/api/_lib/adaptive-core");
const { cohort, probability, stableUniform } = require("../generate-frequency-dataset");
const { selectFrequency } = require("../policy-baselines");

const MODEL_PATH = path.resolve(__dirname, "../../landing/api/_models/frequency-logistic-v1.json");
const WEEKS = 12; const SHIFT_WEEK = 7; const MIN = 1; const MAX = 3; const START = 2;
const SEEDS = [5128, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const DAY_MS = 24 * 60 * 60 * 1000; const HOUR_MS = 60 * 60 * 1000;
const EPOCH = Date.parse("2026-01-05T00:00:00Z");
const BEHAVIOUR = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
const KEY = behaviourKey(BEHAVIOUR);
const ENVELOPE = Object.assign({}, BEHAVIOUR, { behaviour_key: KEY, status: "approved", frequency_min: MIN, frequency_max: MAX });
const PART_A_ARMS = ["fixed_2", "deterministic", "model_selector", "model_operative", "oracle"];
const PART_B_ARMS = ["fixed_2", "deterministic", "model_selector", "model_operative"];
const IMPLEMENTABLE = ["deterministic", "model_selector", "model_operative"];

function loadArtifact() { return JSON.parse(fs.readFileSync(MODEL_PATH, "utf8")); }

// Message m of week w is delivered on day 7(w-1) + 2m - 1 at 09:00 UTC, so every
// 24-hour window closes before the next week's decision at day 7w 00:00 UTC.
function deliveredAt(week, message) { return EPOCH + (7 * (week - 1) + 2 * message - 1) * DAY_MS + 9 * HOUR_MS; }
function decisionAt(week) { return EPOCH + 7 * (week - 1) * DAY_MS; }
function iso(ms) { return new Date(ms).toISOString(); }
function closedOutcomes(log) { return log.filter(entry => entry.status === "delivered").map(entry => entry.interacted); }

// Synthetic patient and event payload for evaluateAdaptive, built from the
// closed outcome log. Only the last eight delivered records are passed; the
// policy reads the last four.
function buildFixture(log, current) {
  const recent = log.filter(entry => entry.status === "delivered").slice(-8);
  const patient = {
    weekly_schedule: Array.from({ length: current }, (_, index) =>
      Object.assign({ schedule_slot_id: `slot-${index + 1}`, status: "active", scheduled_time: "09:00" }, BEHAVIOUR)),
    nudges: recent.map(entry => Object.assign({ nudge_id: entry.id, scheduled_time: "09:00" }, BEHAVIOUR)),
    schedule_state: recent.map(entry => ({ nudge_id: entry.id, status: "delivered", delivered_at: iso(entry.at) }))
  };
  const adaptive = {
    events: recent.filter(entry => entry.interacted).map(entry => ({ event_type: "link_visit", nudge_id: entry.id, event_at: iso(entry.at + 2 * HOUR_MS) })),
    decisions: [], states: []
  };
  return { patient, adaptive };
}

function operativeDecision(log, current, week) {
  const { patient, adaptive } = buildFixture(log, current);
  const result = evaluateAdaptive({ behaviour_key: KEY, patient, adaptive, envelope: ENVELOPE, now: iso(decisionAt(week)), mode: "apply" });
  if (result.status !== "evaluated") return { next: current, reason: result.reason };
  return { next: result.recommended_frequency, reason: result.policy_reason };
}

function decide(arm, context) {
  const { current, history, artifact, log, week, preference } = context;
  if (arm === "fixed_2") return { next: 2, reason: "fixed" };
  if (arm === "model_operative") return operativeDecision(log, current, week);
  const policy = { deterministic: "deterministic", model_selector: "model_plus_safety", oracle: "oracle_preferred" }[arm];
  if (!policy) throw new Error(`Unknown arm ${arm}`);
  return { next: selectFrequency(policy, { user: { preferred_frequency: preference }, current, history, artifact }), reason: null };
}

// Runs one profile or persona. outcome(context) returns 1, 0, or null for a
// failed delivery. preferenceAt(week) is the hidden preference (Part A only).
function simulate({ arm, artifact, outcome, preferenceAt = () => null }) {
  let current = START; let deliveries = 0; const log = []; const decisions = []; const frequencies = [];
  for (let week = 1; week <= WEEKS; week += 1) {
    const closed = closedOutcomes(log);
    const history = recentHistory(closed);
    const positivesLast4 = closed.slice(-4).reduce((sum, value) => sum + value, 0);
    const { next, reason } = decide(arm, { current, history, artifact, log, week, preference: preferenceAt(week) });
    const direction = next > current ? "increase" : next < current ? "decrease" : "hold";
    decisions.push({ week, from: current, to: next, direction, reason, closed_count: closed.length, positives_last4: positivesLast4 });
    current = next; frequencies.push(current);
    for (let message = 1; message <= current; message += 1) {
      deliveries += 1;
      const value = outcome({ week, message, current, delivery: deliveries, history: recentHistory(closedOutcomes(log)) });
      log.push({ id: `w${week}m${message}`, week, message, at: deliveredAt(week, message),
        status: value === null ? "failed" : "delivered", interacted: value ? 1 : 0 });
    }
  }
  return { decisions, frequencies, log };
}

function reversals(decisions) {
  let count = 0; let previous = "hold";
  for (const decision of decisions) {
    if (decision.direction !== "hold" && previous !== "hold" && decision.direction !== previous) count += 1;
    previous = decision.direction;
  }
  return count;
}

function violations(decisions, arm) {
  const result = { out_of_range: 0, step_over_one: 0, silence_increase: 0, operative_gate: 0 };
  for (const decision of decisions) {
    if (decision.to < MIN || decision.to > MAX) result.out_of_range += 1;
    if (Math.abs(decision.to - decision.from) > 1) result.step_over_one += 1;
    if (decision.direction === "increase" && decision.positives_last4 === 0) result.silence_increase += 1;
    if (arm === "model_operative" && decision.direction === "increase" && decision.positives_last4 < 2) result.operative_gate += 1;
  }
  result.total = result.out_of_range + result.step_over_one + result.silence_increase + result.operative_gate;
  return result;
}

// First week in [SHIFT_WEEK, WEEKS] from which the frequency equals target in
// every remaining week; null when it never settles.
function settleWeek(frequencies, target) {
  let settle = null;
  for (let week = WEEKS; week >= SHIFT_WEEK; week -= 1) {
    if (frequencies[week - 1] !== target) break;
    settle = week;
  }
  return settle;
}

// Labels each decision at week t >= 2 by the preference that generated the
// latest evidence, pref(t-1).
function classifyDecisions(decisions, preferenceAt) {
  const counts = { change_needed_up: 0, toward_up: 0, change_needed_down: 0, toward_down: 0, away: 0, held_when_change_needed: 0,
    hold_needed: 0, held: 0, moved_when_hold_needed: 0 };
  for (const decision of decisions.filter(item => item.week >= 2)) {
    const target = preferenceAt(decision.week - 1); const step = decision.to - decision.from;
    if (decision.from === target) {
      counts.hold_needed += 1;
      if (step === 0) counts.held += 1; else counts.moved_when_hold_needed += 1;
      continue;
    }
    const up = target > decision.from;
    counts[up ? "change_needed_up" : "change_needed_down"] += 1;
    if (step === 0) counts.held_when_change_needed += 1;
    else if ((step > 0) === up) counts[up ? "toward_up" : "toward_down"] += 1;
    else counts.away += 1;
  }
  return counts;
}

function shiftedPreference(user, seed) {
  if (stableUniform(seed, user.synthetic_user_id, 0, 0, "adaptability-shift-select") >= 0.5) return null;
  const others = [1, 2, 3].filter(value => value !== user.preferred_frequency);
  return stableUniform(seed, user.synthetic_user_id, 0, 1, "adaptability-shift-value") < 0.5 ? others[0] : others[1];
}

function driftCohort(seed) {
  return cohort(300, seed).map(user => {
    const post = shiftedPreference(user, seed);
    return Object.assign({}, user, { shifted: post !== null, preference_before: user.preferred_frequency,
      preference_after: post === null ? user.preferred_frequency : post });
  });
}

function preferenceFor(profile) {
  return week => (week >= SHIFT_WEEK ? profile.preference_after : profile.preference_before);
}

function runPartA(seed, arm, artifact) {
  const profiles = driftCohort(seed);
  const total = { delivered: 0, interactions: 0, changes: 0, reversals: 0,
    violations: { out_of_range: 0, step_over_one: 0, silence_increase: 0, operative_gate: 0, total: 0 },
    confusion: classifyDecisions([], () => 0),
    accuracy: { pre_stable: [0, 0, 0], pre_shifted: [0, 0, 0], post_stable: [0, 0, 0], post_shifted: [0, 0, 0] },
    settling: { up: [], down: [] }, profiles: profiles.length, shifted_profiles: 0,
    weekly: Object.fromEntries(["stable", "shifted_up", "shifted_down"].map(group =>
      [group, Array.from({ length: WEEKS }, () => ({ frequency: 0, preference: 0, profiles: 0 }))])) };
  for (const profile of profiles) {
    const preferenceAt = preferenceFor(profile);
    const run = simulate({ arm, artifact, preferenceAt, outcome: ({ week, message, current, history }) => {
      const p = probability(Object.assign({}, profile, { preferred_frequency: preferenceAt(week) }), current, history);
      return stableUniform(seed, profile.synthetic_user_id, week, message, "adaptability-drift") < p ? 1 : 0;
    } });
    total.delivered += run.log.length; total.interactions += run.log.reduce((sum, entry) => sum + entry.interacted, 0);
    total.changes += run.decisions.filter(item => item.direction !== "hold").length; total.reversals += reversals(run.decisions);
    const violation = violations(run.decisions, arm);
    for (const key of Object.keys(total.violations)) total.violations[key] += violation[key];
    const confusion = classifyDecisions(run.decisions, preferenceAt);
    for (const key of Object.keys(total.confusion)) total.confusion[key] += confusion[key];
    const group = !profile.shifted ? "stable" : profile.preference_after > profile.preference_before ? "shifted_up" : "shifted_down";
    run.frequencies.forEach((frequency, index) => {
      const week = index + 1; const target = preferenceAt(week);
      const cell = total.weekly[group][index]; cell.frequency += frequency; cell.preference += target; cell.profiles += 1;
      const bucket = total.accuracy[`${week < SHIFT_WEEK ? "pre" : "post"}_${profile.shifted ? "shifted" : "stable"}`];
      bucket[0] += frequency === target ? 1 : 0; bucket[1] += Math.abs(frequency - target); bucket[2] += 1;
    });
    if (profile.shifted) {
      total.shifted_profiles += 1;
      const settle = settleWeek(run.frequencies, profile.preference_after);
      total.settling[profile.preference_after > profile.preference_before ? "up" : "down"].push({
        settle_week: settle, needed_to_move: run.frequencies[SHIFT_WEEK - 1] !== profile.preference_after });
    }
  }
  return summarisePartA(seed, arm, total);
}

function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function settlingSummary(entries) {
  const describe = list => {
    const settled = list.filter(item => item.settle_week !== null).map(item => item.settle_week - SHIFT_WEEK);
    return { profiles: list.length, settled_by_week_12: ratio(settled.length, list.length), median_settling_decisions: median(settled) };
  };
  return { all: describe(entries), needed_to_move: describe(entries.filter(item => item.needed_to_move)) };
}

function summarisePartA(seed, arm, total) {
  const c = total.confusion; const changeNeeded = c.change_needed_up + c.change_needed_down;
  const accuracy = Object.fromEntries(Object.entries(total.accuracy).map(([key, [match, error, count]]) =>
    [key, { exact_match: ratio(match, count), mean_absolute_error: ratio(error, count), profile_weeks: count }]));
  return {
    seed, arm,
    efficiency: { delivered_messages: total.delivered, ordinary_interactions: total.interactions,
      interactions_per_message: ratio(total.interactions, total.delivered), messages_per_interaction: ratio(total.delivered, total.interactions) },
    responsiveness: { sensitivity: ratio(c.toward_up + c.toward_down, changeNeeded), sensitivity_up: ratio(c.toward_up, c.change_needed_up),
      sensitivity_down: ratio(c.toward_down, c.change_needed_down), wrong_direction: c.away, change_needed: changeNeeded },
    restraint: { specificity: ratio(c.held, c.hold_needed), unnecessary_change_rate: ratio(c.moved_when_hold_needed, c.hold_needed), hold_needed: c.hold_needed },
    confusion: c,
    settling: { up: settlingSummary(total.settling.up), down: settlingSummary(total.settling.down), shifted_profiles: total.shifted_profiles },
    stability: { changes_per_profile: total.changes / total.profiles, reversals_per_profile: total.reversals / total.profiles, reversals: total.reversals },
    boundedness: total.violations,
    accuracy,
    weekly: total.weekly
  };
}

const PERSONAS = [
  { id: "P1", name: "always-responds", outcome: () => 1,
    rule: "never decreases", pass: run => !run.decisions.some(d => d.direction === "decrease") },
  { id: "P2", name: "never-responds", outcome: () => 0,
    rule: "frequency 1 in week 12 and never increases", pass: run => run.frequencies[WEEKS - 1] === 1 && !run.decisions.some(d => d.direction === "increase") },
  { id: "P3", name: "responsive-then-silent", outcome: ({ week }) => (week <= 6 ? 1 : 0),
    rule: "no decrease decided in weeks 1-7 and frequency 1 in week 12",
    pass: run => !run.decisions.some(d => d.week <= 7 && d.direction === "decrease") && run.frequencies[WEEKS - 1] === 1 },
  { id: "P4", name: "silent-then-responsive", outcome: ({ week }) => (week <= 6 ? 0 : 1),
    rule: "no increase decided in weeks 1-7 and at least one increase decided in weeks 8-12",
    pass: run => !run.decisions.some(d => d.week <= 7 && d.direction === "increase") && run.decisions.some(d => d.week >= 8 && d.direction === "increase") },
  { id: "P5", name: "alternating", outcome: ({ delivery }) => (delivery % 2 === 1 ? 1 : 0),
    rule: "at most one direction reversal and no increase after a silent last-4 window",
    pass: run => reversals(run.decisions) <= 1 && violations(run.decisions, "").silence_increase === 0 },
  { id: "P6", name: "prefers-minimum", outcome: ({ current }) => (current === 1 ? 1 : 0),
    rule: "frequency 1 in week 12 and at most one direction reversal", pass: run => run.frequencies[WEEKS - 1] === 1 && reversals(run.decisions) <= 1 },
  { id: "P7", name: "avoids-minimum", outcome: ({ current }) => (current >= 2 ? 1 : 0),
    rule: "frequency never 1", pass: run => run.frequencies.every(value => value !== 1) },
  { id: "P8", name: "delivery-failure", outcome: () => null,
    rule: "frequency stays 2 in every week", pass: run => run.frequencies.every(value => value === 2) }
];

function runPartB(artifact) {
  return PERSONAS.map(persona => ({ id: persona.id, name: persona.name, rule: persona.rule,
    arms: Object.fromEntries(PART_B_ARMS.map(arm => {
      const run = simulate({ arm, artifact, outcome: persona.outcome });
      return [arm, { pass: persona.pass(run), frequencies: run.frequencies, reversals: reversals(run.decisions),
        violations: violations(run.decisions, arm).total, reasons: arm === "model_operative" ? run.decisions.map(d => d.reason) : undefined }];
    })) }));
}

module.exports = { WEEKS, SHIFT_WEEK, SEEDS, MODEL_PATH, PART_A_ARMS, PART_B_ARMS, IMPLEMENTABLE, PERSONAS, KEY,
  loadArtifact, buildFixture, operativeDecision, simulate, reversals, violations, settleWeek, classifyDecisions,
  driftCohort, preferenceFor, runPartA, runPartB, confirmedOutcomes, decisionAt, median };
