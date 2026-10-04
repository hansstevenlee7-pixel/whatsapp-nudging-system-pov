"use strict";

const crypto = require("node:crypto");
const { httpError } = require("./http");
const { TAB_NAMES, loadClinicalData, batchWrite, operation, isArchivedPrescription } = require("./clinical-data");
const { PILLARS, CATEGORIES, NUDGE_TYPES: TYPES, assertAction } = require("./taxonomy");

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TONES = new Set(["encouraging", "neutral_informational", "custom"]);
const TEMPLATES = new Set(["health_plan_reminder", "hello_world"]);
const MEDIA_SELECTION_MODES = new Set(["automatic", "text_only", "clinician_selected"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const VERIFY_FIELDS = ["schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "category", "action_text", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "media_selection_mode", "media_override_asset_id", "media_asset_id", "adaptation_decision_id", "approved_by", "approved_at"];

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

function safeBehaviourKey(row) {
  try {
    const { behaviourKey } = require("./adaptive-core");
    return behaviourKey(row);
  } catch (_) { return ""; }
}

function dayDistance(left, right) {
  const raw = Math.abs(left - right);
  return Math.min(raw, 7 - raw);
}

function evenlySpacedRows(rows, target) {
  const sorted = rows.slice().sort((left, right) => DAYS.indexOf(left.day) - DAYS.indexOf(right.day) ||
    String(left.scheduled_time).localeCompare(String(right.scheduled_time)));
  if (target >= sorted.length) return sorted;
  if (target <= 1) return [sorted[Math.floor((sorted.length - 1) / 2)]];
  const selected = [];
  for (let index = 0; index < target; index += 1) {
    selected.push(sorted[Math.round(index * (sorted.length - 1) / (target - 1))]);
  }
  return Array.from(new Map(selected.map(row => [String(row.schedule_slot_id), row])).values());
}

function addFrequencyRows(rows, target, input) {
  const result = rows.slice();
  const used = new Set(result.map(row => DAYS.indexOf(String(row.day))));
  while (result.length < target) {
    const candidates = DAYS.map((day, index) => ({ day, index })).filter(item => !used.has(item.index));
    if (!candidates.length) break;
    candidates.sort((left, right) => {
      const leftDistance = used.size ? Math.min(...Array.from(used).map(index => dayDistance(left.index, index))) : 7;
      const rightDistance = used.size ? Math.min(...Array.from(used).map(index => dayDistance(right.index, index))) : 7;
      return rightDistance - leftDistance || left.index - right.index;
    });
    const selected = candidates[0]; const base = result[result.length % rows.length] || rows[0];
    const suffix = crypto.createHash("sha256").update([input.user_id, input.behaviour_key, selected.day].join("|")).digest("hex").slice(0, 16);
    result.push(Object.assign({}, base, { schedule_slot_id: `slot_auto_${suffix}`, day: selected.day, created_at: input.now, updated_at: input.now }));
    used.add(selected.index);
  }
  return result;
}

function slotInput(row) {
  return {
    schedule_slot_id: row.schedule_slot_id, source_nudge_id: row.source_nudge_id, prescription_id: row.prescription_id,
    day: row.day, time: row.scheduled_time, nudge_type: row.nudge_type, pillar: row.pillar, category: row.category,
    action_text: row.action_text, tone_variant: row.tone_variant, message_body: row.message_body,
    message_body_alt: row.message_body_alt || "", template_name: row.template_name || "health_plan_reminder",
    media_selection_mode: row.media_selection_mode || "automatic", media_override_asset_id: row.media_override_asset_id || ""
  };
}

async function applyAdaptiveSchedule(input, snapshot) {
  const evaluationTime = new Date(input.now || Date.now());
  if (!Number.isFinite(evaluationTime.getTime())) throw httpError(400, "Invalid evaluation time");
  const outbox = Array.isArray(input.decision_rows) ? input.decision_rows : [];
  const data = snapshot || await loadClinicalData(outbox.length ? TAB_NAMES.concat("adaptation_decisions") : undefined);
  const userId = String(input.user_id || ""); const key = String(input.behaviour_key || "");
  const active = data.weekly_schedule.rows.filter(row => String(row.user_id) === userId && String(row.status || "active") === "active");
  const current = active.filter(row => safeBehaviourKey(row) === key);
  if (!current.length) return { applied: false, reason: "no_active_schedule_for_behaviour", weekly_schedule: active };
  const target = Math.max(1, Math.min(3, Math.round(Number(input.target_frequency) || current.length)));
  let adapted = target < current.length ? evenlySpacedRows(current, target) : addFrequencyRows(current, target, {
    user_id: userId, behaviour_key: key, now: evaluationTime.toISOString()
  });
  const targetTime = TIME_RE.test(String(input.target_time || "")) ? String(input.target_time) : null;
  if (targetTime) adapted = adapted.map(row => Object.assign({}, row, { scheduled_time: targetTime, updated_at: evaluationTime.toISOString() }));
  const retainedIds = new Set(current.map(row => String(row.schedule_slot_id)));
  const combined = active.filter(row => !retainedIds.has(String(row.schedule_slot_id))).concat(adapted);
  const beforeShape = current.map(row => `${row.schedule_slot_id}|${row.day}|${row.scheduled_time}`).sort();
  const afterShape = adapted.map(row => `${row.schedule_slot_id}|${row.day}|${row.scheduled_time}`).sort();
  if (JSON.stringify(beforeShape) === JSON.stringify(afterShape)) {
    return { applied: false, reason: "schedule_already_matches_policy", weekly_schedule: active, before: current, after: adapted };
  }
  const starts = active.map(row => String(row.start_date || "")).filter(DATE_RE.test.bind(DATE_RE)).sort();
  const ends = active.map(row => String(row.end_date || "")).filter(DATE_RE.test.bind(DATE_RE)).sort();
  const startDate = starts[0] || melbourneIso(evaluationTime); const endDate = ends.at(-1) || addDays(startDate, 84);
  // The deciding policy decision is stamped on every slot of this behaviour it
  // changed or removed, so a schedule row names its cause (RQ1 traceability).
  const decisionLink = String(input.adaptation_decision_id || "").trim();
  const links = decisionLink ? { decision_id: decisionLink, slot_ids: new Set(current.concat(adapted).map(row => String(row.schedule_slot_id))) } : {};
  if (outbox.length) links.decision_rows = outbox;
  const result = await saveSchedule({ user_id: userId, start_date: startDate, end_date: endDate, slots: combined.map(slotInput) }, "approve", data, evaluationTime, links);
  return Object.assign({ applied: true, reason: "future_unsent_schedule_updated", before: current, after: adapted }, result);
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
    if (!String(slot.message_body || "").trim() || String(slot.message_body).length > 1024) throw httpError(400, `slots[${index}].message_body is invalid`);
    const mediaMode = String(slot.media_selection_mode || "automatic");
    const overrideId = String(slot.media_override_asset_id || "").trim();
    if (!MEDIA_SELECTION_MODES.has(mediaMode)) throw httpError(400, `slots[${index}].media_selection_mode is invalid`);
    if (mediaMode === "clinician_selected" && !overrideId) throw httpError(400, `slots[${index}].media_override_asset_id is required`);
    if (mediaMode !== "clinician_selected" && overrideId) throw httpError(400, `slots[${index}].media_override_asset_id is only allowed for clinician_selected mode`);
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

function slotDecisionLink(scheduleSlotId, slot, prior, links) {
  if (links.slot_ids && links.slot_ids.has(scheduleSlotId)) return links.decision_id;
  const unchanged = prior && String(prior.day) === String(slot.day) && String(prior.scheduled_time) === String(slot.time);
  return unchanged ? String(prior.adaptation_decision_id || "") : "";
}

function historicalNudge(row) {
  return String(row.status) === "sent" || Boolean(row.sent_at);
}

function historicalState(row) {
  return ["accepted", "queued", "sending", "sent", "delivered", "read", "failed", "undelivered", "canceled"].includes(String(row.status)) ||
    Boolean(row.sent_at || row.wa_message_id);
}

function stateRow(nudge, prior, now) {
  return Object.assign({}, prior || {}, {
    schedule_id: `sch_${nudge.nudge_id}`, nudge_id: nudge.nudge_id, user_id: nudge.user_id,
    parent_nudge_id: nudge.nudge_id,
    status: "approved", sent_at: prior && prior.sent_at || "", delivered_at: prior && prior.delivered_at || "",
    wa_message_id: prior && prior.wa_message_id || "",
    tone_sent: prior && prior.tone_sent || "",
    last_updated: now, delivery_attempt_id: "", submission_started_at: ""
  });
}

async function saveSchedule(body, decision = "approve", snapshot, evaluationTime = new Date(), links = {}) {
  // Internal clock and decision-link injection keep synthetic replay consistent
  // and provenance trustworthy; neither is ever read from the HTTP body. The same
  // holds for links.approved_by, the authenticated clinician who approved the save:
  // a slot records who last approved it and when, and a policy write keeps that
  // attribution (its own decision is named by adaptation_decision_id).
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
  const now = evaluationTime.toISOString();
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
  const scopeWeekStart = String(body.scope_week_start || "");
  if (scopeWeekStart && (!DATE_RE.test(scopeWeekStart) || DAYS[new Date(`${scopeWeekStart}T00:00:00Z`).getUTCDay()] !== "monday")) {
    throw httpError(400, "scope_week_start must be a Monday in YYYY-MM-DD format");
  }
  if (scopeWeekStart && !existingWeekly.some(row => String(row.status) === "active")) {
    throw httpError(409, "Approve the recurring intake schedule before planning an individual week");
  }
  const todayIso = melbourneIso(evaluationTime);
  const nowTime = melbourneTime(evaluationTime);
  const effectiveStart = [scopeWeekStart || startDate, startDate, todayIso].sort().at(-1);
  const generationEnd = scopeWeekStart ? [addDays(scopeWeekStart, 6), endDate].sort().at(0) : endDate;
  if (effectiveStart > generationEnd) throw httpError(400, "The selected week is outside the active future schedule range");
  const usedIds = new Set();
  const active = slots.map((slot, index) => {
    const scheduleSlotId = stableSlotId(slot, index);
    if (usedIds.has(scheduleSlotId)) throw httpError(400, `duplicate schedule_slot_id: ${scheduleSlotId}`);
    usedIds.add(scheduleSlotId);
    const prior = existingWeeklyById.get(scheduleSlotId);
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
      message_body: String(slot.message_body).trim(), message_body_alt: String(slot.message_body_alt || ""),
      template_name: String(slot.template_name || "health_plan_reminder"), status: "active",
      media_selection_mode: String(slot.media_selection_mode || "automatic"),
      media_override_asset_id: String(slot.media_override_asset_id || ""),
      media_asset_id: "", adaptation_decision_id: slotDecisionLink(scheduleSlotId, slot, prior, links),
      start_date: startDate, end_date: endDate, created_at: prior && prior.created_at || now, updated_at: now
    }, links.approved_by ? { approved_by: String(links.approved_by), approved_at: now } : {});
  });
  const inactive = scopeWeekStart ? [] : existingWeekly.filter(row => !usedIds.has(String(row.schedule_slot_id)) && String(row.status) !== "inactive")
    .map(row => Object.assign({}, row, { status: "inactive", updated_at: now },
      links.slot_ids && links.slot_ids.has(String(row.schedule_slot_id)) ? { adaptation_decision_id: links.decision_id } : {},
      links.approved_by ? { approved_by: String(links.approved_by), approved_at: now } : {}));

  const desiredNudges = [];
  for (const iso of datesBetween(effectiveStart, generationEnd)) {
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
        scheduled_date: iso, scheduled_time: slot.scheduled_time,
        message_body: slot.message_body, message_body_alt: slot.message_body_alt, tone_variant: slot.tone_variant,
        template_name: slot.template_name, status: "approved", sent_at: "", reviewed_at: now,
        week_number: Math.floor((datesBetween(effectiveStart, iso).length - 1) / 7) + 1,
        media_selection_mode: slot.media_selection_mode || "automatic", media_override_asset_id: slot.media_override_asset_id || "",
        media_asset_id: "", adaptation_decision_id: ""
      });
    }
  }
  if (!desiredNudges.length) throw httpError(400, "weekly slots produced no dated nudges in the selected future range");
  if (desiredNudges.length > 2000) throw httpError(400, "approval would create more than 2000 dated nudges");

  const desiredIds = new Set(desiredNudges.map(row => row.nudge_id));
  const existingNudgesById = new Map(data.nudges.rows.map(row => [String(row.nudge_id), row]));
  const existingStatesByNudge = new Map(data.schedule_state.rows.map(row => [String(row.nudge_id), row]));
  // An occurrence whose delivery is reserved or already submitted is history as
  // well, even before sent_at reaches the nudge row: neither rejected nor rebuilt,
  // so its selected media and decision link survive (isolation test, 4 Oct 2026).
  const protectedNudge = row => historicalNudge(row) ||
    Boolean(existingStatesByNudge.has(String(row.nudge_id)) && historicalState(existingStatesByNudge.get(String(row.nudge_id))));
  const staleNudges = data.nudges.rows.filter(row => String(row.user_id) === userId && String(row.nudge_id).startsWith("schd_") &&
    String(row.scheduled_date) >= effectiveStart && String(row.scheduled_date) <= generationEnd && String(row.status) === "approved" &&
    !desiredIds.has(String(row.nudge_id)) && !protectedNudge(row));

  const operations = [];
  if (scopeWeekStart) {
    for (const row of existingWeekly.filter(item => String(item.status) === "active")) {
      operations.push(operation("weekly_schedule", data.weekly_schedule, Object.assign({}, row, { start_date: startDate, end_date: endDate, updated_at: now },
        links.approved_by ? { approved_by: String(links.approved_by), approved_at: now } : {}), row));
    }
  } else {
    for (const row of active) operations.push(operation("weekly_schedule", data.weekly_schedule, row, existingWeeklyById.get(String(row.schedule_slot_id))));
  }
  for (const row of inactive) operations.push(operation("weekly_schedule", data.weekly_schedule, row, row));

  // Backfill only: a legacy source nudge with no action_text (or, since the
  // behaviour taxonomy, no category) adopts the value from the first slot built
  // from it. Slots stay authoritative, so a source that already has one is never
  // rewritten and sibling slots keep differing behaviours. Pillar is deliberately
  // absent — it is populated on every row and rewriting it would resurrect the
  // cascade this change removed. A source that has already been sent is history
  // and is never rewritten, not even its status (benchmark finding, 2 Oct 2026).
  if (!scopeWeekStart) {
    const sourceBehaviours = new Map();
    for (const row of active) if (!sourceBehaviours.has(String(row.source_nudge_id))) sourceBehaviours.set(String(row.source_nudge_id), row);
    for (const source of data.nudges.rows.filter(row => sourceBehaviours.has(String(row.nudge_id)) && !String(row.nudge_id).startsWith("schd_") && !historicalNudge(row))) {
      const slot = sourceBehaviours.get(String(source.nudge_id));
      const changes = { status: "approved", reviewed_at: now };
      if (!String(source.action_text || "").trim()) changes.action_text = slot.action_text;
      if (!String(source.category || "").trim()) changes.category = slot.category;
      operations.push(operation("nudges", data.nudges, Object.assign({}, source, changes), source));
    }
  }
  for (const nudge of desiredNudges) {
    const prior = existingNudgesById.get(nudge.nudge_id);
    if (!prior || !protectedNudge(prior)) operations.push(operation("nudges", data.nudges, Object.assign({}, prior || {}, nudge), prior));
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

  // Outbox: the decisions explaining an adaptive change join the same atomic batch,
  // so the schedule cannot change without its record (audit-recovery test, 5 Oct 2026).
  if (links.decision_rows && links.decision_rows.length) {
    if (!data.adaptation_decisions) throw new Error("adaptation_decisions tab is required for decision rows");
    for (const row of links.decision_rows) operations.push(operation("adaptation_decisions", data.adaptation_decisions, row));
  }
  await batchWrite(operations);
  const verified = await loadClinicalData(["weekly_schedule"]);
  const saved = verified.weekly_schedule.rows.filter(row => String(row.user_id) === userId && String(row.status) === "active");
  if (!scopeWeekStart) {
    const expectedNormalized = active.map(normalized).sort((a, b) => a.schedule_slot_id.localeCompare(b.schedule_slot_id));
    const actualNormalized = saved.map(normalized).sort((a, b) => a.schedule_slot_id.localeCompare(b.schedule_slot_id));
    if (JSON.stringify(actualNormalized) !== JSON.stringify(expectedNormalized)) {
      throw httpError(409, "The schedule update was not confirmed in Google Sheets. Please retry.");
    }
  } else if (saved.some(row => String(row.start_date) !== startDate || String(row.end_date) !== endDate)) {
    throw httpError(409, "The schedule date range was not confirmed in Google Sheets. Please retry.");
  }
  return {
    status: "ok", decision: "approve", persisted: true, user_id: userId, count: desiredNudges.length,
    active_slot_count: saved.length, inactive_slot_count: inactive.length, cancelled_future_count: staleNudges.length,
    effective_start_date: effectiveStart, scope_week_start: scopeWeekStart || "", dated_nudges: scopeWeekStart ? desiredNudges : [],
    weekly_schedule: saved.map(row => { const copy = Object.assign({}, row); delete copy.row_number; return copy; })
  };
}

module.exports = {
  saveSchedule, applyAdaptiveSchedule, validate, melbourneIso, melbourneTime, addDays, datesBetween, stableSlotId,
  evenlySpacedRows, addFrequencyRows,
  // One definition of "this row is history and must never be rewritten", shared
  // with the prescription archive cascade.
  historicalNudge, historicalState
};
