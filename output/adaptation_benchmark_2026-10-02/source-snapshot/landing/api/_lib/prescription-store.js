"use strict";

// Clinician-owned prescription CRUD, written straight to Google Sheets.
//
// The portal's reason for existing is human-in-the-loop correction: Workflow A's
// LLM parse is a draft, and a doctor must be able to fix a wrong pillar, an
// invented category, or a mis-read frequency without touching the spreadsheet.
//
// Layered above clinical-data (read/patient) and schedule-store (schedule
// mutation) rather than inside either. schedule-store already requires
// clinical-data, so putting the archive cascade — which needs melbourneIso() —
// into clinical-data would create a CommonJS cycle and leave loadClinicalData
// undefined at call time depending on require order.
const crypto = require("node:crypto");
const { httpError } = require("./http");
const { loadClinicalData, batchWrite, operation, isArchivedPrescription } = require("./clinical-data");
const { melbourneIso, historicalNudge, historicalState } = require("./schedule-store");
const { PILLARS, CATEGORIES, NUDGE_TYPES, assertAction, normalizeAction } = require("./taxonomy");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TONES = new Set(["encouraging", "neutral_informational"]);
const TEMPLATES = new Set(["health_plan_reminder", "hello_world"]);
const RAW_TEXT_MAX = 4000;
const MESSAGE_MAX = 1024;

