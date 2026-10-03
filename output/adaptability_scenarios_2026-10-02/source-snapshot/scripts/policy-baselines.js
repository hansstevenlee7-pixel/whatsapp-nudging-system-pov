"use strict";

// Extended frequency-policy baselines and multi-seed stability check.
//
// Adds three reference policies that the frozen matched replay omits: the
// minimum-frequency floor, the maximum, and an oracle that assigns each
// synthetic profile its hidden preferred frequency. The oracle reads a
// simulation property that the deployed system cannot observe; it is an upper
// bound for interpretation only and is never an implementable policy.
//
// Also reports the selected-frequency distribution, and repeats the whole
// experiment across cohort seeds with the model retrained per seed, so that a
// single-seed result is not reported as a stable ordering.
//
// This script is read-only with respect to landing/api/_models. It never
// rewrites the frozen artifact.
//
//   node scripts/policy-baselines.js
//   node scripts/policy-baselines.js --seeds 10 --out path/to/evidence.json

const fs = require("node:fs");
const path = require("node:path");
const { FEATURE_NAMES, scoreFrequencies, recommendFrequency, recentHistory, clamp } = require("../landing/api/_lib/frequency-model");
const { DEFAULT_SEED, generateDataset, probability, stableUniform } = require("./generate-frequency-dataset");
const { splitRows, fit, metrics } = require("./train-frequency-model");

const FROZEN_ARTIFACT_PATH = path.resolve(__dirname, "../landing/api/_models/frequency-logistic-v1.json");
const WEEKS = 12;
const FREQUENCY_MIN = 1;
const FREQUENCY_MAX = 3;

// Policies marked oracle = true read hidden simulation state and are reference
// bounds, not candidate implementations.
const POLICIES = [
  { name: "fixed_1", label: "Fixed at minimum (1/week)" },
  { name: "fixed_2", label: "Fixed at 2/week (published comparator)" },
  { name: "fixed_3", label: "Fixed at maximum (3/week)" },
  { name: "deterministic", label: "Deterministic history rules" },
  { name: "model_plus_safety", label: "Model recommendation plus safety selector" },
  { name: "oracle_preferred", label: "Oracle: hidden preferred frequency", oracle: true }
];

// Mapping to the policy names stored in the frozen artifact, used for the
// single-seed reproduction check.
const FROZEN_EQUIVALENT = { fixed_2: "fixed", deterministic: "deterministic", model_plus_safety: "model" };

// Highest-probability candidate, keeping only the one-step and
// increase-requires-recent-interaction bounds. Used to separate the effect of
// the fitted model from the effect of the lowest-near-best selection rule.
function argmaxFrequency(scores, input) {
  const entries = Object.entries(scores).map(([frequency, value]) => [Number(frequency), Number(value)]);
  const best = entries.reduce((left, right) => (right[1] > left[1] ? right : left));
  let desired = clamp(best[0], input.current_frequency - 1, input.current_frequency + 1);
  if (desired > input.current_frequency && !input.has_recent_interaction) desired = input.current_frequency;
  return desired;
}

function selectFrequency(policy, context) {
  const { user, current, history, artifact } = context;
  if (policy === "fixed_1") return FREQUENCY_MIN;
  if (policy === "fixed_2") return 2;
  if (policy === "fixed_3") return FREQUENCY_MAX;
  if (policy === "oracle_preferred") return user.preferred_frequency;
  if (policy === "deterministic") {
    if (history.noninteraction_streak >= 3) return Math.max(FREQUENCY_MIN, current - 1);
    if (history.has_recent_interaction && history.recent_interaction_rate >= 0.75) return Math.min(FREQUENCY_MAX, current + 1);
    return current;
  }
  if (policy === "model_plus_safety") {
    const input = Object.assign({}, history, { current_frequency: current, frequency_min: FREQUENCY_MIN, frequency_max: FREQUENCY_MAX });
    if (Number.isFinite(context.near_best_tolerance)) input.near_best_tolerance = context.near_best_tolerance;
    const scores = scoreFrequencies(artifact, input);
    if (context.selector === "argmax") return argmaxFrequency(scores, input);
    return recommendFrequency(scores, input).recommended_frequency;
  }
  throw new Error(`Unknown policy ${policy}`);
}

