"use strict";

// Single source of truth for the locked taxonomy and the clinician-editable Action.
// Pillar and category stay fixed enumerations (the validation gate still rejects
// anything outside them); the concrete execution step is free text owned by the
// clinician, so it is normalized and bounded here rather than enumerated.
const schema = require("../../lifestyle_nudging_schema.json");
const { httpError } = require("./http");

const ACTION_MAX_LENGTH = 1024;
const PILLARS = new Set(schema.$defs.pillar.enum);
const CATEGORIES = new Set(schema.$defs.category.enum);
const NUDGE_TYPES = new Set(schema.$defs.nudge_type.enum);
const LEGACY_ACTION_LABELS = Object.fromEntries(
  Object.entries(schema.x_legacy_action_labels).filter(([token]) => token !== "description")
);

// Trim only. Internal spacing and punctuation are the clinician's wording and must
// survive save → reload → materialization byte for byte.
function normalizeAction(value) {
  return String(value == null ? "" : value).trim();
}

// Readable text for a row written before action_text existed. Falls back to
// de-tokenizing an unrecognised legacy value rather than showing a raw enum.
function legacyActionText(token) {
  const key = String(token == null ? "" : token).trim();
  if (!key) return "";
  if (LEGACY_ACTION_LABELS[key]) return LEGACY_ACTION_LABELS[key];
  const words = key.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// Monitoring read path: real action_text wins, legacy target_behavior is converted
// on the fly. Never writes back — migration happens when a clinician next saves.
function resolveActionText(row, prescription) {
  const stored = normalizeAction(row && row.action_text);
  if (stored) return stored;
  const legacy = (row && row.target_behavior) || (prescription && prescription.target_behavior);
  return legacyActionText(legacy);
}

function assertAction(value, label) {
  const action = normalizeAction(value);
  if (!action) throw httpError(400, `${label} is required`);
  if (action.length > ACTION_MAX_LENGTH) throw httpError(400, `${label} must be ${ACTION_MAX_LENGTH} characters or fewer`);
  return action;
}

module.exports = {
  ACTION_MAX_LENGTH, PILLARS, CATEGORIES, NUDGE_TYPES, LEGACY_ACTION_LABELS,
  normalizeAction, legacyActionText, resolveActionText, assertAction
};
