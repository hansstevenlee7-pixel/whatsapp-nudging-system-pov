"use strict";

const crypto = require("node:crypto");
const { httpError } = require("./http");
const { loadClinicalData, batchWrite, operation, isArchivedPrescription } = require("./clinical-data");
const { PILLARS, CATEGORIES, NUDGE_TYPES: TYPES, assertAction } = require("./taxonomy");
const { assertFollowup } = require("./followup");

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TONES = new Set(["encouraging", "neutral_informational", "custom"]);
const TEMPLATES = new Set(["health_plan_reminder", "hello_world"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const VERIFY_FIELDS = ["schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "category", "action_text", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "followup_enabled", "followup_delay_hours"];

function token(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(-60);
}

function melbourneIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function melbourneTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Australia/Melbourne", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function addDays(iso, amount) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function datesBetween(start, end) {
  const dates = [];
  for (let value = start; value <= end; value = addDays(value, 1)) dates.push(value);
  return dates;
}

function stableSlotId(slot, index) {
  if (token(slot.schedule_slot_id)) return token(slot.schedule_slot_id);
  const seed = [slot.source_nudge_id, slot.prescription_id, slot.day, index].join("|");
  return `slot_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 20)}`;
}

function validate(body, decision) {
  const userId = String(body.user_id || "").trim();
  const slots = Array.isArray(body.slots) ? body.slots : [];
  if (!userId) throw httpError(400, "user_id is required");
  if (!slots.length) throw httpError(400, "at least one weekly slot is required");
  slots.forEach((slot, index) => {
    if (!DAYS.includes(String(slot.day))) throw httpError(400, `slots[${index}].day is invalid`);
    if (!TIME_RE.test(String(slot.time || ""))) throw httpError(400, `slots[${index}].time is invalid`);
    if (!TYPES.has(String(slot.nudge_type))) throw httpError(400, `slots[${index}].nudge_type is invalid`);
    if (!PILLARS.has(String(slot.pillar))) throw httpError(400, `slots[${index}].pillar is invalid`);
    // The slot declares its own taxonomy now, so a garbage value is a client bug.
    // Blank is a legacy slot that inherits the prescription's category at write
    // time. Reject-guarded like action_text below: rejection writes no taxonomy,
    // so a plan predating this column must stay rejectable.
    if (decision !== "reject" && String(slot.category || "") && !CATEGORIES.has(String(slot.category))) {
      throw httpError(400, `slots[${index}].category is invalid`);
    }
    if (!TONES.has(String(slot.tone_variant))) throw httpError(400, `slots[${index}].tone_variant is invalid`);
    if (!TEMPLATES.has(String(slot.template_name || "health_plan_reminder"))) throw httpError(400, `slots[${index}].template_name is invalid`);
    if (!String(slot.prescription_id || "").trim()) throw httpError(400, `slots[${index}].prescription_id is required`);
    if (!String(slot.source_nudge_id || "").trim()) throw httpError(400, `slots[${index}].source_nudge_id is required`);
    // Action is the one clinician-owned free-text field besides the message body:
    // bounded and non-empty, but never checked against an enumeration. Rejection
    // writes no taxonomy, so it must stay possible on a legacy plan that has none.
    if (decision !== "reject") assertAction(slot.action_text, `slots[${index}].action_text`);
    // Same reasoning as action: rejection writes no configuration, so a legacy
    // slot carrying a nonsensical follow-up setting must still be rejectable.
    if (decision !== "reject") assertFollowup(slot, `slots[${index}]`, slot.nudge_type);
    if (!String(slot.message_body || "").trim() || String(slot.message_body).length > 1024) throw httpError(400, `slots[${index}].message_body is invalid`);
  });
  if (decision === "approve") {
    if (!DATE_RE.test(String(body.start_date || "")) || !DATE_RE.test(String(body.end_date || ""))) {
      throw httpError(400, "start_date and end_date must be YYYY-MM-DD");
    }
    const startMs = Date.parse(`${body.start_date}T00:00:00Z`);
    const endMs = Date.parse(`${body.end_date}T00:00:00Z`);
    const dayCount = Math.floor((endMs - startMs) / 86400000) + 1;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || dayCount < 1 || dayCount > 366) {
      throw httpError(400, "approval date range is invalid or exceeds 366 days");
    }
  }
  return { userId, slots };
}

function normalized(row) {
  return Object.fromEntries(VERIFY_FIELDS.map(key => [key, String(row[key] == null ? "" : row[key])]));
}

function historicalNudge(row) {
  return String(row.status) === "sent" || Boolean(row.sent_at);
}

// Any two-stage progress is history too: a row that has asked for a commitment,
// received one, or already sent its outcome check must never be reset to
// "approved" by a later re-save of the same week.
function historicalState(row) {
  return String(row.status) === "sent" ||
    ["awaiting_commitment", "declined", "awaiting_followup", "done", "not_yet", "no_feedback", "opted_out"].includes(String(row.status)) ||
    Boolean(row.sent_at || row.wa_message_id || row.response || row.responded_at ||
      row.commitment_response || row.followup_sent_at || row.outcome_response);
}

function stateRow(nudge, prior, now) {
  return Object.assign({}, prior || {}, {
    schedule_id: `sch_${nudge.nudge_id}`, nudge_id: nudge.nudge_id, user_id: nudge.user_id,
    // Self-anchoring: the delayed outcome check is a feedback event on this row,
    // not a second approved nudge, so the parent is the row's own delivery.
    parent_nudge_id: nudge.nudge_id,
    status: "approved", sent_at: prior && prior.sent_at || "", delivered_at: prior && prior.delivered_at || "",
    wa_message_id: prior && prior.wa_message_id || "",
    response_wa_id: prior && prior.response_wa_id || "", barrier_followup_wa_id: prior && prior.barrier_followup_wa_id || "",
    tone_sent: prior && prior.tone_sent || "", response: prior && prior.response || "", responded_at: prior && prior.responded_at || "",
    last_response_at: prior && prior.last_response_at || "", barrier_tag: prior && prior.barrier_tag || "",
    // Config is left blank here on purpose. Workflow B snapshots it from the dated
    // nudge at send time, so an approval that happens after a plan change cannot
    // rewrite what an already-delivered message promised.
    followup_enabled: prior && prior.followup_enabled || "", followup_delay_hours: prior && prior.followup_delay_hours || "",
    commitment_response: prior && prior.commitment_response || "", commitment_responded_at: prior && prior.commitment_responded_at || "",
    followup_due_at: prior && prior.followup_due_at || "", followup_sent_at: prior && prior.followup_sent_at || "",
    followup_wa_id: prior && prior.followup_wa_id || "",
    outcome_response: prior && prior.outcome_response || "", outcome_responded_at: prior && prior.outcome_responded_at || "",
    done_count: prior && prior.done_count || 0, skip_count: prior && prior.skip_count || 0,
    current_streak: prior && prior.current_streak || 0, consecutive_skips: prior && prior.consecutive_skips || 0,
    last_updated: now
  });
}

async function saveSchedule(body, decision = "approve", snapshot) {
  const { userId, slots } = validate(body, decision);
  const data = snapshot || await loadClinicalData();
  const user = data.user.rows.find(row => String(row.user_id) === userId);
  if (!user) throw httpError(404, "Patient not found");
  const patientPrescriptions = new Map(data.prescriptions.rows.filter(row => String(row.user_id) === userId).map(row => [String(row.prescription_id), row]));
  const patientSources = new Map(data.nudges.rows.filter(row => String(row.user_id) === userId && !String(row.nudge_id).startsWith("schd_")).map(row => [String(row.nudge_id), row]));
  slots.forEach((slot, index) => {
    const prescription = patientPrescriptions.get(String(slot.prescription_id));
    const source = patientSources.get(String(slot.source_nudge_id));
    if (!prescription) throw httpError(400, `slots[${index}].prescription_id does not belong to this patient`);
    if (!source) throw httpError(400, `slots[${index}].source_nudge_id does not belong to this patient`);
    if (decision === "reject") return;
    // After the reject early-return on purpose: a legacy or archived plan must
    // still be rejectable, it just cannot be scheduled again.
    if (isArchivedPrescription(prescription)) {
      throw httpError(400, `slots[${index}].prescription_id is archived — reactivate the prescription before scheduling it`);
    }
    // The clinician picks the prescription explicitly — including for custom
    // nudges — so the source row must hang off that same prescription. The slot's
    // pillar is deliberately NOT checked against the prescription's: a doctor's
    // note may span pillars, and the prescription's value is only the default a
    // new behaviour starts from.
    if (String(source.prescription_id) !== String(slot.prescription_id)) {
      throw httpError(400, `slots[${index}].source_nudge_id belongs to a different prescription`);
    }
  });
  const now = new Date().toISOString();
  const existingWeekly = data.weekly_schedule.rows.filter(row => String(row.user_id) === userId && row.schedule_slot_id);
  const existingWeeklyById = new Map(existingWeekly.map(row => [String(row.schedule_slot_id), row]));

  if (decision === "reject") {
    const sourceIds = new Set(slots.map(slot => String(slot.source_nudge_id)));
    const operations = data.nudges.rows.filter(row => sourceIds.has(String(row.nudge_id)) && !String(row.nudge_id).startsWith("schd_"))
      .map(row => operation("nudges", data.nudges, Object.assign({}, row, { status: "rejected", reviewed_at: now }), row));
    await batchWrite(operations);
    const verified = await loadClinicalData(["nudges", "weekly_schedule"]);
    const rejectedIds = new Set(verified.nudges.rows.filter(row => sourceIds.has(String(row.nudge_id)) && String(row.status) === "rejected").map(row => String(row.nudge_id)));
    if (rejectedIds.size !== sourceIds.size) throw httpError(409, "The rejection was not confirmed in Google Sheets. Please retry.");
    return { status: "ok", decision: "reject", persisted: true, user_id: userId, count: 0,
      weekly_schedule: verified.weekly_schedule.rows.filter(row => String(row.user_id) === userId && String(row.status) === "active").map(row => { const copy = Object.assign({}, row); delete copy.row_number; return copy; }) };
  }

  const startDate = String(body.start_date);
  const endDate = String(body.end_date);
  const todayIso = melbourneIso();
  const nowTime = melbourneTime();
  const effectiveStart = [startDate, todayIso].sort().at(-1);
  if (effectiveStart > endDate) throw httpError(400, "The schedule range must end on or after today in Melbourne");
  const usedIds = new Set();
  const active = slots.map((slot, index) => {
    const scheduleSlotId = stableSlotId(slot, index);
    if (usedIds.has(scheduleSlotId)) throw httpError(400, `duplicate schedule_slot_id: ${scheduleSlotId}`);
    usedIds.add(scheduleSlotId);
    const prior = existingWeeklyById.get(scheduleSlotId);
    // The slot is authoritative for the follow-up exactly as it is for the action:
    // two slots under one prescription may legitimately differ.
    const followup = assertFollowup(slot, "slot", slot.nudge_type);
    // A slot saved before this column existed sends no category; it inherits the
    // prescription's default here, which is what persists the migration's blanks
    // on the clinician's first save. A slot that names one always wins.
    const category = String(slot.category || "") ||
      String((patientPrescriptions.get(String(slot.prescription_id)) || {}).category || "");
    return Object.assign({}, prior || {}, {
      schedule_slot_id: scheduleSlotId, user_id: userId, source_nudge_id: String(slot.source_nudge_id),
      prescription_id: String(slot.prescription_id), day: String(slot.day), scheduled_time: String(slot.time),
      nudge_type: String(slot.nudge_type), pillar: String(slot.pillar), category,
      action_text: assertAction(slot.action_text, "action_text"),
      tone_variant: slot.tone_variant === "custom" ? "neutral_informational" : String(slot.tone_variant),
      followup_enabled: followup.followup_enabled, followup_delay_hours: followup.followup_delay_hours,
      message_body: String(slot.message_body).trim(), message_body_alt: String(slot.message_body_alt || ""),
      template_name: String(slot.template_name || "health_plan_reminder"), status: "active",
      start_date: startDate, end_date: endDate, created_at: prior && prior.created_at || now, updated_at: now
    });
  });
  const inactive = existingWeekly.filter(row => !usedIds.has(String(row.schedule_slot_id)) && String(row.status) !== "inactive")
    .map(row => Object.assign({}, row, { status: "inactive", updated_at: now }));

  const desiredNudges = [];
  for (const iso of datesBetween(effectiveStart, endDate)) {
    const weekday = DAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
    for (const slot of active.filter(item => item.day === weekday)) {
      // Today's slots are materialized only while their time is still ahead in
      // Melbourne. Workflow B ignores anything older than its five-minute window,
      // so an already-passed row would never be delivered.
      if (iso === todayIso && slot.scheduled_time < nowTime) continue;
      desiredNudges.push({
        nudge_id: `schd_${token(slot.schedule_slot_id)}_${iso.replace(/-/g, "")}`,
        schedule_slot_id: slot.schedule_slot_id, prescription_id: slot.prescription_id, user_id: userId,
        // The whole behaviour triple travels with the delivery, not just the action.
        nudge_type: slot.nudge_type, pillar: slot.pillar, category: slot.category, action_text: slot.action_text,
        // Copied verbatim from the slot, exactly like action_text: Workflow B reads
        // the dated row, so the delivery must carry its own instructions rather
        // than re-deriving them from a plan that may have changed since.
        followup_enabled: slot.followup_enabled, followup_delay_hours: slot.followup_delay_hours,
        scheduled_date: iso, scheduled_time: slot.scheduled_time,
        message_body: slot.message_body, message_body_alt: slot.message_body_alt, tone_variant: slot.tone_variant,
        template_name: slot.template_name, status: "approved", sent_at: "", reviewed_at: now,
        week_number: Math.floor((datesBetween(effectiveStart, iso).length - 1) / 7) + 1
      });
    }
  }
  if (!desiredNudges.length) throw httpError(400, "weekly slots produced no dated nudges in the selected future range");
  if (desiredNudges.length > 2000) throw httpError(400, "approval would create more than 2000 dated nudges");

  const desiredIds = new Set(desiredNudges.map(row => row.nudge_id));
  const existingNudgesById = new Map(data.nudges.rows.map(row => [String(row.nudge_id), row]));
  const existingStatesByNudge = new Map(data.schedule_state.rows.map(row => [String(row.nudge_id), row]));
  const staleNudges = data.nudges.rows.filter(row => String(row.user_id) === userId && String(row.nudge_id).startsWith("schd_") &&
    String(row.scheduled_date) >= effectiveStart && String(row.status) === "approved" && !desiredIds.has(String(row.nudge_id)) && !historicalNudge(row));

  const operations = [];
  for (const row of active) operations.push(operation("weekly_schedule", data.weekly_schedule, row, existingWeeklyById.get(String(row.schedule_slot_id))));
  for (const row of inactive) operations.push(operation("weekly_schedule", data.weekly_schedule, row, row));

  // Backfill only: a legacy source nudge with no action_text (or, since the
  // behaviour taxonomy, no category) adopts the value from the first slot built
  // from it. Slots stay authoritative, so a source that already has one is never
  // rewritten and sibling slots keep differing behaviours. Pillar is deliberately
  // absent — it is populated on every row and rewriting it would resurrect the
  // cascade this change removed.
  const sourceBehaviours = new Map();
  for (const row of active) if (!sourceBehaviours.has(String(row.source_nudge_id))) sourceBehaviours.set(String(row.source_nudge_id), row);
  for (const source of data.nudges.rows.filter(row => sourceBehaviours.has(String(row.nudge_id)) && !String(row.nudge_id).startsWith("schd_"))) {
    const slot = sourceBehaviours.get(String(source.nudge_id));
    const changes = { status: "approved", reviewed_at: now };
    if (!String(source.action_text || "").trim()) changes.action_text = slot.action_text;
    if (!String(source.category || "").trim()) changes.category = slot.category;
    operations.push(operation("nudges", data.nudges, Object.assign({}, source, changes), source));
  }
  for (const nudge of desiredNudges) {
    const prior = existingNudgesById.get(nudge.nudge_id);
    if (!prior || !historicalNudge(prior)) operations.push(operation("nudges", data.nudges, Object.assign({}, prior || {}, nudge), prior));
    const priorState = existingStatesByNudge.get(nudge.nudge_id);
    if (!priorState || !historicalState(priorState)) operations.push(operation("schedule_state", data.schedule_state, stateRow(nudge, priorState, now), priorState));
  }
  for (const stale of staleNudges) {
    operations.push(operation("nudges", data.nudges, Object.assign({}, stale, { status: "rejected", reviewed_at: now }), stale));
    const priorState = existingStatesByNudge.get(String(stale.nudge_id));
    if (priorState && !historicalState(priorState)) {
      operations.push(operation("schedule_state", data.schedule_state, Object.assign({}, priorState, { status: "rejected", last_updated: now }), priorState));
    }
  }

  await batchWrite(operations);
  const verified = await loadClinicalData(["weekly_schedule"]);
  const saved = verified.weekly_schedule.rows.filter(row => String(row.user_id) === userId && String(row.status) === "active");
  const expectedNormalized = active.map(normalized).sort((a, b) => a.schedule_slot_id.localeCompare(b.schedule_slot_id));
  const actualNormalized = saved.map(normalized).sort((a, b) => a.schedule_slot_id.localeCompare(b.schedule_slot_id));
  if (JSON.stringify(actualNormalized) !== JSON.stringify(expectedNormalized)) {
    throw httpError(409, "The schedule update was not confirmed in Google Sheets. Please retry.");
  }
  return {
    status: "ok", decision: "approve", persisted: true, user_id: userId, count: desiredNudges.length,
    active_slot_count: saved.length, inactive_slot_count: inactive.length, cancelled_future_count: staleNudges.length,
    effective_start_date: effectiveStart,
    weekly_schedule: saved.map(row => { const copy = Object.assign({}, row); delete copy.row_number; return copy; })
  };
}

module.exports = {
  saveSchedule, validate, melbourneIso, melbourneTime, addDays, datesBetween, stableSlotId,
  // One definition of "this row is history and must never be rewritten", shared
  // with the prescription archive cascade.
  historicalNudge, historicalState
};