// Replays one policy over the cohort. The loop order, the "matched-policy"
// random namespace and the counter definitions are kept identical to
// simulatePolicy in train-frequency-model.js so that the three original
// policies reproduce the frozen artifact exactly.
function replay(users, policy, artifact, seed, selectorOptions = {}) {
  let delivered = 0; let interactions = 0; let changes = 0; let reversals = 0; let violations = 0;
  const selected = { 1: 0, 2: 0, 3: 0 };
  const weekly = Array.from({ length: WEEKS }, () => ({ 1: 0, 2: 0, 3: 0 }));
  for (const user of users) {
    let current = 2; const outcomes = []; let previousDirection = "hold";
    for (let week = 1; week <= WEEKS; week += 1) {
      const history = recentHistory(outcomes);
      const next = clamp(selectFrequency(policy, Object.assign({ user, current, history, artifact }, selectorOptions)), FREQUENCY_MIN, FREQUENCY_MAX);
      const direction = next > current ? "increase" : next < current ? "decrease" : "hold";
      if (direction !== "hold") changes += 1;
      if (direction !== "hold" && previousDirection !== "hold" && direction !== previousDirection) reversals += 1;
      if (next < FREQUENCY_MIN || next > FREQUENCY_MAX || Math.abs(next - current) > 1 ||
          (next > current && !history.has_recent_interaction)) violations += 1;
      previousDirection = direction; current = next;
      selected[current] += 1; weekly[week - 1][current] += 1;
      for (let message = 1; message <= current; message += 1) {
        const liveHistory = recentHistory(outcomes);
        const p = probability(user, current, liveHistory);
        const outcome = stableUniform(seed, user.synthetic_user_id, week, message, "matched-policy") < p ? 1 : 0;
        outcomes.push(outcome); delivered += 1; interactions += outcome;
      }
    }
  }
  const profileWeeks = selected[1] + selected[2] + selected[3];
  return {
    policy,
    delivered_messages: delivered,
    ordinary_interactions: interactions,
    interactions_per_message: interactions / delivered,
    messages_per_interaction: interactions ? delivered / interactions : null,
    frequency_changes: changes,
    direction_reversals: reversals,
    constraint_violations: violations,
    selected_frequency_counts: selected,
    selected_frequency_share: {
      1: selected[1] / profileWeeks,
      2: selected[2] / profileWeeks,
      3: selected[3] / profileWeeks
    },
    weekly_selected_frequency_counts: weekly
  };
}

function trainOnSeed(seed) {
  const generated = generateDataset({ seed });
  const split = splitRows(generated.rows);
  const fitted = fit(split.train);
  const prevalence = split.train.reduce((sum, row) => sum + row.interacted_within_24h, 0) / split.train.length;
  const artifact = {
    model_type: "regularized_logistic_regression",
    feature_names: FEATURE_NAMES,
    intercept: fitted.intercept,
    coefficients: fitted.coefficients,
    feature_mean: fitted.feature_mean,
    feature_scale: fitted.feature_scale
  };
  return {
    generated,
    artifact,
    training_prevalence: prevalence,
    evaluation: { validation: metrics(fitted, split.validation, prevalence), test: metrics(fitted, split.test, prevalence) }
  };
}

function summarise(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
    : 0;
  return { mean, sd: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values), n: values.length };
}

// Confirms that this harness reproduces the frozen artifact's stored policy
// comparison on the published seed before any new result is reported.
function reproductionCheck(frozen, rows) {
  const stored = new Map((frozen.policy_comparison || []).map(entry => [entry.policy, entry]));
  const fields = ["delivered_messages", "ordinary_interactions", "frequency_changes", "direction_reversals", "constraint_violations"];
  const checks = [];
  for (const [ours, theirs] of Object.entries(FROZEN_EQUIVALENT)) {
    const mine = rows.find(row => row.policy === ours);
    const recorded = stored.get(theirs);
    if (!mine || !recorded) { checks.push({ policy: ours, matched: false, note: "missing comparison record" }); continue; }
    const mismatched = fields.filter(field => mine[field] !== recorded[field]);
    checks.push({ policy: ours, frozen_policy: theirs, matched: mismatched.length === 0, mismatched_fields: mismatched });
  }
  return { matched: checks.every(check => check.matched), checks };
}

