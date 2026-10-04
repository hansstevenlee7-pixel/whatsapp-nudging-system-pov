"use strict";

// Calibration and uncertainty for the frozen frequency model (thesis §5.3).
//
// Post hoc, written on 4 October 2026 after the stored Brier scores were known.
// The 28 August scope lock listed a calibration curve and interaction rate by
// predicted-probability band among the predictive measures; neither had been
// produced. Everything here is descriptive: the frozen artifact is read, not
// refitted, and nothing estimated on validation or test outcomes changes any
// prediction, threshold or policy.
//
// Declared before running:
//   - reliability: five equal-count bins of predicted probability per split,
//     observed rate with a Wilson 95% interval;
//   - calibration-in-the-large (mean predicted minus observed rate) and the
//     logistic calibration intercept and slope (Van Calster et al. 2019);
//   - uncertainty: profile-cluster bootstrap (whole synthetic profiles are
//     resampled, because each contributes several rows), 10,000 resamples,
//     seed 5128, percentile 95% intervals for model Brier, constant Brier,
//     their difference, the Brier skill score, calibration-in-the-large and
//     slope.
//
//   node scripts/frozen-model-calibration/run.js output/frozen_model_calibration_2026-10-04

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { generateDataset, datasetHash, mulberry32 } = require("../generate-frequency-dataset");
const { splitRows, predictions, metrics } = require("../train-frequency-model");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(ROOT, process.argv[2] || "output/frozen_model_calibration");
const MODEL_PATH = path.join(ROOT, "landing/api/_models/frequency-logistic-v1.json");
const BINS = 5; const RESAMPLES = 10000; const SEED = 5128;
const sha = buffer => crypto.createHash("sha256").update(buffer).digest("hex");
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const logit = p => Math.log(Math.min(1 - 1e-12, Math.max(1e-12, p)) / (1 - Math.min(1 - 1e-12, Math.max(1e-12, p))));

