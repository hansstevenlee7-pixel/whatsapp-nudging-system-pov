"use strict";

const { readTabs, batchWrite, assertHeaders, operation } = require("./google-sheets");
const { httpError } = require("./http");
const { resolveActionText } = require("./taxonomy");

const TAB_NAMES = ["user", "questionnaire", "prescriptions", "nudges", "weekly_schedule", "schedule_state", "delivery_events"];

const DELIVERY_EVENT_HEADERS = [
  "event_id", "event_at", "wa_message_id", "nudge_id", "user_id", "status",
  "error_code", "error_message", "channel_to", "raw_payload"
];
const INTERACTION_EVENT_HEADERS = [
  "interaction_id", "event_at", "inbound_message_sid", "user_id", "from_phone",
  "reply_to_wa_message_id", "nudge_id", "body", "media_count", "correlation_method", "ack_status"
];
const MEDIA_ASSIGNMENT_HEADERS = [
  "assignment_id", "assigned_at", "user_id", "nudge_id", "behaviour_key", "media_asset_id",
  "adaptation_decision_id", "media_kind", "source_url", "tracked_url"
];
const ADAPTATION_DECISION_HEADERS = [
  "decision_id", "decided_at", "user_id", "behaviour_key", "interaction_id", "signal_type",
  "rule_applied", "outcome", "reason", "selected_asset_id", "interpretation", "previous_state", "next_state"
];

async function loadClinicalData(names = TAB_NAMES) {
  const data = await readTabs(names);
  if (data.user) assertHeaders(data.user, ["user_id", "name", "phone", "email", "user_status", "doctor_id"], "user");
  if (data.questionnaire) assertHeaders(data.questionnaire, ["questionnaire_id", "user_id"], "questionnaire");
  if (data.prescriptions) assertHeaders(data.prescriptions, [
    "prescription_id", "user_id", "doctor_id", "issued_date", "pillar", "category", "target_behavior",
    "frequency_per_week", "duration_weeks", "prescription_raw_text", "status"
  ], "prescriptions");
  // `category` completes the behaviour triple
  // (action_text × pillar × category) on the row that owns it. Live cells are blank
  // until a clinician saves; the read path falls back to the prescription's default.
  if (data.nudges) assertHeaders(data.nudges, [
    "nudge_id", "user_id", "status", "scheduled_date", "scheduled_time", "message_body", "schedule_slot_id", "action_text",
    "category", "media_asset_id", "adaptation_decision_id"
  ], "nudges");
  if (data.weekly_schedule) assertHeaders(data.weekly_schedule, [
    "schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "action_text",
    "category", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "created_at", "updated_at",
    "media_asset_id", "adaptation_decision_id"
  ], "weekly_schedule");
  if (data.schedule_state) assertHeaders(data.schedule_state, [
    "schedule_id", "nudge_id", "user_id", "status", "sent_at", "wa_message_id", "delivered_at", "last_updated",
    "read_at", "interacted_at", "last_inbound_message_sid"
  ], "schedule_state");
  if (data.delivery_events) assertHeaders(data.delivery_events, DELIVERY_EVENT_HEADERS, "delivery_events");
  if (data.interaction_events) assertHeaders(data.interaction_events, INTERACTION_EVENT_HEADERS, "interaction_events");
  if (data.media_assignments) assertHeaders(data.media_assignments, MEDIA_ASSIGNMENT_HEADERS, "media_assignments");
  if (data.adaptation_decisions) assertHeaders(data.adaptation_decisions, ADAPTATION_DECISION_HEADERS, "adaptation_decisions");
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
  const states = data.schedule_state ? data.schedule_state.rows.filter(row => row.nudge_id && row.user_id) : [];
  const events = data.delivery_events ? data.delivery_events.rows.filter(row => row.wa_message_id) : [];
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
      schedule_state: states.filter(row => String(row.user_id) === String(user.user_id)).map(numberFields),
      delivery_events: events.filter(row => String(row.user_id) === String(user.user_id)).map(numberFields),
      weekly_schedule: scheduleRows.filter(row => String(row.status) === "active"),
      has_canonical_schedule: scheduleRows.length > 0
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

async function allPatients() {
  return buildPatients(await loadClinicalData(TAB_NAMES));
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
  batchWrite, operation, DELIVERY_EVENT_HEADERS, INTERACTION_EVENT_HEADERS, MEDIA_ASSIGNMENT_HEADERS, ADAPTATION_DECISION_HEADERS
};