function run(options = {}) {
  const seedCount = Number(options.seeds) || 10;
  const frozen = JSON.parse(fs.readFileSync(FROZEN_ARTIFACT_PATH, "utf8"));
  const seeds = [DEFAULT_SEED];
  for (let i = 1; seeds.length < seedCount; i += 1) if (i !== DEFAULT_SEED) seeds.push(i);

  const perSeed = [];
  for (const seed of seeds) {
    const trained = trainOnSeed(seed);
    const frozenModel = POLICIES.map(policy => replay(trained.generated.users, policy.name, frozen, seed));
    const retrainedModel = replay(trained.generated.users, "model_plus_safety", trained.artifact, seed);
    perSeed.push({
      seed,
      training_prevalence: trained.training_prevalence,
      evaluation: trained.evaluation,
      policies_frozen_model: frozenModel,
      model_plus_safety_retrained: retrainedModel
    });
  }

  // Isolates the lowest-near-best rule from the fitted model. If the share at
  // the minimum frequency stays high under pure argmax, the concentration is a
  // property of the model, not of the selection rule.
  const publishedCohort = generateDataset({ seed: DEFAULT_SEED }).users;
  const selectorSensitivity = [
    { selector: "lowest_near_best", near_best_tolerance: 0.05, note: "shipped configuration" },
    { selector: "lowest_near_best", near_best_tolerance: 0.01 },
    { selector: "lowest_near_best", near_best_tolerance: 0.001 },
    { selector: "argmax", note: "highest-probability candidate, safety bounds retained" }
  ].map(variant => {
    const row = replay(publishedCohort, "model_plus_safety", frozen, DEFAULT_SEED, variant);
    return Object.assign({}, variant, {
      delivered_messages: row.delivered_messages,
      ordinary_interactions: row.ordinary_interactions,
      interactions_per_message: row.interactions_per_message,
      direction_reversals: row.direction_reversals,
      share_at_minimum: row.selected_frequency_share[1],
      selected_frequency_share: row.selected_frequency_share
    });
  });

  const published = perSeed.find(entry => entry.seed === DEFAULT_SEED);
  const reproduction = reproductionCheck(frozen, published.policies_frozen_model);

  const metricsOfInterest = ["delivered_messages", "ordinary_interactions", "interactions_per_message",
    "frequency_changes", "direction_reversals", "constraint_violations"];
  const across = {};
  for (const policy of POLICIES) {
    across[policy.name] = { label: policy.label, oracle: Boolean(policy.oracle) };
    for (const field of metricsOfInterest) {
      across[policy.name][field] = summarise(perSeed.map(entry =>
        entry.policies_frozen_model.find(row => row.policy === policy.name)[field]));
    }
    across[policy.name].share_at_minimum = summarise(perSeed.map(entry =>
      entry.policies_frozen_model.find(row => row.policy === policy.name).selected_frequency_share[1]));
  }
  across.model_plus_safety_retrained = { label: "Model plus safety, retrained on each seed", oracle: false };
  for (const field of metricsOfInterest) {
    across.model_plus_safety_retrained[field] = summarise(perSeed.map(entry => entry.model_plus_safety_retrained[field]));
  }
  across.model_plus_safety_retrained.share_at_minimum = summarise(perSeed.map(entry =>
    entry.model_plus_safety_retrained.selected_frequency_share[1]));

  // Paired per-seed contrasts. The pairing is exact because every policy is
  // replayed on the same cohort with the same random namespace.
  const paired = {};
  const contrast = (left, right, pick) => {
    const differences = perSeed.map(entry => pick(entry, left) - pick(entry, right));
    return Object.assign(summarise(differences), { wins: differences.filter(value => value > 0).length, seeds: differences.length });
  };
  const frozenPick = name => (entry, policy) => entry.policies_frozen_model.find(row => row.policy === policy).interactions_per_message;
  paired.model_minus_fixed_1 = contrast("model_plus_safety", "fixed_1", frozenPick());
  paired.model_minus_fixed_2 = contrast("model_plus_safety", "fixed_2", frozenPick());
  paired.model_minus_deterministic = contrast("model_plus_safety", "deterministic", frozenPick());
  paired.retrained_minus_deterministic = Object.assign(
    summarise(perSeed.map(entry => entry.model_plus_safety_retrained.interactions_per_message -
      entry.policies_frozen_model.find(row => row.policy === "deterministic").interactions_per_message)),
    { wins: perSeed.filter(entry => entry.model_plus_safety_retrained.interactions_per_message >
        entry.policies_frozen_model.find(row => row.policy === "deterministic").interactions_per_message).length,
      seeds: perSeed.length });

  return {
    generated_at: new Date().toISOString(),
    node_version: process.version,
    frozen_artifact: { path: path.relative(path.resolve(__dirname, ".."), FROZEN_ARTIFACT_PATH), model_id: frozen.model_id },
    design: {
      cohort: 300,
      weeks: WEEKS,
      frequency_range: [FREQUENCY_MIN, FREQUENCY_MAX],
      initial_frequency: 2,
      seeds,
      note: "Every policy starts each profile at 2 per week, so fixed_1 and fixed_3 record one initial change per profile. oracle_preferred reads a hidden simulation property and is an interpretation bound, not an implementable policy."
    },
    reproduction_check: reproduction,
    selector_sensitivity_published_seed: selectorSensitivity,
    published_seed: { seed: DEFAULT_SEED, policies: published.policies_frozen_model, model_plus_safety_retrained: published.model_plus_safety_retrained },
    across_seeds: across,
    paired_contrasts_interactions_per_message: paired,
    per_seed: perSeed
  };
}

