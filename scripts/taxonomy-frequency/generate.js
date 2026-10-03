"use strict";

// Version 2 synthetic environment. The clinician-owned behaviour taxonomy is
// observable; response affinities are private to the simulator. No patient data.
const crypto = require("node:crypto");
const schema = require("../../lifestyle_nudging_schema.json");
const { mulberry32, stableUniform } = require("../generate-frequency-dataset");

const VERSION = "taxonomy-frequency-synthetic-v2";
const DEFAULT_SEED = 5128;
const WEEKS = 12;
const USERS = 300;
const TYPES = schema.$defs.nudge_type.enum;
const TONES = schema.$defs.tone_variant.enum.filter(Boolean);
// Prespecified scenario coefficients, chosen for demonstrable heterogeneity.
// They are NOT estimated treatment effects or clinical literature parameters.
const SCENARIO_EFFECTS = {
  pillar: { nutrition: 0.04, physical_activity: 0.10, sleep: -0.05,
    stress_management: 0, substance_use: -0.10, social_connection: 0.08 },
  category: { increase: 0.04, reduce: -0.06, maintain: 0.02, avoid: -0.08, establish: 0.06 },
  nudge_type: { reminder: 0.10, reflection: 0, challenge: -0.18, affirmation: 0.16 },
  tone_variant: { encouraging: 0.07, neutral_informational: 0 }
};

// Illustrative approved actions, not generated medical advice. A plan selects
// two actions and three prewritten message slots from these templates.
const BEHAVIOURS = [
  { pillar: "nutrition", category: "increase", action_text: "Add a vegetable to one meal" },
  { pillar: "nutrition", category: "reduce", action_text: "Choose water instead of a sugary drink" },
  { pillar: "physical_activity", category: "increase", action_text: "Take a short walk" },
  { pillar: "physical_activity", category: "establish", action_text: "Plan a regular walking time" },
  { pillar: "sleep", category: "establish", action_text: "Keep a regular bedtime" },
  { pillar: "sleep", category: "reduce", action_text: "Put screens away before bed" },
  { pillar: "stress_management", category: "establish", action_text: "Take a short breathing break" },
  { pillar: "stress_management", category: "maintain", action_text: "Keep a daily relaxation pause" },
  { pillar: "substance_use", category: "avoid", action_text: "Keep the agreed smoke-free plan" },
  { pillar: "substance_use", category: "reduce", action_text: "Follow the agreed reduction plan" },
  { pillar: "social_connection", category: "increase", action_text: "Contact a friend or family member" },
  { pillar: "social_connection", category: "maintain", action_text: "Keep a regular social check-in" }
];

function validateTaxonomy() {
  const pillars = new Set(schema.$defs.pillar.enum), categories = new Set(schema.$defs.category.enum);
  if (new Set(BEHAVIOURS.map(b => b.pillar)).size !== pillars.size) throw new Error("Every pillar needs an illustrative action");
  if (new Set(BEHAVIOURS.map(b => b.category)).size !== categories.size) throw new Error("Every category needs an illustrative action");
  for (const item of BEHAVIOURS) if (!pillars.has(item.pillar) || !categories.has(item.category) || !item.action_text.trim()) throw new Error("Invalid behaviour template");
  if (TYPES.length !== 4 || TONES.length !== 2) throw new Error("Taxonomy changed: review simulator assumptions");
}