// Sheets returns FORMATTED_VALUE, so a number written as 3 reads back as "3".
// Every verification compares through this.
function same(a, b) {
  return String(a == null ? "" : a) === String(b == null ? "" : b);
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function wholeNumber(value, label, min, max) {
  const number = Number(String(value == null ? "" : value).trim());
  if (!Number.isInteger(number) || number < min || number > max) {
    throw httpError(400, `${label} must be a whole number between ${min} and ${max}`);
  }
  return number;
}

function assertEnum(value, allowed, label) {
  const clean = text(value);
  if (!allowed.has(clean)) throw httpError(400, `${label} is not a recognised value`);
  return clean;
}

function assertIssuedDate(value) {
  const clean = text(value);
  if (!DATE_RE.test(clean)) throw httpError(400, "issued_date must be a YYYY-MM-DD date");
  if (clean > melbourneIso()) throw httpError(400, "issued_date cannot be in the future");
  return clean;
}

function clean(row) {
  const copy = Object.assign({}, row);
  delete copy.row_number;
  return copy;
}

function findPrescription(rows, userId, prescriptionId) {
  const found = rows.find(row => String(row.user_id) === String(userId) && String(row.prescription_id) === String(prescriptionId));
  if (!found) throw httpError(404, "Prescription not found");
  return found;
}

async function createPrescription(userId, doctorId, fields) {
  const pillar = assertEnum(fields.pillar, PILLARS, "pillar");
  const category = assertEnum(fields.category, CATEGORIES, "category");
  const nudgeType = assertEnum(fields.nudge_type, NUDGE_TYPES, "nudge_type");
  const tone = assertEnum(fields.tone_variant || "encouraging", TONES, "tone_variant");
  const template = assertEnum(fields.template_name || "health_plan_reminder", TEMPLATES, "template_name");
  const frequency = wholeNumber(fields.frequency_per_week, "frequency_per_week", 1, 7);
  const duration = wholeNumber(fields.duration_weeks, "duration_weeks", 1, 52);
  const issuedDate = assertIssuedDate(fields.issued_date);
  const rawText = text(fields.prescription_raw_text);
  const action = assertAction(fields.action_text, "action_text");
  const message = text(fields.message_body);
  const messageAlt = text(fields.message_body_alt);
  const time = text(fields.scheduled_time) || "09:00";
  if (!rawText) throw httpError(400, "prescription_raw_text is required");
  if (rawText.length > RAW_TEXT_MAX) throw httpError(400, `prescription_raw_text must be ${RAW_TEXT_MAX} characters or fewer`);
  if (!message) throw httpError(400, "message_body is required");
  if (message.length > MESSAGE_MAX) throw httpError(400, `message_body must be ${MESSAGE_MAX} characters or fewer`);
  if (messageAlt.length > MESSAGE_MAX) throw httpError(400, `message_body_alt must be ${MESSAGE_MAX} characters or fewer`);
  if (!TIME_RE.test(time)) throw httpError(400, "scheduled_time must be HH:MM");

  // Server-generated, always. Accepting a client id would let a retry or a forged
  // request collide with an existing row.
  const prescriptionId = `rx_${crypto.randomUUID()}`;
  const nudgeId = `ndg_${crypto.randomUUID()}`;
  const data = await loadClinicalData(["prescriptions", "nudges", "schedule_state"]);

  // pillar and category here are the DEFAULTS new behaviours start from, and the
  // fallback for a row that carries none. They do not constrain what the
  // prescription's behaviours may later be re-filed as.
  const prescription = {
    prescription_id: prescriptionId, user_id: String(userId), doctor_id: String(doctorId || ""),
    issued_date: issuedDate, pillar, category, target_behavior: "",
    frequency_per_week: frequency, duration_weeks: duration,
    prescription_raw_text: rawText, status: "active"
  };
  // A prescription with no source nudge is unschedulable: schedule-store rejects
  // every slot for it. The two rows are therefore created together or not at all.
  // The nudge carries the full behaviour triple, so the first behaviour is
  // self-describing rather than leaning on the prescription's defaults.
  const nudge = {
    nudge_id: nudgeId, prescription_id: prescriptionId, user_id: String(userId),
    nudge_type: nudgeType, pillar, category, action_text: action,
    scheduled_date: issuedDate, scheduled_time: time,
    message_body: message, message_body_alt: messageAlt, tone_variant: tone,
    template_name: template, status: "needs_review", sent_at: "", reviewed_at: "",
    week_number: 1, schedule_slot_id: ""
  };
  const state = {
    schedule_id: `sch_${nudgeId}`, nudge_id: nudgeId, user_id: String(userId), parent_nudge_id: nudgeId,
    status: "needs_review",
    sent_at: "", delivered_at: "", wa_message_id: "", tone_sent: "",
    last_updated: new Date().toISOString()
  };

  await batchWrite([
    operation("prescriptions", data.prescriptions, prescription, null),
    operation("nudges", data.nudges, nudge, null),
    operation("schedule_state", data.schedule_state, state, null)
  ]);

  const verified = await loadClinicalData(["prescriptions", "nudges", "schedule_state"]);
  const savedPrescription = verified.prescriptions.rows.find(row => String(row.prescription_id) === prescriptionId);
  const savedNudge = verified.nudges.rows.find(row => String(row.nudge_id) === nudgeId);
  const savedState = verified.schedule_state.rows.find(row => String(row.schedule_id) === `sch_${nudgeId}`);
  const prescriptionOk = savedPrescription && Object.keys(prescription).every(key => same(savedPrescription[key], prescription[key]));
  const nudgeOk = savedNudge && ["prescription_id", "user_id", "pillar", "category", "action_text", "message_body", "status"]
    .every(key => same(savedNudge[key], nudge[key]));
  if (!prescriptionOk || !nudgeOk || !savedState) {
    // Appends are not idempotent, so this must not invite a blind retry.
    throw httpError(409, "The new prescription was not confirmed in Google Sheets. Check the trace card before retrying so you do not create it twice.");
  }
  return { prescription: clean(savedPrescription), nudge: clean(savedNudge) };
}

// Every field is editable, pillar included. Pillar and category are defaults for
// new behaviours, not a lock the schedule inherits, so changing one must not
// touch — or be refused because of — the behaviours already scheduled under it.
// Re-filing a behaviour is done per behaviour in the Monitor trace card.
async function updatePrescription(userId, prescriptionId, changes) {
  const data = await loadClinicalData(["prescriptions"]);
  const existing = findPrescription(data.prescriptions.rows, userId, prescriptionId);
  const next = {};
  if (changes.pillar != null) next.pillar = assertEnum(changes.pillar, PILLARS, "pillar");
  if (changes.category != null) next.category = assertEnum(changes.category, CATEGORIES, "category");
  if (changes.frequency_per_week != null) next.frequency_per_week = wholeNumber(changes.frequency_per_week, "frequency_per_week", 1, 7);
  if (changes.duration_weeks != null) next.duration_weeks = wholeNumber(changes.duration_weeks, "duration_weeks", 1, 52);
  if (changes.issued_date != null) next.issued_date = assertIssuedDate(changes.issued_date);
  if (changes.prescription_raw_text != null) {
    const rawText = text(changes.prescription_raw_text);
    if (!rawText) throw httpError(400, "prescription_raw_text is required");
    if (rawText.length > RAW_TEXT_MAX) throw httpError(400, `prescription_raw_text must be ${RAW_TEXT_MAX} characters or fewer`);
    next.prescription_raw_text = rawText;
  }
  if (!Object.keys(next).length) throw httpError(400, "No prescription fields to update");

  const row = Object.assign({}, existing, next, { prescription_id: existing.prescription_id, user_id: existing.user_id });
  await batchWrite([operation("prescriptions", data.prescriptions, row, existing)]);

  const verified = await loadClinicalData(["prescriptions"]);
  const saved = verified.prescriptions.rows.find(item =>
    String(item.user_id) === String(userId) && String(item.prescription_id) === String(prescriptionId));
  // Every written field, not just the changed keys: operation() overwrites the
  // whole row, so a concurrent edit to an untouched column would be reverted
  // silently while a changed-keys-only check still passed.
  const rowOk = saved && Object.keys(clean(row)).every(key => same(saved[key], row[key]));
  if (!rowOk) {
    throw httpError(409, "The prescription update was not confirmed in Google Sheets. Please retry.");
  }
  return clean(saved);
}

async function archivePrescription(userId, prescriptionId) {
  const data = await loadClinicalData(["prescriptions", "nudges", "weekly_schedule", "schedule_state"]);
  const existing = findPrescription(data.prescriptions.rows, userId, prescriptionId);
  const now = new Date().toISOString();
  const today = melbourneIso();

  const slots = data.weekly_schedule.rows.filter(row =>
    String(row.user_id) === String(userId) &&
    String(row.prescription_id) === String(prescriptionId) &&
    String(row.status || "active") !== "inactive");
  // Only unsent future deliveries are cancelled. Anything sent, or dated before
  // today, is history and stays exactly as it is.
  const future = data.nudges.rows.filter(row =>
    String(row.user_id) === String(userId) &&
    String(row.prescription_id) === String(prescriptionId) &&
    String(row.nudge_id).startsWith("schd_") &&
    String(row.scheduled_date) >= today &&
    String(row.status) === "approved" &&
    !historicalNudge(row));
  const preservedSent = data.nudges.rows.filter(row =>
    String(row.user_id) === String(userId) &&
    String(row.prescription_id) === String(prescriptionId) &&
    historicalNudge(row)).length;

  const statesByNudge = new Map(data.schedule_state.rows.map(row => [String(row.nudge_id), row]));
  const operations = [operation("prescriptions", data.prescriptions,
    Object.assign({}, existing, { status: "archived" }), existing)];
  for (const slot of slots) {
    operations.push(operation("weekly_schedule", data.weekly_schedule,
      Object.assign({}, slot, { status: "inactive", updated_at: now }), slot));
  }
  for (const nudge of future) {
    operations.push(operation("nudges", data.nudges,
      Object.assign({}, nudge, { status: "rejected", reviewed_at: now }), nudge));
    const priorState = statesByNudge.get(String(nudge.nudge_id));
    if (priorState && !historicalState(priorState)) {
      operations.push(operation("schedule_state", data.schedule_state,
        Object.assign({}, priorState, { status: "rejected", last_updated: now }), priorState));
    }
  }
  await batchWrite(operations);

  const verified = await loadClinicalData(["prescriptions", "nudges", "weekly_schedule"]);
  const saved = verified.prescriptions.rows.find(item =>
    String(item.user_id) === String(userId) && String(item.prescription_id) === String(prescriptionId));
  const liveSlots = verified.weekly_schedule.rows.filter(row =>
    String(row.user_id) === String(userId) &&
    String(row.prescription_id) === String(prescriptionId) &&
    String(row.status || "active") !== "inactive");
  const liveFuture = verified.nudges.rows.filter(row =>
    String(row.user_id) === String(userId) &&
    String(row.prescription_id) === String(prescriptionId) &&
    String(row.nudge_id).startsWith("schd_") &&
    String(row.scheduled_date) >= today &&
    String(row.status) === "approved" &&
    !historicalNudge(row));
  if (!saved || !same(saved.status, "archived") || liveSlots.length || liveFuture.length) {
    throw httpError(409, "The archive was not confirmed in Google Sheets. Please retry.");
  }
  return {
    prescription: clean(saved),
    deactivated_slot_count: slots.length,
    cancelled_future_count: future.length,
    preserved_sent_count: preservedSent
  };
}

// Deliberately restores the prescription only. Un-rejecting the cancelled nudges
// would re-arm deliveries for dates that may already have passed, and the
// tombstoned slots describe a week the clinician chose to stop.
async function reactivatePrescription(userId, prescriptionId) {
  const data = await loadClinicalData(["prescriptions"]);
  const existing = findPrescription(data.prescriptions.rows, userId, prescriptionId);
  const row = Object.assign({}, existing, { status: "active" });
  await batchWrite([operation("prescriptions", data.prescriptions, row, existing)]);
  const verified = await loadClinicalData(["prescriptions"]);
  const saved = verified.prescriptions.rows.find(item =>
    String(item.user_id) === String(userId) && String(item.prescription_id) === String(prescriptionId));
  if (!saved || !same(saved.status, "active")) {
    throw httpError(409, "The reactivation was not confirmed in Google Sheets. Please retry.");
  }
  return { prescription: clean(saved), schedule_restored: false };
}

module.exports = {
  createPrescription, updatePrescription, archivePrescription, reactivatePrescription,
  isArchivedPrescription, normalizeAction
};
