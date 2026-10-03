"use strict";

const crypto = require("node:crypto");
const { recentHistory } = require("../landing/api/_lib/frequency-model");

const DEFAULT_SEED = 5128;

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ next >>> 15, next | 1);
    next ^= next + Math.imul(next ^ next >>> 7, next | 61);
    return ((next ^ next >>> 14) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const left = Math.max(random(), 1e-12); const right = random();
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function probability(user, frequency, history) {
  const distance = Math.abs(frequency - user.preferred_frequency);
  const excess = Math.max(0, frequency - user.preferred_frequency);
  const logit = user.baseline_logit - 0.75 * distance - user.fatigue * excess +
    0.9 * history.recent_interaction_rate - 0.22 * history.noninteraction_streak +
    0.25 * (history.has_previous_interaction ? 1 : 0);
  return 1 / (1 + Math.exp(-logit));
}

function cohort(count = 300, seed = DEFAULT_SEED) {
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => ({
    synthetic_user_id: `syn_${String(index + 1).padStart(3, "0")}`,
    preferred_frequency: 1 + Math.floor(random() * 3),
    baseline_logit: -0.7 + 0.65 * normal(random),
    fatigue: 0.25 + 0.55 * random()
  }));
}

function stableUniform(seed, userId, week, messageIndex, policy = "dataset") {
  const hash = crypto.createHash("sha256").update(`${seed}|${userId}|${week}|${messageIndex}|${policy}`).digest();
  return hash.readUInt32BE(0) / 4294967296;
}

function generateDataset(options = {}) {
  const seed = Number(options.seed) || DEFAULT_SEED;
  const users = cohort(Number(options.users) || 300, seed);
  const rows = [];
  for (const user of users) {
    const outcomes = []; let currentFrequency = 2;
    for (let week = 1; week <= (Number(options.weeks) || 12); week += 1) {
      const assigned = 1 + Math.floor(stableUniform(seed, user.synthetic_user_id, week, 0, "assignment") * 3);
      for (let message = 1; message <= assigned; message += 1) {
        const history = recentHistory(outcomes);
        const p = probability(user, assigned, history);
        const interacted = stableUniform(seed, user.synthetic_user_id, week, message) < p ? 1 : 0;
        rows.push({ synthetic_user_id: user.synthetic_user_id, week, message_index: message,
          candidate_frequency: assigned, current_frequency: currentFrequency,
          recent_interaction_rate: history.recent_interaction_rate,
          noninteraction_streak: history.noninteraction_streak,
          has_previous_interaction: history.has_previous_interaction ? 1 : 0,
          interacted_within_24h: interacted });
        outcomes.push(interacted);
      }
      currentFrequency = assigned;
    }
  }
  return { seed, users, weeks: Number(options.weeks) || 12, rows };
}

function datasetHash(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

if (require.main === module) {
  const generated = generateDataset();
  process.stdout.write(`${JSON.stringify({ seed: generated.seed, users: generated.users.length, weeks: generated.weeks,
    rows: generated.rows.length, positive_rows: generated.rows.filter(row => row.interacted_within_24h).length,
    dataset_sha256: datasetHash(generated.rows) }, null, 2)}\n`);
}

module.exports = { DEFAULT_SEED, mulberry32, cohort, probability, stableUniform, generateDataset, datasetHash };
