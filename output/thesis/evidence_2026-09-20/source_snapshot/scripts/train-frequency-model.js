"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { FEATURE_NAMES, featureVector, sigmoid, scoreFrequencies, recommendFrequency, recentHistory } = require("../landing/api/_lib/frequency-model");
const { DEFAULT_SEED, generateDataset, datasetHash, probability, stableUniform } = require("./generate-frequency-dataset");

function splitRows(rows) {
  const userNumber = row => Number(String(row.synthetic_user_id).split("_")[1]);
  return {
    train: rows.filter(row => userNumber(row) <= 240 && row.week <= 8),
    validation: rows.filter(row => userNumber(row) > 240 && userNumber(row) <= 270 && row.week >= 9 && row.week <= 10),
    test: rows.filter(row => userNumber(row) > 270 && row.week >= 11)
  };
}

function scaler(rows) {
  const vectors = rows.map(featureVector);
  const mean = FEATURE_NAMES.map((_, index) => vectors.reduce((sum, row) => sum + row[index], 0) / vectors.length);
  const scale = FEATURE_NAMES.map((_, index) => {
    const variance = vectors.reduce((sum, row) => sum + (row[index] - mean[index]) ** 2, 0) / vectors.length;
    return Math.sqrt(variance) || 1;
  });
  return { mean, scale };
}

function transformed(row, preprocessing) {
  return featureVector(row).map((value, index) => (value - preprocessing.mean[index]) / preprocessing.scale[index]);
}

function fit(rows, options = {}) {
  const preprocessing = scaler(rows); const dimensions = FEATURE_NAMES.length;
  const coefficients = Array(dimensions).fill(0); let intercept = 0;
  const rate = Number(options.learning_rate) || 0.08; const l2 = Number(options.l2) || 0.05;
  const iterations = Number(options.iterations) || 2200;
  const matrix = rows.map(row => transformed(row, preprocessing));
  const labels = rows.map(row => Number(row.interacted_within_24h));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradient = Array(dimensions).fill(0); let interceptGradient = 0;
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      let logit = intercept;
      for (let index = 0; index < dimensions; index += 1) logit += coefficients[index] * matrix[rowIndex][index];
      const error = sigmoid(logit) - labels[rowIndex]; interceptGradient += error;
      for (let index = 0; index < dimensions; index += 1) gradient[index] += error * matrix[rowIndex][index];
    }
    intercept -= rate * interceptGradient / matrix.length;
    for (let index = 0; index < dimensions; index += 1) {
      coefficients[index] -= rate * (gradient[index] / matrix.length + l2 * coefficients[index] / matrix.length);
    }
  }
  return { intercept, coefficients, feature_mean: preprocessing.mean, feature_scale: preprocessing.scale };
}

function predictions(model, rows) {
  return rows.map(row => {
    const vector = transformed(row, { mean: model.feature_mean, scale: model.feature_scale });
    return sigmoid(model.intercept + vector.reduce((sum, value, index) => sum + value * model.coefficients[index], 0));
  });
}

function prAuc(labels, probabilities) {
  const pairs = labels.map((label, index) => ({ label, probability: probabilities[index] })).sort((a, b) => b.probability - a.probability);
  const positives = labels.reduce((sum, value) => sum + value, 0) || 1;
  let tp = 0; let fp = 0; let previousRecall = 0; let area = 0;
  for (const pair of pairs) {
    if (pair.label) tp += 1; else fp += 1;
    const recall = tp / positives; const precision = tp / (tp + fp);
    area += (recall - previousRecall) * precision; previousRecall = recall;
  }
  return area;
}

function metrics(model, rows, constant) {
  const labels = rows.map(row => Number(row.interacted_within_24h)); const probabilities = predictions(model, rows);
  const safe = value => Math.min(1 - 1e-12, Math.max(1e-12, value));
  const brier = probabilities.reduce((sum, value, index) => sum + (value - labels[index]) ** 2, 0) / labels.length;
  const logLoss = probabilities.reduce((sum, value, index) => sum - labels[index] * Math.log(safe(value)) - (1 - labels[index]) * Math.log(safe(1 - value)), 0) / labels.length;
  const baselineBrier = labels.reduce((sum, value) => sum + (constant - value) ** 2, 0) / labels.length;
  return { rows: rows.length, positive_rows: labels.reduce((sum, value) => sum + value, 0), prevalence: labels.reduce((sum, value) => sum + value, 0) / labels.length,
    brier_score: brier, constant_brier_score: baselineBrier, log_loss: logLoss, pr_auc: prAuc(labels, probabilities) };
}

