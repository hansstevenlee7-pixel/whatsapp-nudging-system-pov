"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { generateDataset, datasetHash, probability, stableUniform } = require("../generate-frequency-dataset");
const { recentHistory, sigmoid } = require("../../landing/api/_lib/frequency-model");
const { replay } = require("../policy-baselines");
const { sha, dot, vector, publicContext, eligible, applySafety, aggregate, fitLR, fitBandit,
  selectModel, scalingFromTraining } = require("./core");
const { PROMPT, GeminiPolicy, Paused, writeJSON } = require("./gemini");

const ROOT = path.resolve(__dirname, "../..");
const FROZEN = path.join(ROOT, "landing/api/_models/frequency-logistic-v1.json");
const FROZEN_HASH = "971e347d95f2d2eaf207db7d0d9978defe97df871eeb94068903eb989321aaa2";
const DATA_HASH = "b332923d43e528836c39259fbc35f99485601c60d5db33eddb0d9b3348f3a523";
const SEEDS = [5128, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const POLICIES = ["logistic_regression", "contextual_thompson", "gemini"];
const userNumber = row => Number(row.synthetic_user_id.slice(4));

function sourceHashes() {
  const files = ["scripts/frequency-comparison/core.js", "scripts/frequency-comparison/gemini.js",
    "scripts/frequency-comparison/run.js", "scripts/frequency-comparison/report.js",
    "scripts/generate-frequency-dataset.js", "scripts/train-frequency-model.js", "scripts/policy-baselines.js",
    "landing/api/_lib/frequency-model.js", "landing/api/_models/frequency-logistic-v1.json"];
  return Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file), "utf8"))]));
}
function assertFrozen() {
  if (sha(fs.readFileSync(FROZEN, "utf8")) !== FROZEN_HASH) throw new Error("Frozen artifact hash changed");
  if (datasetHash(generateDataset().rows) !== DATA_HASH) throw new Error("Frozen dataset hash changed");
}
function reproduce() {
  assertFrozen();
  const frozen = JSON.parse(fs.readFileSync(FROZEN, "utf8"));
  const cohort = generateDataset().users;
  const names = { fixed_2: "fixed", deterministic: "deterministic", model_plus_safety: "model" };
  const checks = Object.entries(names).map(([name, old]) => {
    const result = replay(cohort, name, frozen, 5128);
    const expected = frozen.policy_comparison.find(r => r.policy === old);
    const mismatches = ["delivered_messages", "ordinary_interactions", "frequency_changes", "direction_reversals", "constraint_violations"]
      .filter(field => result[field] !== expected[field]);
    return { policy: name, matched: mismatches.length === 0, mismatches, result };
  });
  if (checks.some(c => !c.matched)) throw new Error("Frozen policy reproduction failed");
  return { matched: true, frozen_sha256: FROZEN_HASH, dataset_sha256: DATA_HASH, checks };
}
function configuration() {
  return { version: 1, seeds: SEEDS, policies: POLICIES, weeks: [9, 10, 11, 12], evaluation_users: [271, 300],
    train_users: [1, 240], train_weeks: [1, 8], validation_users: [241, 270], validation_weeks: [9, 10],
    initial_history_weeks: [1, 8], history_window: 4,
    training_cells: "exact counts grouped by all observable model inputs; identical representation for all policies",
    feedback: "all decisions in a week precede all outcomes; each arm updates on its own observed outcomes",
    train_scaling: "fixed from each seed's initial training rows",
    lr: { iterations: 2200, learning_rate: 0.08, coefficient_l2: 0.05, intercept_l2: 0 },
    bandit: { prior_mean: 0, prior_precision_all_parameters: 0.05, approximation: "full Hessian Laplace",
      posterior_max_iterations: 100, gradient_tolerance: 1e-6, draws_per_decision: 1 },
    gemini: { model: "gemini-2.5-flash", temperature: 0, thinking_budget: 0, max_output_tokens: 4096,
      prompt_sha256: sha(PROMPT), attempts: 3, cache: "one exhaustive observable-context decision table per weekly training-cell snapshot",
      billing: "free tier only, confirmed by user", pacing_ms: 13000 },
    response_namespace: "frequency-comparison-v1", bootstrap_seed: 20260930, bootstrap_replicates: 10000,
    constraints: "1-3/week; change at most 1/week; no increase unless recent four outcomes contain an interaction",
    primary_metric: "interactions per delivered message", secondary_metrics: ["interactions", "messages", "weekly rates", "changes", "reversals", "constraint violations", "LLM fallback and invalid attempt rates"],
    interpretation: "stationary synthetic technical evaluation, not clinical efficacy or nudge-type evidence",
    source_sha256: sourceHashes() };
}
function initialise(generated, policy, configHash) {
  const users = generated.users.filter(u => userNumber(u) >= 271).map(user => {
    const rows = generated.rows.filter(r => r.synthetic_user_id === user.synthetic_user_id && r.week <= 8);
    return { id: user.synthetic_user_id, outcomes: rows.map(r => r.interacted_within_24h),
      current: rows.at(-1).candidate_frequency, previous_direction: "hold" };
  });
  return { config_sha256: configHash, seed: generated.seed, policy, next_week: 9,
    completed: false, users, online_rows: [], decisions: [], weeks: [], model_fits: [] };
}
function trainRows(generated) { return generated.rows.filter(r => userNumber(r) <= 240 && r.week <= 8); }
function validationMetrics(generated, cells, scaling) {
  const rows = generated.rows.filter(r => userNumber(r) >= 241 && userNumber(r) <= 270 && r.week >= 9 && r.week <= 10);
  const n = cells.reduce((s, c) => s + c[5], 0), prevalence = cells.reduce((s, c) => s + c[6], 0) / n;
  const evaluate = model => rows.reduce((s, r) => s + (sigmoid(dot(model.beta, vector(r, scaling))) - r.interacted_within_24h) ** 2, 0) / rows.length;
  return { rows: rows.length, positives: rows.reduce((s, r) => s + r.interacted_within_24h, 0),
    constant_brier: rows.reduce((s, r) => s + (prevalence - r.interacted_within_24h) ** 2, 0) / rows.length,
    lr_brier: evaluate(fitLR(cells, scaling)), bandit_posterior_mean_brier: evaluate(fitBandit(cells, scaling)),
    note: "validation only, no hyperparameter tuning; Gemini evaluated as a policy, not a probability estimator" };
}

