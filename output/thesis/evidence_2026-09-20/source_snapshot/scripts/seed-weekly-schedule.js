#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const schema = require("../lifestyle_nudging_schema.json");

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const LEGACY_ACTIONS = Object.fromEntries(
  Object.entries(schema.x_legacy_action_labels).filter(([key]) => key !== "description")
);

function token(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(-48);
}

// Rows written before action_text existed carry the retired target_behavior token
// on their prescription. Convert it once, here, so the clinician opens the review
// page on readable text they can revise rather than an enum they cannot.
function legacyActionText(token) {
  const key = String(token || "").trim();
  if (!key) return "";
  if (LEGACY_ACTIONS[key]) return LEGACY_ACTIONS[key];
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function dayFor(date) {
  const parsed = new Date(String(date || "") + "T00:00:00Z");
  return Number.isNaN(parsed.getTime()) ? "" : DAYS[parsed.getUTCDay()];
}

function sourceFor(row, sources) {
  if (row.source_nudge_id && sources.has(String(row.source_nudge_id))) return sources.get(String(row.source_nudge_id));
  return [...sources.values()].find(source => String(row.nudge_id || "").startsWith(`schd_${token(source.nudge_id)}_`));
}

function oldOccurrence(row) {
  const match = String(row.nudge_id || "").match(/_(\d+)$/);
  return match ? match[1] : "0";
}

function seedWeeklySchedule(nudges, now = new Date().toISOString(), prescriptions = []) {
  const behaviorByPrescription = new Map((prescriptions || [])
    .map(row => [String(row.prescription_id), row.target_behavior]));
  const sources = new Map((nudges || []).filter(row =>
    row.nudge_id && !String(row.nudge_id).startsWith("schd_") && String(row.status) === "approved"
  ).map(row => [String(row.nudge_id), row]));
  const candidates = (nudges || []).filter(row =>
    String(row.nudge_id || "").startsWith("schd_") && ["approved", "sent"].includes(String(row.status || ""))
  ).map(row => ({ row, source: sourceFor(row, sources) })).filter(item => item.source);

  const bySlot = new Map();
  for (const item of candidates) {
    const day = dayFor(item.row.scheduled_date);
    if (!day) continue;
    const key = [item.row.user_id, item.source.nudge_id, day, oldOccurrence(item.row)].join("|");
    const previous = bySlot.get(key);
    const rank = `${item.row.status === "approved" ? "1" : "0"}|${item.row.reviewed_at || ""}|${item.row.scheduled_date || ""}`;
    const date = String(item.row.scheduled_date || "");
    if (!previous) bySlot.set(key, { ...item, day, rank, occurrence: oldOccurrence(item.row), start: date, end: date });
    else {
      previous.start = !previous.start || date < previous.start ? date : previous.start;
      previous.end = !previous.end || date > previous.end ? date : previous.end;
      if (rank > previous.rank) Object.assign(previous, item, { day, rank, occurrence: oldOccurrence(item.row) });
    }
  }

  return [...bySlot.values()].map(item => {
    const prescriptionId = String(item.row.prescription_id || item.source.prescription_id || "");
    const action = String(item.row.action_text || item.source.action_text || "").trim() ||
      legacyActionText(item.row.target_behavior || item.source.target_behavior || behaviorByPrescription.get(prescriptionId));
    return {
    schedule_slot_id: `slot_${token(item.source.nudge_id) || "source"}_${item.day}_${item.occurrence}`,
    user_id: String(item.row.user_id), source_nudge_id: String(item.source.nudge_id),
    prescription_id: prescriptionId,
    day: item.day, scheduled_time: String(item.row.scheduled_time || item.source.scheduled_time || "09:00"),
    nudge_type: String(item.row.nudge_type || item.source.nudge_type || "reminder"),
    pillar: String(item.row.pillar || item.source.pillar || ""),
    action_text: action,
    tone_variant: String(item.row.tone_variant || item.source.tone_variant || "encouraging"),
    message_body: String(item.row.message_body || item.source.message_body || ""),
    message_body_alt: String(item.row.message_body_alt || item.source.message_body_alt || ""),
    template_name: String(item.row.template_name || item.source.template_name || "health_plan_reminder"),
    status: "active", start_date: item.start, end_date: item.end,
    created_at: now, updated_at: now
    };
  }).sort((a, b) => `${a.user_id}|${DAYS.indexOf(a.day)}|${a.scheduled_time}`.localeCompare(`${b.user_id}|${DAYS.indexOf(b.day)}|${b.scheduled_time}`));
}

function main(argv) {
  const positional = argv.slice(2).filter(value => !value.startsWith("--"));
  const input = positional[0];
  const output = positional[1] || "weekly_schedule.seed.json";
  const write = argv.includes("--write");
  // Optional: the prescriptions export supplies the retired target_behavior token
  // so legacy slots migrate to readable action text instead of a blank Action.
  const prescriptionsArg = argv.find(value => value.startsWith("--prescriptions="));
  if (!input) throw new Error("Usage: node scripts/seed-weekly-schedule.js <nudges.json> [output.json] [--prescriptions=prescriptions.json] [--write]");
  const raw = fs.readFileSync(input, "utf8");
  const parsed = JSON.parse(raw);
  const prescriptionsRaw = prescriptionsArg ? JSON.parse(fs.readFileSync(prescriptionsArg.slice("--prescriptions=".length), "utf8")) : [];
  const prescriptions = Array.isArray(prescriptionsRaw) ? prescriptionsRaw : prescriptionsRaw.prescriptions || [];
  const rows = seedWeeklySchedule(Array.isArray(parsed) ? parsed : parsed.nudges, new Date().toISOString(), prescriptions);
  const summary = { mode: write ? "write" : "dry-run", input_rows: (Array.isArray(parsed) ? parsed : parsed.nudges || []).length, schedule_rows: rows.length, patients: new Set(rows.map(row => row.user_id)).size, missing_action_rows: rows.filter(row => !row.action_text).length, output };
  if (!write) return process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(input, path.join(path.dirname(input), `${path.basename(input)}.${stamp}.backup`));
  fs.writeFileSync(output, JSON.stringify(rows, null, 2) + "\n");
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

if (require.main === module) main(process.argv);
module.exports = { seedWeeklySchedule };