function wilson(successes, n, z = 1.959964) {
  const p = successes / n; const denominator = 1 + z * z / n;
  const centre = (p + z * z / (2 * n)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
  return [centre - half, centre + half];
}

// Two-parameter logistic regression of y on logit(p) by Newton-Raphson.
function calibrationLine(labels, probabilities) {
  const x = probabilities.map(logit); let a = 0; let b = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let g0 = 0; let g1 = 0; let h00 = 0; let h01 = 0; let h11 = 0;
    for (let i = 0; i < x.length; i += 1) {
      const p = 1 / (1 + Math.exp(-(a + b * x[i]))); const w = p * (1 - p); const r = labels[i] - p;
      g0 += r; g1 += r * x[i]; h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01; if (Math.abs(det) < 1e-12) return { intercept: null, slope: null };
    const da = (h11 * g0 - h01 * g1) / det; const db = (h00 * g1 - h01 * g0) / det;
    a += da; b += db; if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return { intercept: a, slope: b };
}

function summary(labels, probabilities, constant) {
  const brier = mean(probabilities.map((p, i) => (p - labels[i]) ** 2));
  const constantBrier = mean(labels.map(y => (constant - y) ** 2));
  const line = calibrationLine(labels, probabilities);
  return { brier, constant_brier: constantBrier, difference: constantBrier - brier, skill: 1 - brier / constantBrier,
    calibration_in_the_large: mean(probabilities) - mean(labels), calibration_intercept: line.intercept, calibration_slope: line.slope };
}

function reliability(labels, probabilities) {
  const order = probabilities.map((p, i) => i).sort((left, right) => probabilities[left] - probabilities[right] || left - right);
  return Array.from({ length: BINS }, (_, bin) => {
    const members = order.slice(Math.round(bin * order.length / BINS), Math.round((bin + 1) * order.length / BINS));
    const positives = members.reduce((sum, i) => sum + labels[i], 0);
    const [low, high] = wilson(positives, members.length);
    return { bin: bin + 1, rows: members.length, positives, mean_predicted: mean(members.map(i => probabilities[i])),
      observed_rate: positives / members.length, observed_wilson_95: [low, high],
      predicted_range: [Math.min(...members.map(i => probabilities[i])), Math.max(...members.map(i => probabilities[i]))] };
  });
}

function percentile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const position = (sorted.length - 1) * q; const lower = Math.floor(position); const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function bootstrap(rows, probabilities, constant, random) {
  const byProfile = new Map();
  rows.forEach((row, i) => {
    const key = row.synthetic_user_id; if (!byProfile.has(key)) byProfile.set(key, []);
    byProfile.get(key).push(i);
  });
  const profiles = [...byProfile.keys()].sort(); const draws = [];
  for (let r = 0; r < RESAMPLES; r += 1) {
    const indices = [];
    for (let k = 0; k < profiles.length; k += 1) indices.push(...byProfile.get(profiles[Math.floor(random() * profiles.length)]));
    const labels = indices.map(i => Number(rows[i].interacted_within_24h));
    if (!labels.some(Boolean) || labels.every(Boolean)) continue;
    draws.push(summary(labels, indices.map(i => probabilities[i]), constant));
  }
  const keys = Object.keys(draws[0]);
  return { profiles: profiles.length, resamples_used: draws.length,
    percentile_95: Object.fromEntries(keys.map(key => [key, [percentile(draws.map(d => d[key]), 0.025), percentile(draws.map(d => d[key]), 0.975)]])),
    share_model_better_than_constant: draws.filter(d => d.difference > 0).length / draws.length };
}

const modelBuffer = fs.readFileSync(MODEL_PATH); const model = JSON.parse(modelBuffer);
const generated = generateDataset(); const split = splitRows(generated.rows);
const hash = datasetHash(generated.rows);
if (hash !== model.training.dataset_sha256) throw new Error(`Dataset hash ${hash} does not match the frozen artifact`);
const constant = mean(split.train.map(row => Number(row.interacted_within_24h)));
const random = mulberry32(SEED);
const createdAt = new Date().toISOString();
const result = { status: "post hoc descriptive analysis; frozen artifact read, not refitted",
  model_sha256: sha(modelBuffer), dataset_sha256: hash, training_prevalence_constant: constant, bins: BINS, resamples: RESAMPLES, seed: SEED, splits: {} };
for (const name of ["validation", "test"]) {
  const rows = split[name]; const labels = rows.map(row => Number(row.interacted_within_24h));
  const probabilities = predictions(model, rows);
  const stored = model.evaluation[name]; const reproduced = metrics(model, rows, constant);
  if (Math.abs(reproduced.brier_score - stored.brier_score) > 1e-12 || Math.abs(reproduced.constant_brier_score - stored.constant_brier_score) > 1e-12) {
    throw new Error(`${name}: reproduced Brier scores differ from the frozen artifact`);
  }
  result.splits[name] = { rows: rows.length, positives: labels.reduce((s, y) => s + y, 0),
    reproduces_stored_metrics: true, point: summary(labels, probabilities, constant),
    prediction_range: [Math.min(...probabilities), Math.max(...probabilities)],
    reliability: reliability(labels, probabilities), bootstrap: bootstrap(rows, probabilities, constant, random),
    predictions: probabilities.map((p, i) => ({ synthetic_user_id: rows[i].synthetic_user_id, week: rows[i].week, probability: p, label: labels[i] })) };
}

fs.mkdirSync(OUT, { recursive: true });
const resultText = `${JSON.stringify(result, null, 2)}\n`;
fs.writeFileSync(path.join(OUT, "results.json"), resultText);
fs.writeFileSync(path.join(OUT, "results.sha256"), `${sha(Buffer.from(resultText))}  results.json\n`);

const f = (value, digits = 3) => value == null ? "—" : Number(value).toFixed(digits);
const ci = pair => `${f(pair[0])} to ${f(pair[1])}`;
const lines = ["# Frozen model calibration and uncertainty (4 October 2026)", "",
  "Post hoc descriptive analysis of `landing/api/_models/frequency-logistic-v1.json` (read, not refitted). Declared method: see the header of `scripts/frozen-model-calibration/run.js`. Stored Brier scores are reproduced exactly before anything else is computed.", "",
  `Model SHA-256 \`${result.model_sha256}\`; dataset SHA-256 \`${hash}\`; constant comparator = training prevalence ${f(constant, 4)}.`, "",
  "| Split | Rows (positives) | Model Brier [95% CI] | Constant Brier [95% CI] | Difference [95% CI] | Skill [95% CI] | Resamples with model better |",
  "|---|---|---|---|---|---|---|"];
for (const [name, s] of Object.entries(result.splits)) {
  const b = s.bootstrap.percentile_95;
  lines.push(`| ${name} | ${s.rows} (${s.positives}) | ${f(s.point.brier)} [${ci(b.brier)}] | ${f(s.point.constant_brier)} [${ci(b.constant_brier)}] | ${f(s.point.difference)} [${ci(b.difference)}] | ${f(s.point.skill)} [${ci(b.skill)}] | ${(100 * s.bootstrap.share_model_better_than_constant).toFixed(1)}% |`);
}
lines.push("", "| Split | Calibration-in-the-large [95% CI] | Calibration intercept | Calibration slope [95% CI] | Prediction range |", "|---|---|---|---|---|");
for (const [name, s] of Object.entries(result.splits)) {
  const b = s.bootstrap.percentile_95;
  lines.push(`| ${name} | ${f(s.point.calibration_in_the_large)} [${ci(b.calibration_in_the_large)}] | ${f(s.point.calibration_intercept, 2)} | ${f(s.point.calibration_slope, 2)} [${f(b.calibration_slope[0], 2)} to ${f(b.calibration_slope[1], 2)}] | ${f(s.prediction_range[0])} to ${f(s.prediction_range[1])} |`);
}
for (const [name, s] of Object.entries(result.splits)) {
  lines.push("", `## Reliability, ${name} (five equal-count bins)`, "", "| Bin | Rows | Positives | Mean predicted | Observed rate | Wilson 95% |", "|---|---|---|---|---|---|");
  for (const bin of s.reliability) lines.push(`| ${bin.bin} | ${bin.rows} | ${bin.positives} | ${f(bin.mean_predicted)} | ${f(bin.observed_rate)} | ${ci(bin.observed_wilson_95)} |`);
}
lines.push("", `Bootstrap: whole synthetic profiles resampled with replacement (${result.splits.test.bootstrap.profiles} per split), ${RESAMPLES} resamples, seed ${SEED}; resamples with no positive or no negative row are skipped and counted in results.json. With about 20 positives per split, the bin-level rates and the slope are imprecise; they describe this sample and are not a calibration claim across probability ranges.`);
fs.writeFileSync(path.join(OUT, "REPORT.md"), `${lines.join("\n")}\n`);
fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify({ created_at: createdAt, node: process.version,
  script_sha256: sha(fs.readFileSync(__filename)), model_sha256: result.model_sha256, dataset_sha256: hash,
  network: "none", model_retraining: "none", results_sha256: sha(Buffer.from(resultText)) }, null, 2)}\n`);
process.stdout.write(`${lines.join("\n")}\n`);
