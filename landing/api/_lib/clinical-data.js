"use strict";

const { readTabs, batchWrite, assertHeaders, operation } = require("./google-sheets");
const { httpError } = require("./http");
const { resolveActionText } = require("./taxonomy");

// inbound_messages is deliberately absent from the default set: it is an
// append-only event log that no read path needs, so the Monitor never pays to
// fetch it. The inbound handler asks for it by name.
const TAB_NAMES = ["user", "questionnaire", "prescriptions", "nudges", "weekly_schedule", "schedule_state"];

const INBOUND_HEADERS = [
  "inbound_id", "received_at", "from_phone", "to_phone", "wa_message_id", "context_wa_id",
  "body", "button_text", "button_payload", "opt_out_type",
  "user_id", "matched_nudge_id", "stage", "classification", "applied", "note", "raw_payload"
];

async function loadClinicalData(names = TAB_NAMES) {
  const data = await readTabs(names);
  if (data.user) assertHeaders(data.user, ["user_id", "name", "phone", "email", "user_status", "doctor_id"], "user");
  if (data.questionnaire) assertHeaders(data.questionnaire, ["questionnaire_id", "user_id"], "questionnaire");
  if (data.prescriptions) assertHeaders(data.prescriptions, [
    "prescription_id", "user_id", "doctor_id", "issued_date", "pillar", "category", "target_behavior",
    "frequency_per_week", "duration_weeks", "prescription_raw_text", "status"
  ], "prescriptions");
  // The follow-up columns are asserted, not optional. rowData() writes only keys
  // present in the sheet's header row, so a missing column would make the
  // clinician's setting vanish on save with no error at all — a loud 500 naming
  // the column is strictly safer than a silent data loss.
  // `category` is asserted for the same reason: it completes the behaviour triple
  // (action_text × pillar × category) on the row that owns it. Live cells are blank
  // until a clinician saves; the read path falls back to the prescription's default.
  if (data.nudges) assertHeaders(data.nudges, [
    "nudge_id", "user_id", "status", "scheduled_date", "scheduled_time", "message_body", "schedule_slot_id", "action_text",
    "category", "followup_enabled", "followup_delay_hours"
  ], "nudges");
  if (data.weekly_schedule) assertHeaders(data.weekly_schedule, [
    "schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "action_text",
    "category", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "created_at", "updated_at",
    "followup_enabled", "followup_delay_hours"
  ], "weekly_schedule");
  if (data.schedule_state) assertHeaders(data.schedule_state, [
    "schedule_id", "nudge_id", "user_id", "status", "sent_at", "wa_message_id", "response", "responded_at", "last_updated",
    "parent_nudge_id", "delivered_at", "followup_enabled", "followup_delay_hours",
    "commitment_response", "commitment_responded_at",
    "followup_due_at", "followup_sent_at", "followup_wa_id",
    "outcome_response", "outcome_responded_at"
  ], "schedule_state");
  if (data.inbound_messages) assertHeaders(data.inbound_messages, INBOUND_HEADERS, "inbound_messages");
  return data;
}

function numberFields(row) {
  const copy = Object.assign({}, row);
  for (const key of ["frequency_per_week", "duration_weeks", "week_number"]) {
    if (copy[key] !== "" && copy[key] != null && !Number.isNaN(Number(copy[key]))) copy[key] = Number(copy[key]);
  }
  delete copy.row_number;
  return copy;
}

// Blank reads as active on purpose: rows written before the portal could archive
// carry no status, and hiding a live plan is worse than showing a stale one. This
// fails open by design — every other blank-status default in the codebase should
// be read against this one and justified in its own direction.
function isArchivedPrescription(row) {
  return String((row && row.status) || "active") === "archived";
}

