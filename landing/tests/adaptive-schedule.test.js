"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, baseSeed } = require("./sheets-fixture");
const { saveSchedule, applyAdaptiveSchedule, addFrequencyRows } = require("../api/_lib/schedule-store");
const { behaviourKey } = require("../api/_lib/adaptive-core");

function slot(id, day) {
  return { schedule_slot_id: id, source_nudge_id: "source-wed", prescription_id: "rx-1", day, time: "09:00",
    nudge_type: "reminder", pillar: "sleep", category: "establish", action_text: "Be in bed by 10pm",
    tone_variant: "encouraging", message_body: "Prepare for sleep", message_body_alt: "", template_name: "health_plan_reminder",
    media_selection_mode: "automatic", media_override_asset_id: "" };
}

test("adaptive schedule application changes only future unsent recurring occurrences", async function (t) {
  const fx = fixture(baseSeed()); t.after(fx.restore);
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [slot("slot-mon", "monday"), slot("slot-thu", "thursday")] });
  const key = behaviourKey({ action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" });
  const result = await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: key,
    target_frequency: 1, target_time: "18:30", now: "2026-09-01T00:00:00Z" });
  assert.equal(result.applied, true);
  const active = fx.tables.weekly_schedule.rows.filter(row => row.status === "active");
  assert.equal(active.length, 1);
  assert.equal(active[0].scheduled_time, "18:30");
  const future = fx.tables.nudges.rows.filter(row => String(row.nudge_id).startsWith("schd_") && row.status === "approved");
  assert.ok(future.length > 0);
  assert.ok(future.every(row => row.scheduled_time === "18:30"));
});

test("frequency expansion creates stable, unique, evenly separated weekdays", function () {
  const rows = [{ schedule_slot_id: "slot-mon", day: "monday", scheduled_time: "09:00" }];
  const expanded = addFrequencyRows(rows, 3, { user_id: "patient-1", behaviour_key: "behaviour-1", now: "2026-09-01T00:00:00Z" });
  assert.equal(expanded.length, 3);
  assert.equal(new Set(expanded.map(row => row.day)).size, 3);
  assert.equal(new Set(expanded.map(row => row.schedule_slot_id)).size, 3);
});
