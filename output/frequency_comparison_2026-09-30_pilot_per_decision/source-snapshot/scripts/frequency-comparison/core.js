"use strict";

// Experimental policies only: no application imports that send or persist messages.
const crypto = require("node:crypto");
const { featureVector, sigmoid, recentHistory } = require("../../landing/api/_lib/frequency-model");
const { scaler } = require("../train-frequency-model");
const { mulberry32 } = require("../generate-frequency-dataset");

const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const fields = ["current_frequency", "recent_interaction_rate", "noninteraction_streak", "has_previous_interaction", "candidate_frequency"];

function publicContext(current, outcomes) {
  const h = recentHistory(outcomes);
  return { current_frequency: current, recent_interaction_rate: h.recent_interaction_rate,
    noninteraction_streak: h.noninteraction_streak, has_previous_interaction: Number(h.has_previous_interaction) };
}

function eligible(context) {
  return [1, 2, 3].filter(f => Math.abs(f - context.current_frequency) <= 1 &&
    (f <= context.current_frequency || context.recent_interaction_rate > 0));
}

function applySafety(proposed, context) {
  const valid = Number.isInteger(proposed) && eligible(context).includes(proposed);
  return { frequency: valid ? proposed : context.current_frequency, rejected: !valid };
}

// Exact feature-cell counts are sufficient statistics for these logistic fits.
// Every method receives the same cells: no extra raw history is given to Gemini.
function aggregate(rows) {
  const groups = new Map();
  for (const row of rows) {
    const values = fields.map(f => Number(row[f]));
    const key = JSON.stringify(values);
    if (!groups.has(key)) groups.set(key, [...values, 0, 0]);
    const g = groups.get(key); g[5]++; g[6] += Number(row.interacted_within_24h);
  }
  return [...groups.values()].sort((a, b) => {
    for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
}

function fromCell(cell) { return Object.fromEntries(fields.map((f, i) => [f, cell[i]])); }
function vector(row, scaling) {
  return [1, ...featureVector(row).map((x, i) => (x - scaling.mean[i]) / scaling.scale[i])];
}
function trainingMatrix(cells, scaling) {
  return cells.map(cell => ({ x: vector(fromCell(cell), scaling), n: cell[5], y: cell[6] }));
}

// Same 2,200 full-batch gradient updates, rate and coefficient penalty as the
// existing LR implementation, using exact aggregated cells and fixed train scaling.
function fitLR(cells, scaling) {
  const data = trainingMatrix(cells, scaling);
  const count = data.reduce((s, d) => s + d.n, 0);
  if (!count) throw new Error("Empty training data");
  const beta = Array(8).fill(0);
  for (let step = 0; step < 2200; step++) {
    const grad = Array(8).fill(0);
    for (const d of data) {
      const error = d.n * sigmoid(dot(beta, d.x)) - d.y;
      for (let j = 0; j < 8; j++) grad[j] += error * d.x[j];
    }
    for (let j = 0; j < 8; j++) beta[j] -= 0.08 * (grad[j] + (j ? 0.05 * beta[j] : 0)) / count;
  }
  return { beta, scaling };
}

function cholesky(matrix) {
  const n = matrix.length, lower = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let sum = matrix[i][j];
    for (let k = 0; k < j; k++) sum -= lower[i][k] * lower[j][k];
    if (i === j) {
      if (!(sum > 0)) throw new Error("Posterior precision is not positive definite");
      lower[i][j] = Math.sqrt(sum);
    } else lower[i][j] = sum / lower[j][j];
  }
  return lower;
}
function solveUpperFromLower(lower, rhs) {
  const x = Array(rhs.length).fill(0);
  for (let i = rhs.length - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < rhs.length; j++) sum -= lower[j][i] * x[j];
    x[i] = sum / lower[i][i];
  }
  return x;
}
function solveCholesky(lower, rhs) {
  const y = Array(rhs.length).fill(0);
  for (let i = 0; i < rhs.length; i++) {
    let sum = rhs[i];
    for (let j = 0; j < i; j++) sum -= lower[i][j] * y[j];
    y[i] = sum / lower[i][i];
  }
  return solveUpperFromLower(lower, y);
}
function posteriorTerms(beta, data, precision = 0.05) {
  const grad = beta.map(v => precision * v);
  const hessian = beta.map((_, i) => beta.map((__, j) => i === j ? precision : 0));
  let objective = precision * dot(beta, beta) / 2;
  for (const d of data) {
    const z = dot(beta, d.x), p = sigmoid(z), error = d.n * p - d.y;
    objective += d.n * (Math.max(0, z) + Math.log1p(Math.exp(-Math.abs(z)))) - d.y * z;
    const weight = d.n * p * (1 - p);
    for (let i = 0; i < 8; i++) {
      grad[i] += error * d.x[i];
      for (let j = 0; j < 8; j++) hessian[i][j] += weight * d.x[i] * d.x[j];
    }
  }
  return { objective, grad, hessian };
}
function fitBandit(cells, scaling) {
  const data = trainingMatrix(cells, scaling);
  let beta = Array(8).fill(0), converged = false, iterations = 0;
  for (; iterations < 100; iterations++) {
    const terms = posteriorTerms(beta, data);
    if (Math.max(...terms.grad.map(Math.abs)) < 1e-6) { converged = true; break; }
    const step = solveCholesky(cholesky(terms.hessian), terms.grad);
    let rate = 1, next;
    while (rate >= 1e-8) {
      next = beta.map((v, i) => v - rate * step[i]);
      if (posteriorTerms(next, data).objective <= terms.objective + 1e-10) break;
      rate /= 2;
    }
    if (rate < 1e-8) throw new Error("Bandit posterior line search failed");
    beta = next;
  }
  if (!converged) throw new Error("Bandit posterior did not converge");
  return { beta, scaling, precision_cholesky: cholesky(posteriorTerms(beta, data).hessian), iterations, converged };
}
function normalVector(seed, size) {
  const random = mulberry32(parseInt(sha(seed).slice(0, 8), 16));
  return Array.from({ length: size }, () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random()));
}
function selectModel(model, context, sampleKey = null) {
  let beta = model.beta;
  if (sampleKey !== null) {
    const noise = solveUpperFromLower(model.precision_cholesky, normalVector(sampleKey, 8));
    beta = beta.map((v, i) => v + noise[i]);
  }
  const scores = eligible(context).map(f => ({ frequency: f,
    score: sigmoid(dot(beta, vector({ ...context, candidate_frequency: f }, model.scaling))) }));
  scores.sort((a, b) => b.score - a.score || a.frequency - b.frequency);
  return { proposed_frequency: scores[0].frequency, scores };
}
function scalingFromTraining(rows) { return scaler(rows); }

module.exports = { sha, dot, fields, publicContext, eligible, applySafety, aggregate, vector,
  trainingMatrix, fitLR, fitBandit, selectModel, scalingFromTraining, cholesky,
  solveCholesky, solveUpperFromLower, posteriorTerms, normalVector };
