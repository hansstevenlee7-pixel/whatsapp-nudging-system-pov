"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { generateDataset, datasetHash, scheduledSlot, historyFeatures, probability, VERSION } = require("./generate");
const { FEATURE_NAMES, PRIOR_PRECISION, scaler, fit, predict, draw, scoreFrequency } = require("./model");
const { stableUniform } = require("../generate-frequency-dataset");
const { eligible, applySafety } = require("../frequency-comparison/core");
const { writeJSON } = require("../frequency-comparison/gemini");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "output/taxonomy_frequency_v2_2026-09-30");
const SEEDS = [5128, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const POLICIES = ["greedy_logistic", "contextual_thompson", "eligible_random"];
const number = id => Number(id.slice(4));
const digest = text => crypto.createHash("sha256").update(text).digest("hex");
function historyContext(current, events) {
  const last = events.slice(-4);
  return { current_frequency: current,
    recent_interaction_rate: last.length ? last.reduce((s, r) => s + r.interacted_within_24h, 0) / last.length : 0 };
}
function choose(policy, model, user, state, week, seed) {
  const context = historyContext(state.current, state.events);
  const options = eligible(context);
  const slots = [1, 2, 3].map(i => scheduledSlot(user, week, i, seed));
  let proposed, scores = null;
  if (policy === "eligible_random") {
    const key = stableUniform(seed, user.synthetic_user_id, week, 0, "taxonomy-policy-random");
    proposed = options[Math.floor(key * options.length)];
  } else {
    const coefficients = policy === "contextual_thompson"
      ? draw(model, `${seed}|${user.synthetic_user_id}|${week}|taxonomy-thompson`) : model.beta;
    scores = options.map(f => ({ frequency: f,
      predicted_interaction_rate: scoreFrequency(model, state.current, state.events, slots, f, coefficients) }));
    scores.sort((a, b) => b.predicted_interaction_rate - a.predicted_interaction_rate || a.frequency - b.frequency);
    proposed = scores[0].frequency;
  }
  const applied = applySafety(proposed, context);
  return { seed, policy, week, synthetic_user_id: user.synthetic_user_id,
    context, available_frequencies: options, approved_slots: slots,
    proposed_frequency: proposed, applied_frequency: applied.frequency,
    safety_rejected: applied.rejected, scores };
}
function replay(generated, policy) {
  const seed = generated.seed, initial = generated.rows.filter(r => number(r.synthetic_user_id) <= 240 && r.week <= 8);
  const scale = scaler(initial);
  const hidden = new Map(generated.users.map(u => [u.synthetic_user_id, u]));
  const states = generated.users.filter(u => number(u.synthetic_user_id) >= 271).map(user => {
    const past = generated.rows.filter(r => r.synthetic_user_id === user.synthetic_user_id && r.week <= 8);
    return { id: user.synthetic_user_id, current: past.at(-1).candidate_frequency, events: [...past] };
  });
  const feedback = [], decisions = [], weeks = [];
  for (let week = 9; week <= 12; week++) {
    const model = policy === "eligible_random" ? null : fit([...initial, ...feedback], scale);
    const pending = states.map(state => choose(policy, model, hidden.get(state.id), state, week, seed));
    // All choices are locked before this week's simulated feedback is revealed.
    for (const choice of pending) {
      const state = states.find(s => s.id === choice.synthetic_user_id);
      const user = hidden.get(state.id), current = state.current;
      const outcomes = [];
      for (let message = 1; message <= choice.applied_frequency; message++) {
        const slot = choice.approved_slots[message - 1], history = historyFeatures(state.events, slot);
        const y = Number(stableUniform(seed, state.id, week, message, "taxonomy-policy-response-v2") <
          probability(user, choice.applied_frequency, slot, history));
        const row = { synthetic_user_id: state.id, week, ...slot, candidate_frequency: choice.applied_frequency,
          current_frequency: current, ...history, interacted_within_24h: y };
        feedback.push(row); state.events.push(row); outcomes.push(y);
      }
      state.current = choice.applied_frequency;
      choice.observed_outcomes = outcomes;
      decisions.push(choice);
    }
    const thisWeek = feedback.filter(r => r.week === week);
    weeks.push({ week, delivered_messages: thisWeek.length,
      ordinary_interactions: thisWeek.reduce((s, r) => s + r.interacted_within_24h, 0) });
  }
  return { seed, policy, decisions, feedback, weeks };
}
function prAuc(rows, scores) {
  const ranked = rows.map((r, i) => ({ y: r.interacted_within_24h, score: scores[i] }))
    .sort((a, b) => b.score - a.score);
  const positives = ranked.reduce((s, r) => s + r.y, 0);
  let tp = 0, fp = 0, area = 0;
  for (const item of ranked) {
    if (item.y) { tp++; area += (tp / (tp + fp)) / positives; } else fp++;
  }
  return area;
}
function predictiveDiagnostics(generated) {
  const training = generated.rows.filter(r => number(r.synthetic_user_id) <= 240 && r.week <= 8);
  const validation = generated.rows.filter(r => number(r.synthetic_user_id) >= 241 && number(r.synthetic_user_id) <= 270 && r.week >= 9 && r.week <= 10);
  const test = generated.rows.filter(r => number(r.synthetic_user_id) >= 271 && r.week >= 9 && r.week <= 12);
  const model = fit(training, scaler(training));
  const prevalence = training.reduce((s, r) => s + r.interacted_within_24h, 0) / training.length;
  const report = rows => {
    const scores = rows.map(r => predict(model, r));
    const brier = scores.reduce((s, p, i) => s + (p - rows[i].interacted_within_24h) ** 2, 0) / rows.length;
    const baseline = rows.reduce((s, r) => s + (prevalence - r.interacted_within_24h) ** 2, 0) / rows.length;
    return { rows: rows.length, positives: rows.reduce((s, r) => s + r.interacted_within_24h, 0),
      brier, constant_baseline_brier: baseline, pr_auc: prAuc(rows, scores) };
  };
  return { train_rows: training.length, validation: report(validation), test: report(test),
    source: "random-assignment generator rows; independent of policy replay responses" };
}
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
function summarize(replays) {
  const perSeed = replays.map(r => {
    const messages = r.feedback.length, interactions = r.feedback.reduce((s, x) => s + x.interacted_within_24h, 0);
    return { seed: r.seed, policy: r.policy, delivered_messages: messages, ordinary_interactions: interactions,
      interactions_per_message: interactions / messages,
      constraint_violations: r.decisions.filter(d => !d.available_frequencies.includes(d.applied_frequency)).length,
      frequency_changes: r.decisions.filter(d => d.applied_frequency !== d.context.current_frequency).length };
  });
  const across = Object.fromEntries(POLICIES.map(policy => {
    const subset = perSeed.filter(r => r.policy === policy);
    return [policy, { seeds: subset.length,
      mean_interactions_per_message: mean(subset.map(r => r.interactions_per_message)),
      mean_delivered_messages: mean(subset.map(r => r.delivered_messages)),
      mean_ordinary_interactions: mean(subset.map(r => r.ordinary_interactions)),
      total_constraint_violations: subset.reduce((s, r) => s + r.constraint_violations, 0) }];
  }));
  const paired = {};
  for (const policy of POLICIES.slice(1)) {
    const differences = SEEDS.map(seed => perSeed.find(r => r.seed === seed && r.policy === policy).interactions_per_message -
      perSeed.find(r => r.seed === seed && r.policy === "greedy_logistic").interactions_per_message);
    const rng = require("../generate-frequency-dataset").mulberry32(20260930);
    const draws = Array.from({ length: 10000 }, () => mean(Array.from({ length: differences.length }, () => differences[Math.floor(rng() * differences.length)]))).sort((a, b) => a - b);
    paired[policy + "_minus_logistic"] = { mean: mean(differences), ci95: [draws[249], draws[9749]],
      higher_seeds: differences.filter(x => x > 0).length, paired_seeds: differences.length };
  }
  return { per_seed: perSeed, across_seeds: across, paired_contrasts: paired };
}
function main() {
  const sources = ["scripts/taxonomy-frequency/generate.js", "scripts/taxonomy-frequency/model.js",
    "scripts/taxonomy-frequency/local-run.js", "lifestyle_nudging_schema.json"];
  const hashes = Object.fromEntries(sources.map(f => [f, digest(fs.readFileSync(path.join(ROOT, f), "utf8"))]));
  const manifestFile = path.join(OUT, "manifest.json");
  if (fs.existsSync(manifestFile)) {
    const saved = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    if (JSON.stringify(saved.source_sha256) !== JSON.stringify(hashes)) throw new Error("Protocol/source changed; use a new output directory");
  }
  const data = SEEDS.map(seed => generateDataset({ seed }));
  const manifest = { version: VERSION, created_at: new Date().toISOString(), node_version: process.version,
    source_sha256: hashes, seeds: SEEDS, split: "users 1-240 weeks 1-8 training; 241-270 weeks 9-10 validation; 271-300 weeks 9-12 held-out replay",
    choices: "weekly frequency 1-3 only; approved prewritten taxonomy slots remain fixed",
    frequency_safety: "at most one step; no increase without a recent interaction",
    prior_precision: PRIOR_PRECISION, feature_names: FEATURE_NAMES,
    simulator_assumptions: "prespecified synthetic coefficients in generate.js, not empirical effects",
    dataset_sha256: Object.fromEntries(data.map(d => [d.seed, datasetHash(d.rows)])) };
  if (!fs.existsSync(manifestFile)) writeJSON(manifestFile, manifest);
  const diagnostics = Object.fromEntries(data.map(d => [d.seed, predictiveDiagnostics(d)]));
  const replays = [];
  for (const policy of POLICIES) for (const generated of data) {
    const result = replay(generated, policy); replays.push(result);
    console.log(JSON.stringify({ policy, seed: generated.seed, messages: result.feedback.length }));
  }
  const summary = { generated_at: new Date().toISOString(), version: VERSION,
    ...summarize(replays), predictive_diagnostics: diagnostics,
    note: "Synthetic taxonomy-aware frequency study. Logistic and Thompson share the same posterior mean; Thompson also samples uncertainty. The LLM arm is pending free-tier capacity." };
  writeJSON(path.join(OUT, "results.json"), summary);
  fs.writeFileSync(path.join(OUT, "decisions.jsonl"), replays.flatMap(r => r.decisions).map(r => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "feedback.jsonl"), replays.flatMap(r => r.feedback.map(x => ({ policy: r.policy, ...x }))).map(r => JSON.stringify(r)).join("\n") + "\n");
  return summary;
}
if (require.main === module) main();
module.exports = { ROOT, OUT, SEEDS, POLICIES, choose, replay, prAuc, predictiveDiagnostics, summarize, main };