function formatTable(report) {
  const lines = [];
  const pad = (value, width) => String(value).padEnd(width);
  const num = (value, digits) => Number(value).toFixed(digits);
  lines.push(`Reproduction of frozen policy_comparison on seed ${DEFAULT_SEED}: ${report.reproduction_check.matched ? "MATCHED" : "MISMATCH"}`);
  lines.push("");
  lines.push(`Published seed ${DEFAULT_SEED}`);
  lines.push(`${pad("policy", 26)} ${pad("msgs", 6)} ${pad("inter", 6)} ${pad("int/msg", 8)} ${pad("chg", 5)} ${pad("rev", 5)} ${pad("viol", 5)} share f=1/2/3`);
  for (const row of report.published_seed.policies) {
    const share = [1, 2, 3].map(key => `${num(100 * row.selected_frequency_share[key], 1)}%`).join(" ");
    lines.push(`${pad(row.policy, 26)} ${pad(row.delivered_messages, 6)} ${pad(row.ordinary_interactions, 6)} ${pad(num(row.interactions_per_message, 5), 8)} ${pad(row.frequency_changes, 5)} ${pad(row.direction_reversals, 5)} ${pad(row.constraint_violations, 5)} ${share}`);
  }
  lines.push("");
  lines.push(`Mean +/- sd over ${report.design.seeds.length} cohort seeds`);
  lines.push(`${pad("policy", 36)} ${pad("int/msg", 18)} ${pad("interactions", 16)} ${pad("messages", 15)} ${pad("reversals", 13)} share f=1`);
  for (const [name, entry] of Object.entries(report.across_seeds)) {
    const cell = (field, digits) => `${num(entry[field].mean, digits)}+/-${num(entry[field].sd, digits)}`;
    lines.push(`${pad(name, 36)} ${pad(cell("interactions_per_message", 4), 18)} ${pad(cell("ordinary_interactions", 0), 16)} ${pad(cell("delivered_messages", 0), 15)} ${pad(cell("direction_reversals", 0), 13)} ${num(100 * entry.share_at_minimum.mean, 1)}%`);
  }
  lines.push("");
  lines.push(`Selector sensitivity, seed ${DEFAULT_SEED}, frozen model`);
  lines.push(`${pad("selector", 22)} ${pad("tolerance", 11)} ${pad("msgs", 6)} ${pad("inter", 6)} ${pad("int/msg", 9)} ${pad("rev", 5)} share f=1`);
  for (const row of report.selector_sensitivity_published_seed) {
    lines.push(`${pad(row.selector, 22)} ${pad(row.near_best_tolerance === undefined ? "n/a" : row.near_best_tolerance, 11)} ${pad(row.delivered_messages, 6)} ${pad(row.ordinary_interactions, 6)} ${pad(num(row.interactions_per_message, 5), 9)} ${pad(row.direction_reversals, 5)} ${num(100 * row.share_at_minimum, 1)}%`);
  }
  lines.push("");
  lines.push("Paired per-seed contrasts, interactions per message");
  for (const [name, entry] of Object.entries(report.paired_contrasts_interactions_per_message)) {
    const sign = entry.mean >= 0 ? "+" : "";
    lines.push(`${pad(name, 36)} ${sign}${num(entry.mean, 4)} +/- ${num(entry.sd, 4)}   higher in ${entry.wins}/${entry.seeds} seeds`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const readOption = flag => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const report = run({ seeds: readOption("--seeds") });
  const target = readOption("--out") || path.resolve(__dirname, "../output/thesis/evidence_2026-09-20/policy_baselines.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${formatTable(report)}\n\nWrote ${target}\n`);
  if (!report.reproduction_check.matched) {
    process.stderr.write("Frozen policy comparison was not reproduced; treat the results above as unverified.\n");
    process.exitCode = 1;
  }
}

module.exports = { replay, trainOnSeed, run, POLICIES, selectFrequency };
