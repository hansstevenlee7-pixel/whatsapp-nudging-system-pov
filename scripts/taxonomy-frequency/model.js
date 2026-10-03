"use strict";

const schema = require("../../lifestyle_nudging_schema.json");
const { sigmoid } = require("../../landing/api/_lib/frequency-model");
const { dot, cholesky, solveCholesky, solveUpperFromLower, normalVector } = require("../frequency-comparison/core");

const CATEGORICAL = ["pillar", "category", "nudge_type", "tone_variant"];
const FEATURE_NAMES = ["candidate_frequency", "current_frequency", "recent_interaction_rate",
  "noninteraction_streak", "has_previous_interaction", "candidate_x_recent_rate", "candidate_x_streak",
  "recent_type_exposures", "recent_type_interaction_rate", "recent_pillar_exposures", "recent_pillar_interaction_rate",
  ...CATEGORICAL.flatMap(field => schema.$defs[field].enum.filter(Boolean).slice(1).map(token => `${field}=${token}`)),
  "candidate_x_type_recent_rate", "candidate_x_pillar_recent_rate"];
const PRIOR_PRECISION = 0.05;

function featureVector(row) {
  const frequency = Number(row.candidate_frequency), current = Number(row.current_frequency);
  const rate = Number(row.recent_interaction_rate), streak = Number(row.noninteraction_streak);
  const tr = Number(row.recent_type_interaction_rate), pr = Number(row.recent_pillar_interaction_rate);
  return [frequency, current, rate, streak, Number(row.has_previous_interaction), frequency * rate,
    frequency * streak, Number(row.recent_type_exposures), tr,
    Number(row.recent_pillar_exposures), pr,
    ...CATEGORICAL.flatMap(field => schema.$defs[field].enum.filter(Boolean).slice(1).map(token => Number(row[field] === token))),
    frequency * tr, frequency * pr];
}
function scaler(rows) {
  if (!rows.length) throw new Error("Empty training data");
  const data = rows.map(featureVector);
  const mean = FEATURE_NAMES.map((_, i) => data.reduce((s, x) => s + x[i], 0) / data.length);
  const scale = FEATURE_NAMES.map((_, i) => {
    const variance = data.reduce((s, x) => s + (x[i] - mean[i]) ** 2, 0) / data.length;
    return Math.sqrt(variance) || 1;
  });
  return { mean, scale };
}
function vector(row, scaling) {
  const raw = featureVector(row);
  return [1, ...raw.map((x, i) => (x - scaling.mean[i]) / scaling.scale[i])];
}
function aggregate(rows, scaling) {
  const groups = new Map();
  for (const row of rows) {
    const x = vector(row, scaling), key = JSON.stringify(x);
    if (!groups.has(key)) groups.set(key, { x, n: 0, y: 0 });
    const cell = groups.get(key); cell.n++; cell.y += Number(row.interacted_within_24h);
  }
  return [...groups.values()];
}
function posteriorTerms(beta, cells) {
  const d = beta.length;
  const grad = beta.map(v => PRIOR_PRECISION * v);
  const hessian = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => i === j ? PRIOR_PRECISION : 0));
  let objective = PRIOR_PRECISION * dot(beta, beta) / 2;
  for (const cell of cells) {
    const z = dot(beta, cell.x), p = sigmoid(z), err = cell.n * p - cell.y;
    objective += cell.n * (Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z)))) - cell.y * z;
    const weight = cell.n * p * (1 - p);
    for (let i = 0; i < d; i++) {
      grad[i] += err * cell.x[i];
      for (let j = 0; j < d; j++) hessian[i][j] += weight * cell.x[i] * cell.x[j];
    }
  }
  return { objective, grad, hessian };
}
function fit(rows, scaling) {
  const cells = aggregate(rows, scaling), d = FEATURE_NAMES.length + 1;
  let beta = Array(d).fill(0), converged = false, iterations = 0;
  for (; iterations < 100; iterations++) {
    const terms = posteriorTerms(beta, cells);
    if (Math.max(...terms.grad.map(Math.abs)) < 1e-6) { converged = true; break; }
    const step = solveCholesky(cholesky(terms.hessian), terms.grad);
    let factor = 1, next;
    while (factor >= 1e-8) {
      next = beta.map((v, i) => v - factor * step[i]);
      if (posteriorTerms(next, cells).objective <= terms.objective + 1e-10) break;
      factor /= 2;
    }
    if (factor < 1e-8) throw new Error("Taxonomy posterior line search failed");
    beta = next;
  }
  if (!converged) throw new Error("Taxonomy posterior did not converge");
  return { beta, scaling, precision_cholesky: cholesky(posteriorTerms(beta, cells).hessian),
    iterations, training_rows: rows.length, unique_cells: cells.length };
}
function draw(model, key) {
  const noise = solveUpperFromLower(model.precision_cholesky, normalVector(key, model.beta.length));
  return model.beta.map((v, i) => v + noise[i]);
}
function predict(model, row, coefficients = model.beta) {
  return sigmoid(dot(coefficients, vector(row, model.scaling)));
}
function scoreFrequency(model, current, priorEvents, slots, candidate, coefficients = model.beta) {
  const { historyFeatures } = require("./generate");
  const probabilities = slots.slice(0, candidate).map(slot => predict(model, {
    ...slot, ...historyFeatures(priorEvents, slot), candidate_frequency: candidate, current_frequency: current
  }, coefficients));
  return probabilities.reduce((s, p) => s + p, 0) / probabilities.length;
}
module.exports = { CATEGORICAL, FEATURE_NAMES, PRIOR_PRECISION, featureVector, scaler, vector,
  aggregate, posteriorTerms, fit, draw, predict, scoreFrequency };