async function executePolicy({ generated, policy, out, configHash, gemini, onProgress = console.log }) {
  const file = path.join(out, "checkpoints", `${generated.seed}-${policy}.json`);
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : initialise(generated, policy, configHash);
  if (state.config_sha256 !== configHash || state.seed !== generated.seed || state.policy !== policy) throw new Error("Checkpoint configuration mismatch");
  if (state.completed) return state;
  const initial = trainRows(generated), scaling = scalingFromTraining(initial);
  const hidden = new Map(generated.users.map(u => [u.synthetic_user_id, u]));
  while (state.next_week <= 12) {
    const week = state.next_week;
    const cells = aggregate([...initial, ...state.online_rows]);
    const cellsHash = sha(cells);
    writeJSON(path.join(out, "training-cells", `${generated.seed}-${policy}-${week}.json`), { columns: ["current_frequency", "recent_interaction_rate", "noninteraction_streak", "has_previous_interaction", "candidate_frequency", "delivered_count", "interaction_count"], cells, sha256: cellsHash });
    let model;
    if (policy === "logistic_regression") model = fitLR(cells, scaling);
    if (policy === "contextual_thompson") model = fitBandit(cells, scaling);
    if (model && !state.model_fits.some(f => f.week === week)) state.model_fits.push({ week, ...model, cells_sha256: cellsHash });
    for (const user of state.users) {
      if (state.decisions.some(d => d.week === week && d.user_id === user.id)) continue;
      const context = publicContext(user.current, user.outcomes);
      const decision = policy === "gemini" ? await gemini.choose(context, cells) :
        selectModel(model, context, policy === "contextual_thompson" ? `${generated.seed}|${week}|${user.id}|thompson` : null);
      const safe = applySafety(decision.proposed_frequency, context);
      state.decisions.push({ seed: generated.seed, policy, week, user_id: user.id, context,
        eligible_frequencies: eligible(context), cells_sha256: cellsHash, ...decision,
        applied_frequency: safe.frequency, safety_rejected: safe.rejected });
      writeJSON(file, state);
    }
    // No current-week feedback exists before every current-week decision is fixed.
    let messages = 0, interactions = 0, changes = 0, reversals = 0;
    for (const user of state.users) {
      const decision = state.decisions.find(d => d.week === week && d.user_id === user.id);
      const frequency = decision.applied_frequency, previousFrequency = user.current;
      const direction = frequency > user.current ? "increase" : frequency < user.current ? "decrease" : "hold";
      if (direction !== "hold") changes++;
      if (direction !== "hold" && user.previous_direction !== "hold" && direction !== user.previous_direction) reversals++;
      user.previous_direction = direction;
      user.current = frequency;
      const weeklyOutcomes = [];
      for (let message = 1; message <= frequency; message++) {
        const history = recentHistory(user.outcomes);
        const p = probability(hidden.get(user.id), frequency, history);
        const y = Number(stableUniform(generated.seed, user.id, week, message, "frequency-comparison-v1") < p);
        state.online_rows.push({ synthetic_user_id: user.id, week, message_index: message,
          current_frequency: previousFrequency, candidate_frequency: frequency,
          recent_interaction_rate: history.recent_interaction_rate, noninteraction_streak: history.noninteraction_streak,
          has_previous_interaction: Number(history.has_previous_interaction), interacted_within_24h: y });
        user.outcomes.push(y); weeklyOutcomes.push(y); messages++; interactions += y;
      }
      decision.observed_outcomes = weeklyOutcomes;
    }
    state.weeks.push({ week, delivered_messages: messages, ordinary_interactions: interactions,
      interactions_per_message: interactions / messages, frequency_changes: changes, direction_reversals: reversals });
    state.next_week++; state.completed = state.next_week > 12;
    writeJSON(file, state);
    onProgress(JSON.stringify({ seed: generated.seed, policy, week, interactions, messages, complete: state.completed }));
  }
  return state;
}