function normal(random) {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
}
function cohort(count = USERS, seed = DEFAULT_SEED) {
  validateTaxonomy();
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => {
    const chosen = Math.floor(random() * BEHAVIOURS.length);
    const alternate = (chosen + 1 + Math.floor(random() * (BEHAVIOURS.length - 1))) % BEHAVIOURS.length;
    const plan = [BEHAVIOURS[chosen], BEHAVIOURS[alternate]];
    return {
      synthetic_user_id: `syn_${String(index + 1).padStart(3, "0")}`,
      approved_behaviours: plan,
      preferred_frequency: 1 + Math.floor(random() * 3),
      baseline_logit: -1.0 + 0.62 * normal(random),
      fatigue: 0.22 + 0.58 * random(),
      hidden_type_affinity: TYPES.map(() => -0.35 + 0.7 * random()),
      hidden_pillar_affinity: plan.map(() => -0.25 + 0.5 * random()),
      hidden_tone_affinity: TONES.map(() => -0.15 + 0.3 * random())
    };
  });
}
function scheduledSlot(user, week, messageIndex, seed = DEFAULT_SEED) {
  // Fixed approved alternatives; both clinicians and policies may see all three
  // before selecting frequency, but neither may rewrite action or taxonomy.
  const behaviourIndex = Math.floor(stableUniform(seed, user.synthetic_user_id, week, messageIndex, "taxonomy-plan") * 2);
  const behaviour = user.approved_behaviours[behaviourIndex];
  const type = TYPES[Math.floor(stableUniform(seed, user.synthetic_user_id, week, messageIndex, "type-plan") * TYPES.length)];
  const tone = TONES[Math.floor(stableUniform(seed, user.synthetic_user_id, week, messageIndex, "tone-plan") * TONES.length)];
  return { message_index: messageIndex, ...behaviour, nudge_type: type, tone_variant: tone };
}
function historyFeatures(events, slot) {
  const last = events.slice(-4);
  const rate = values => values.length ? values.reduce((sum, e) => sum + e.interacted_within_24h, 0) / values.length : 0;
  const matchingType = last.filter(e => e.nudge_type === slot.nudge_type);
  const matchingPillar = last.filter(e => e.pillar === slot.pillar);
  let streak = 0;
  for (let i = last.length - 1; i >= 0 && !last[i].interacted_within_24h; i--) streak++;
  return { recent_interaction_rate: rate(last), noninteraction_streak: streak,
    has_previous_interaction: Number(last.some(e => e.interacted_within_24h)),
    recent_type_exposures: matchingType.length, recent_type_interaction_rate: rate(matchingType),
    recent_pillar_exposures: matchingPillar.length, recent_pillar_interaction_rate: rate(matchingPillar) };
}
function probability(user, frequency, slot, history) {
  const behaviourIndex = user.approved_behaviours.findIndex(b => b.action_text === slot.action_text);
  if (behaviourIndex < 0) throw new Error("Unapproved synthetic action");
  const distance = Math.abs(frequency - user.preferred_frequency);
  const excess = Math.max(0, frequency - user.preferred_frequency);
  const typeIndex = TYPES.indexOf(slot.nudge_type), toneIndex = TONES.indexOf(slot.tone_variant);
  const logit = user.baseline_logit - 0.52 * distance - user.fatigue * excess +
    SCENARIO_EFFECTS.pillar[slot.pillar] + SCENARIO_EFFECTS.category[slot.category] +
    SCENARIO_EFFECTS.nudge_type[slot.nudge_type] + SCENARIO_EFFECTS.tone_variant[slot.tone_variant] +
    user.hidden_type_affinity[typeIndex] + user.hidden_pillar_affinity[behaviourIndex] +
    user.hidden_tone_affinity[toneIndex] +
    0.62 * history.recent_interaction_rate - 0.16 * history.noninteraction_streak +
    0.31 * history.recent_type_interaction_rate + 0.18 * history.recent_pillar_interaction_rate -
    0.12 * Number(slot.nudge_type === "challenge" && frequency === 3);
  return 1 / (1 + Math.exp(-logit));
}
function generateDataset(options = {}) {
  const seed = Number(options.seed ?? DEFAULT_SEED);
  const weeks = Number(options.weeks ?? WEEKS);
  const users = cohort(Number(options.users ?? USERS), seed);
  const rows = [];
  for (const user of users) {
    const events = [];
    let currentFrequency = 2;
    for (let week = 1; week <= weeks; week++) {
      const assigned = 1 + Math.floor(stableUniform(seed, user.synthetic_user_id, week, 0, "taxonomy-frequency-assignment") * 3);
      for (let message = 1; message <= assigned; message++) {
        const slot = scheduledSlot(user, week, message, seed);
        const history = historyFeatures(events, slot);
        const interacted = Number(stableUniform(seed, user.synthetic_user_id, week, message, "taxonomy-response") < probability(user, assigned, slot, history));
        const row = { synthetic_user_id: user.synthetic_user_id, week, ...slot,
          candidate_frequency: assigned, current_frequency: currentFrequency,
          ...history, interacted_within_24h: interacted };
        rows.push(row); events.push(row);
      }
      currentFrequency = assigned;
    }
  }
  return { version: VERSION, seed, users, weeks, rows };
}
function datasetHash(rows) { return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }
if (require.main === module) {
  const data = generateDataset();
  process.stdout.write(JSON.stringify({ version: data.version, seed: data.seed, users: data.users.length,
    weeks: data.weeks, rows: data.rows.length,
    positive_rows: data.rows.filter(r => r.interacted_within_24h).length,
    dataset_sha256: datasetHash(data.rows) }, null, 2) + "\n");
}
module.exports = { VERSION, DEFAULT_SEED, WEEKS, USERS, TYPES, TONES, BEHAVIOURS, SCENARIO_EFFECTS,
  validateTaxonomy, cohort, scheduledSlot, historyFeatures, probability, generateDataset, datasetHash };
