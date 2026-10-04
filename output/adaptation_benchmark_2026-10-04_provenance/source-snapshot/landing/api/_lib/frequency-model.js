"use strict";

const FEATURE_NAMES = [
  "candidate_frequency",
  "current_frequency",
  "recent_interaction_rate",
  "noninteraction_streak",
  "has_previous_interaction",
  "candidate_x_recent_rate",
  "candidate_x_noninteraction_streak"
];

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value); return exp / (1 + exp);
}

function normalizeInput(input = {}) {
  const candidate = clamp(Math.round(Number(input.candidate_frequency) || 1), 1, 3);
  const current = clamp(Math.round(Number(input.current_frequency) || 2), 1, 3);
  const rate = clamp(Number(input.recent_interaction_rate) || 0, 0, 1);
  const streak = clamp(Math.round(Number(input.noninteraction_streak) || 0), 0, 4);
  const hasPrevious = input.has_previous_interaction ? 1 : 0;
  return { candidate, current, rate, streak, hasPrevious };
}

function featureVector(input) {
  const value = normalizeInput(input);
  return [value.candidate, value.current, value.rate, value.streak, value.hasPrevious,
    value.candidate * value.rate, value.candidate * value.streak];
}

function validateArtifact(artifact) {
  if (!artifact || artifact.model_type !== "regularized_logistic_regression") throw new Error("Frequency model artifact is invalid");
  if (JSON.stringify(artifact.feature_names) !== JSON.stringify(FEATURE_NAMES)) throw new Error("Frequency model feature contract does not match");
  if (!Array.isArray(artifact.coefficients) || artifact.coefficients.length !== FEATURE_NAMES.length) throw new Error("Frequency model coefficients are invalid");
  if (!Array.isArray(artifact.feature_mean) || !Array.isArray(artifact.feature_scale) ||
      artifact.feature_mean.length !== FEATURE_NAMES.length || artifact.feature_scale.length !== FEATURE_NAMES.length) {
    throw new Error("Frequency model preprocessing is invalid");
  }
  return artifact;
}

function predictProbability(artifact, input) {
  const model = validateArtifact(artifact);
  const raw = featureVector(input);
  let logit = Number(model.intercept) || 0;
  for (let i = 0; i < raw.length; i += 1) {
    const scale = Number(model.feature_scale[i]) || 1;
    logit += Number(model.coefficients[i]) * ((raw[i] - Number(model.feature_mean[i])) / scale);
  }
  return sigmoid(logit);
}

function scoreFrequencies(artifact, input = {}) {
  const min = clamp(Math.round(Number(input.frequency_min) || 1), 1, 3);
  const max = clamp(Math.round(Number(input.frequency_max) || 3), min, 3);
  const scores = {};
  for (let frequency = min; frequency <= max; frequency += 1) {
    scores[frequency] = predictProbability(artifact, Object.assign({}, input, { candidate_frequency: frequency }));
  }
  return scores;
}

function recommendFrequency(scores, input = {}) {
  const current = clamp(Math.round(Number(input.current_frequency) || 2), 1, 3);
  const entries = Object.entries(scores || {}).map(([frequency, probability]) => [Number(frequency), Number(probability)])
    .filter(([frequency, probability]) => Number.isInteger(frequency) && frequency >= 1 && frequency <= 3 && Number.isFinite(probability));
  if (!entries.length) return { recommended_frequency: current, direction: "hold", reason: "no_eligible_candidate", best_probability: null };
  const bestProbability = Math.max(...entries.map(item => item[1]));
  const tolerance = Number.isFinite(Number(input.near_best_tolerance)) ? Number(input.near_best_tolerance) : 0.05;
  const nearBest = entries.filter(item => bestProbability - item[1] <= tolerance).sort((a, b) => a[0] - b[0]);
  let desired = nearBest[0][0];
  desired = clamp(desired, current - 1, current + 1);
  let reason = "lowest_near_best_candidate";
  if (desired > current && !input.has_recent_interaction) {
    desired = current; reason = "increase_blocked_without_recent_interaction";
  }
  const direction = desired > current ? "increase" : desired < current ? "decrease" : "hold";
  if (direction === "hold" && reason === "lowest_near_best_candidate") reason = "current_frequency_remains_near_best";
  return { recommended_frequency: desired, direction, reason, best_probability: bestProbability };
}

function recentHistory(outcomes, limit = 4) {
  const values = (outcomes || []).slice(-limit).map(value => value ? 1 : 0);
  let streak = 0;
  for (let i = values.length - 1; i >= 0 && values[i] === 0; i -= 1) streak += 1;
  return {
    recent_interaction_rate: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    noninteraction_streak: Math.min(4, streak),
    has_previous_interaction: values.includes(1),
    has_recent_interaction: values.includes(1)
  };
}

function ordinaryReply(body) {
  const value = String(body || "").trim().toUpperCase();
  return Boolean(value) && !["STOP", "PAUSE", "MORE", "LESS"].includes(value);
}

module.exports = { FEATURE_NAMES, clamp, sigmoid, featureVector, validateArtifact, predictProbability,
  scoreFrequencies, recommendFrequency, recentHistory, ordinaryReply };