async function main(argv = process.argv.slice(2)) {
  const option = (flag, fallback) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback;
  const out = path.resolve(option("--out", path.join(ROOT, "output/frequency_comparison_2026-09-30")));
  const config = configuration(), configHash = sha(config);
  const manifestPath = path.join(out, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const prior = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (prior.config_sha256 !== configHash) throw new Error("Source/configuration changed: use a new output directory, never mix experiments");
  } else {
    writeJSON(manifestPath, { created_at: new Date().toISOString(), node_version: process.version,
      git_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      working_tree_dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim()),
      config_sha256: configHash, configuration: config, reproduction: reproduce() });
    fs.mkdirSync(path.join(out, "source-snapshot"), { recursive: true });
    for (const file of Object.keys(config.source_sha256)) {
      const dest = path.join(out, "source-snapshot", file);
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), dest);
    }
    fs.writeFileSync(path.join(out, "llm-prompt.txt"), PROMPT + "\n");
  }
  assertFrozen();
  const gemini = new GeminiPolicy({ root: ROOT, out, freeTierConfirmed: argv.includes("--free-tier-confirmed"),
    maxCalls: Number(option("--max-calls", "1200")) });
  const policies = argv.includes("--local-only") ? POLICIES.slice(0, 2) : POLICIES;
  let pause = null;
  try {
    for (const policy of policies) for (const seed of SEEDS) {
      const generated = generateDataset({ seed });
      const validationFile = path.join(out, "validation", `${seed}.json`);
      if (!fs.existsSync(validationFile)) {
        const training = trainRows(generated);
        writeJSON(validationFile, { seed, dataset_sha256: datasetHash(generated.rows),
          training_rows: training.length, metrics: validationMetrics(generated, aggregate(training), scalingFromTraining(training)) });
      }
      await executePolicy({ generated, policy, out, configHash, gemini });
    }
  } catch (error) {
    if (!(error instanceof Paused)) throw error;
    pause = { reason: error.message, at: new Date().toISOString() };
    console.log(JSON.stringify({ paused: pause }));
  } finally {
    assertFrozen();
    writeJSON(path.join(out, "run-status.json"), { last_run: new Date().toISOString(), pause,
      requested_policies: policies, api_attempts_this_process: gemini.calls,
      frozen_artifact_unchanged: true });
    require("./report").buildReport(out);
  }
  if (pause) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { ROOT, FROZEN_HASH, DATA_HASH, SEEDS, POLICIES, userNumber, reproduce, configuration,
  initialise, trainRows, executePolicy, validationMetrics, main };