function simulatePolicy(users, model, policyName, seed = DEFAULT_SEED) {
  let delivered = 0; let interactions = 0; let changes = 0; let reversals = 0; let violations = 0;
  for (const user of users) {
    let current = 2; const outcomes = []; let previousDirection = "hold";
    for (let week = 1; week <= 12; week += 1) {
      const history = recentHistory(outcomes); let next = current;
      if (policyName === "fixed") next = 2;
      if (policyName === "deterministic") {
        if (history.noninteraction_streak >= 3) next = Math.max(1, current - 1);
        else if (history.has_recent_interaction && history.recent_interaction_rate >= 0.75) next = Math.min(3, current + 1);
      }
      if (policyName === "model") {
        const input = Object.assign({}, history, { current_frequency: current, frequency_min: 1, frequency_max: 3 });
        next = recommendFrequency(scoreFrequencies(model, input), input).recommended_frequency;
      }
      const direction = next > current ? "increase" : next < current ? "decrease" : "hold";
      if (direction !== "hold") changes += 1;
      if (direction !== "hold" && previousDirection !== "hold" && direction !== previousDirection) reversals += 1;
      if (next < 1 || next > 3 || Math.abs(next - current) > 1 || (next > current && !history.has_recent_interaction)) violations += 1;
      previousDirection = direction; current = next;
      for (let message = 1; message <= current; message += 1) {
        const liveHistory = recentHistory(outcomes); const p = probability(user, current, liveHistory);
        const outcome = stableUniform(seed, user.synthetic_user_id, week, message, "matched-policy") < p ? 1 : 0;
        outcomes.push(outcome); delivered += 1; interactions += outcome;
      }
    }
  }
  return { policy: policyName, delivered_messages: delivered, ordinary_interactions: interactions,
    interactions_per_message: interactions / delivered, messages_per_interaction: interactions ? delivered / interactions : null,
    frequency_changes: changes, direction_reversals: reversals, constraint_violations: violations };
}

function train() {
  const generated = generateDataset(); const split = splitRows(generated.rows); const fitted = fit(split.train);
  const prevalence = split.train.reduce((sum, row) => sum + row.interacted_within_24h, 0) / split.train.length;
  const model = {
    model_id: "frequency-logistic-v1", model_type: "regularized_logistic_regression", mode: "shadow",
    target: "ordinary_reply_or_tracked_link_visit_within_24h_of_confirmed_delivery",
    feature_names: FEATURE_NAMES, intercept: fitted.intercept, coefficients: fitted.coefficients,
    feature_mean: fitted.feature_mean, feature_scale: fitted.feature_scale,
    training: { seed: generated.seed, synthetic_users: generated.users.length, simulated_weeks: generated.weeks,
      dataset_sha256: datasetHash(generated.rows), train_rows: split.train.length, validation_rows: split.validation.length, test_rows: split.test.length,
      split: "users 001-240 weeks 1-8 train; users 241-270 weeks 9-10 validation; users 271-300 weeks 11-12 test" },
    evaluation: { validation: metrics(fitted, split.validation, prevalence), test: metrics(fitted, split.test, prevalence) }
  };
  model.policy_comparison = ["fixed", "deterministic", "model"].map(name => simulatePolicy(generated.users, model, name, generated.seed));
  return model;
}

if (require.main === module) {
  const model = train();
  const target = path.resolve(__dirname, "../landing/api/_models/frequency-logistic-v1.json");
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `${JSON.stringify(model, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ target, evaluation: model.evaluation, policy_comparison: model.policy_comparison }, null, 2)}\n`);
}

module.exports = { splitRows, scaler, fit, predictions, prAuc, metrics, simulatePolicy, train };
