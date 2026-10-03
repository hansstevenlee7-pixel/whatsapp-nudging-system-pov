"use strict";

// Tests the specific claim that taxonomy context adds useful prediction signal.
// Both models use the same rows, optimiser, prior, and temporal/user split.
const fs = require("node:fs");
const path = require("node:path");
const { generateDataset } = require("./generate");
const { scaler, vector, predict, fit, FEATURE_NAMES, PRIOR_PRECISION } = require("./model");
const { posteriorTerms } = require("./model");
const { cholesky, solveCholesky } = require("../frequency-comparison/core");
const { writeJSON } = require("../frequency-comparison/gemini");
const { SEEDS, OUT } = require("./local-run");

function baselineFit(rows, scaling) {
  // Only the seven original frequency/history features remain visible.
  const mask = Array.from({ length: FEATURE_NAMES.length }, (_, i) => i < 7);
  const cells = new Map();
  for (const row of rows) {
    const x = vector(row, scaling).map((v, i) => i === 0 || mask[i - 1] ? v : 0);
    const key = JSON.stringify(x);
    if (!cells.has(key)) cells.set(key, { x, n: 0, y: 0 });
    const c = cells.get(key); c.n++; c.y += row.interacted_within_24h;
  }
  const data = [...cells.values()];
  let beta = Array(FEATURE_NAMES.length + 1).fill(0), converged = false;
  for (let iteration = 0; iteration < 100; iteration++) {
    const terms = posteriorTerms(beta, data);
    if (Math.max(...terms.grad.map(Math.abs)) < 1e-6) { converged = true; break; }
    const step = solveCholesky(cholesky(terms.hessian), terms.grad);
    let factor = 1, next;
    while (factor >= 1e-8) {
      next = beta.map((v, i) => v - factor * step[i]);
      if (posteriorTerms(next, data).objective <= terms.objective + 1e-10) break;
      factor /= 2;
    }
    if (factor < 1e-8) throw new Error("Ablation line search failed");
    beta = next;
  }
  if (!converged) throw new Error("Ablation model did not converge");
  return { beta, scaling, mask };
}
function probability(model, row) {
  if (!model.mask) return predict(model, row);
  const values = vector(row, model.scaling).map((v, i) => i === 0 || model.mask[i - 1] ? v : 0);
  const z = values.reduce((s, v, i) => s + v * model.beta[i], 0);
  return 1 / (1 + Math.exp(-z));
}
function averagePrecision(rows, probabilities) {
  const ranked = rows.map((r, i) => [r.interacted_within_24h, probabilities[i]])
    .sort((a, b) => b[1] - a[1]);
  const positives = ranked.reduce((s, r) => s + r[0], 0);
  let tp = 0, fp = 0, sum = 0;
  for (const [label] of ranked) {
    if (label) { tp++; sum += tp / (tp + fp); } else fp++;
  }
  return sum / positives;
}
function metrics(rows, model) {
  const scores = rows.map(r => probability(model, r));
  return { rows: rows.length, positives: rows.reduce((s, r) => s + r.interacted_within_24h, 0),
    brier: scores.reduce((s, p, i) => s + (p - rows[i].interacted_within_24h) ** 2, 0) / rows.length,
    pr_auc: averagePrecision(rows, scores) };
}
function run() {
  const perSeed = [];
  for (const seed of SEEDS) {
    const data = generateDataset({ seed });
    const training = data.rows.filter(r => Number(r.synthetic_user_id.slice(4)) <= 240 && r.week <= 8);
    const validation = data.rows.filter(r => Number(r.synthetic_user_id.slice(4)) >= 241 && Number(r.synthetic_user_id.slice(4)) <= 270 && r.week >= 9 && r.week <= 10);
    const test = data.rows.filter(r => Number(r.synthetic_user_id.slice(4)) >= 271 && r.week >= 9 && r.week <= 12);
    const scale = scaler(training), full = fit(training, scale), reduced = baselineFit(training, scale);
    perSeed.push({ seed, train_rows: training.length,
      validation: { full: metrics(validation, full), frequency_only: metrics(validation, reduced) },
      test: { full: metrics(test, full), frequency_only: metrics(test, reduced) } });
  }
  const mean = values => values.reduce((s, x) => s + x, 0) / values.length;
  const across = Object.fromEntries(["validation", "test"].map(split => [split, {
    full_brier: mean(perSeed.map(r => r[split].full.brier)),
    frequency_only_brier: mean(perSeed.map(r => r[split].frequency_only.brier)),
    full_pr_auc: mean(perSeed.map(r => r[split].full.pr_auc)),
    frequency_only_pr_auc: mean(perSeed.map(r => r[split].frequency_only.pr_auc)),
    brier_improved_seeds: perSeed.filter(r => r[split].full.brier < r[split].frequency_only.brier).length,
    pr_auc_improved_seeds: perSeed.filter(r => r[split].full.pr_auc > r[split].frequency_only.pr_auc).length
  }]));
  const result = { version: "taxonomy-frequency-ablation-v1", seed_count: SEEDS.length,
    shared_prior_precision: PRIOR_PRECISION,
    full_feature_names: FEATURE_NAMES, reduced_feature_names: FEATURE_NAMES.slice(0, 7),
    note: "Predictive ablation on the new synthetic generator; tests whether added taxonomy context helps predict logged outcomes, not whether it improves sequential frequency choices.",
    across_seeds: across, per_seed: perSeed };
  writeJSON(path.join(OUT, "taxonomy_ablation.json"), result);
  return result;
}
if (require.main === module) console.log(JSON.stringify(run().across_seeds, null, 2));
module.exports = { baselineFit, probability, averagePrecision, metrics, run };
