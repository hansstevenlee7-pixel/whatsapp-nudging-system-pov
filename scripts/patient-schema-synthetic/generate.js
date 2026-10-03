"use strict";

// Source-shaped synthetic records. The spreadsheet was inspected for its field
// layout only; no source row, identifier, message, or observed response is read.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { generateDataset, cohort, scheduledSlot, datasetHash, DEFAULT_SEED } = require("../taxonomy-frequency/generate");

const VERSION = "patient-schema-synthetic-v3";
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.join(ROOT, "output/patient_schema_synthetic_v3_2026-09-30");
const SOURCE = "Patient Database Google Sheet, gid 764941852; structure inspected 2026-09-30";
const dayNames = ["Monday", "Wednesday", "Friday"];
const times = ["09:00", "12:00", "17:00"];
const pad = (n, width = 4) => String(n).padStart(width, "0");
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const dateFor = (week, slot) => {
  const date = new Date(Date.UTC(2026, 0, 5 + (week - 1) * 7 + (slot - 1) * 2));
  return date.toISOString().slice(0, 10);
};
const prescribeId = (id, index) => `syn_rx_${id}_${index}`;
const slotId = (id, week, index) => `syn_slot_${id}_w${pad(week, 2)}_${index}`;
const nudgeId = (id, week, index) => `syn_nudge_${id}_w${pad(week, 2)}_${index}`;