function buildPatients(data) {
  const users = data.user.rows.filter(row => row.user_id);
  const allPrescriptions = data.prescriptions.rows.filter(row => row.prescription_id && row.user_id).map(numberFields);
  // Archived rows stay in this index so a legacy nudge's target_behavior still
  // resolves to readable text after its prescription is archived.
  const prescriptionById = new Map(allPrescriptions.map(row => [String(row.prescription_id), row]));
  const prescriptions = allPrescriptions.filter(row => !isArchivedPrescription(row));
  const archivedPrescriptions = allPrescriptions.filter(isArchivedPrescription);
  const archivedIds = new Set(archivedPrescriptions.map(row => String(row.prescription_id)));
  // Legacy rows carry no action_text, so the read path converts their retired
  // target_behavior token to readable text. Nothing is written back here.
  const withAction = row => Object.assign(numberFields(row), { action_text: resolveActionText(row, prescriptionById.get(String(row.prescription_id))) });
  const allNudges = data.nudges.rows.filter(row => row.nudge_id && row.user_id).map(withAction);
  const weekly = data.weekly_schedule.rows.filter(row => row.schedule_slot_id && row.user_id).map(withAction);
  const questionnaires = data.questionnaire ? data.questionnaire.rows.filter(row => row.user_id) : [];
  // Source rows of an archived prescription are withheld from the portal: they
  // feed the add picker, the custom-nudge anchor, and seedWeekFromNudges' last
  // fallback, which would otherwise rebuild a whole week from an archived plan.
  // Delivery rows are left alone — they are sent history.
  const sourceNudges = allNudges.filter(row => !String(row.nudge_id).startsWith("schd_") && !archivedIds.has(String(row.prescription_id)));
  const deliveryNudges = allNudges.filter(row => String(row.nudge_id).startsWith("schd_"));
  return users.map(user => {
    const nudges = sourceNudges.filter(row => String(row.user_id) === String(user.user_id));
    const scheduleNudges = deliveryNudges.filter(row => String(row.user_id) === String(user.user_id));
    const scheduleRows = weekly.filter(row => String(row.user_id) === String(user.user_id));
    const statuses = nudges.map(row => String(row.status || "needs_review"));
    const status = statuses.some(value => value === "needs_review" || value === "pending") ? "needs_review"
      : statuses.some(value => value === "approved") ? "approved"
      : statuses.some(value => value === "rejected") ? "rejected" : "no_review_items";
    const questionnaire = questionnaires.find(row => String(row.user_id) === String(user.user_id));
    return {
      user_id: user.user_id, name: user.name || "", phone: user.phone || "", email: user.email || "",
      doctor_id: user.doctor_id || "", user_status: user.user_status || "", status,
      // Default slot timing falls back to the patient's stated preference; the
      // retired fixed-action catalogue no longer supplies a per-behaviour time.
      preferred_nudge_time: questionnaire && questionnaire.preferred_nudge_time || "",
      prescriptions: prescriptions.filter(row => String(row.user_id) === String(user.user_id)),
      archived_prescriptions: archivedPrescriptions.filter(row => String(row.user_id) === String(user.user_id)),
      nudges, schedule_nudges: scheduleNudges,
      weekly_schedule: scheduleRows.filter(row => String(row.status) === "active"),
      has_canonical_schedule: scheduleRows.length > 0
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function allPatients() {
  return buildPatients(await loadClinicalData(["user", "questionnaire", "prescriptions", "nudges", "weekly_schedule"]));
}

async function updateUser(userId, changes) {
  const data = await loadClinicalData(["user"]);
  const existing = data.user.rows.find(row => String(row.user_id) === String(userId));
  if (!existing) throw httpError(404, "Patient not found");
  const row = Object.assign({}, existing, changes, { user_id: existing.user_id });
  await batchWrite([operation("user", data.user, row, existing)]);
  const verified = await loadClinicalData(["user"]);
  const saved = verified.user.rows.find(item => String(item.user_id) === String(userId));
  const keys = Object.keys(changes);
  if (!saved || !keys.every(key => String(saved[key] == null ? "" : saved[key]) === String(changes[key] == null ? "" : changes[key]))) {
    throw httpError(409, "Patient update was not confirmed in Google Sheets. No success was reported; please retry.");
  }
  const result = Object.assign({}, saved);
  delete result.row_number;
  return result;
}

module.exports = {
  loadClinicalData, buildPatients, allPatients, updateUser, isArchivedPrescription,
  batchWrite, operation, INBOUND_HEADERS
};