function build(seed = DEFAULT_SEED) {
  const generated = generateDataset({ seed });
  const users = cohort(generated.users.length, seed);
  const tables = Object.fromEntries([
    "user", "patient_adaptation_timeline", "prescriptions", "weekly_schedule",
    "nudges", "schedule_state", "inbound_messages", "model_rows"
  ].map(name => [name, []]));
  const byUserWeek = new Map();
  for (const row of generated.rows) {
    const key = `${row.synthetic_user_id}|${row.week}`;
    if (!byUserWeek.has(key)) byUserWeek.set(key, []);
    byUserWeek.get(key).push(row);
  }
  for (const user of users) {
    const id = user.synthetic_user_id;
    tables.user.push({ user_id: id, name: `Synthetic Patient ${id.slice(4)}`,
      phone: null, email: null, created_at: "2026-01-01", user_status: "active",
      doctor_id: "syn_clinician_001" });
    tables.patient_adaptation_timeline.push({ questionnaire_id: `syn_questionnaire_${id}`,
      user_id: id, completed_at: "2026-01-01", age: null, gender: null,
      activity_level: null, primary_goal: null, preferred_nudge_time: null,
      opt_in_whatsapp: true });
    user.approved_behaviours.forEach((item, index) => tables.prescriptions.push({
      prescription_id: prescribeId(id, index + 1), user_id: id,
      doctor_id: "syn_clinician_001", issued_date: "2026-01-01",
      pillar: item.pillar, category: item.category, target_behavior: item.action_text,
      frequency_per_week: 3, duration_weeks: 12, prescription_raw_text: null,
      status: "active" }));
    for (let week = 1; week <= generated.weeks; week++) {
      const observed = byUserWeek.get(`${id}|${week}`) || [];
      const frequency = observed.length;
      for (let index = 1; index <= 3; index++) {
        const slot = scheduledSlot(user, week, index, seed);
        const prescriptionIndex = user.approved_behaviours.findIndex(x => x.action_text === slot.action_text) + 1;
        const scheduledDate = dateFor(week, index);
        const scheduleId = slotId(id, week, index);
        const body = `From your health plan: ${slot.action_text}. Reply DONE when completed.`;
        tables.weekly_schedule.push({ schedule_slot_id: scheduleId, user_id: id,
          source_nudge_id: null, prescription_id: prescribeId(id, prescriptionIndex),
          day: dayNames[index - 1], scheduled_time: times[index - 1],
          nudge_type: slot.nudge_type, pillar: slot.pillar, action_text: slot.action_text,
          tone_variant: slot.tone_variant, followup_enabled: false,
          followup_delay_hours: null, message_body: body, message_body_alt: null,
          template_name: "synthetic_health_plan_reminder",
          status: index <= frequency ? "active" : "inactive",
          start_date: scheduledDate, end_date: scheduledDate,
          created_at: "2026-01-01", updated_at: "2026-01-01", category: slot.category });
        if (index > frequency) continue;
        const row = observed[index - 1];
        if (!row || row.message_index !== index) throw new Error("Schedule and generated events differ");
        const nId = nudgeId(id, week, index);
        const sentAt = `${scheduledDate}T${times[index - 1]}:00Z`;
        tables.nudges.push({ nudge_id: nId, prescription_id: prescribeId(id, prescriptionIndex),
          user_id: id, nudge_type: slot.nudge_type, pillar: slot.pillar,
          action_text: slot.action_text, scheduled_date: scheduledDate,
          scheduled_time: times[index - 1], message_body: body, message_body_alt: null,
          tone_variant: slot.tone_variant, template_name: "synthetic_health_plan_reminder",
          status: "sent", sent_at: sentAt, reviewed_at: null, week_number: week,
          schedule_slot_id: scheduleId, followup_enabled: false,
          followup_delay_hours: null, category: slot.category });
        const responded = Boolean(row.interacted_within_24h);
        tables.schedule_state.push({ schedule_id: `syn_state_${nId}`, nudge_id: nId,
          user_id: id, status: responded ? "done" : "no_feedback", sent_at: sentAt,
          wa_message_id: null, barrier_followup_wa_id: null,
          tone_sent: slot.tone_variant, response: responded ? "DONE" : null,
          responded_at: responded ? `${scheduledDate}T20:00:00Z` : null,
          last_response_at: responded ? `${scheduledDate}T20:00:00Z` : null,
          barrier_tag: null, done_count: responded ? 1 : 0,
          skip_count: 0, current_streak: null, consecutive_skips: 0,
          last_updated: sentAt, response_wa_id: null, parent_nudge_id: null,
          delivered_at: null, followup_enabled: false, followup_delay_hours: null,
          commitment_response: null, commitment_responded_at: null,
          followup_due_at: null, followup_sent_at: null,
          outcome_response: null, outcome_responded_at: null, followup_wa_id: null });
        if (responded) tables.inbound_messages.push({
          inbound_id: `syn_inbound_${nId}`, received_at: `${scheduledDate}T20:00:00Z`,
          from_phone: null, to_phone: null, wa_message_id: null, body: "DONE",
          button_text: null, button_payload: null, opt_out_type: null, user_id: id,
          matched_nudge_id: nId, stage: "progress", classification: "done",
          applied: true, note: null, raw_payload: null, context_wa_id: null });
        tables.model_rows.push({ ...row, user_id: id, prescription_id: prescribeId(id, prescriptionIndex),
          schedule_slot_id: scheduleId, nudge_id: nId, response_source: "simulated" });
      }
    }
  }
  return { version: VERSION, seed, source: SOURCE, tables,
    assumptions: {
      prescription_frequency_per_week: "Illustrative clinician target of 3; independent of adaptive nudge frequency.",
      nudge_frequency: "Randomly assigned 1-3 per week in synthetic training data; three prewritten slots available.",
      response: "Generated by the prespecified v2 scenario; no response probability estimated from patient records.",
      demographics: "Left null because the corresponding source fields contain no usable values.",
      missing_operational_tables: "No source rows existed for media assignments, interaction events, adaptation decisions, adaptation state, or media pool."
    }, generator_dataset_sha256: datasetHash(generated.rows) };
}
function validate(result) {
  const t = result.tables;
  const ids = Object.fromEntries(Object.entries(t).map(([name, rows]) => [name, new Set(rows.map(r => ({
    user: r.user_id, prescriptions: r.prescription_id, weekly_schedule: r.schedule_slot_id,
    nudges: r.nudge_id }[name])).filter(Boolean))]));
  for (const r of t.prescriptions) if (!ids.user.has(r.user_id)) throw new Error("Orphan prescription");
  for (const r of t.weekly_schedule) if (!ids.user.has(r.user_id) || !ids.prescriptions.has(r.prescription_id)) throw new Error("Orphan slot");
  for (const r of t.nudges) if (!ids.weekly_schedule.has(r.schedule_slot_id) || !ids.prescriptions.has(r.prescription_id)) throw new Error("Orphan nudge");
  for (const r of t.schedule_state) if (!ids.nudges.has(r.nudge_id)) throw new Error("Orphan state");
  for (const r of t.inbound_messages) if (!ids.nudges.has(r.matched_nudge_id)) throw new Error("Orphan inbound");
  for (const r of t.model_rows) if (!ids.nudges.has(r.nudge_id)) throw new Error("Orphan model row");
  if (t.nudges.length !== t.model_rows.length || t.nudges.length !== t.schedule_state.length) throw new Error("Event count mismatch");
  for (const r of t.user) if (!r.user_id.startsWith("syn_") || r.phone || r.email) throw new Error("Unexpected personal identifier");
  return true;
}
function main() {
  const result = build(); validate(result);
  fs.mkdirSync(OUT, { recursive: true });
  const hashes = {};
  for (const [name, rows] of Object.entries(result.tables)) {
    const payload = rows.map(r => JSON.stringify(r)).join("\n") + "\n";
    fs.writeFileSync(path.join(OUT, `${name}.jsonl`), payload);
    hashes[name] = { rows: rows.length, sha256: sha(payload) };
  }
  const manifest = { version: result.version, seed: result.seed, source: result.source,
    source_url: "https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit?gid=764941852",
    generated_at: new Date().toISOString(), source_shape_only: true,
    no_real_patient_rows_copied: true, assumptions: result.assumptions,
    source_generator_sha256: sha(fs.readFileSync(path.join(ROOT, "scripts/taxonomy-frequency/generate.js"))),
    this_generator_sha256: sha(fs.readFileSync(__filename)),
    generator_dataset_sha256: result.generator_dataset_sha256, tables: hashes };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ output: OUT, tables: Object.fromEntries(Object.entries(hashes).map(([name, x]) => [name, x.rows])) }));
}
if (require.main === module) main();
module.exports = { VERSION, OUT, build, validate, main };
