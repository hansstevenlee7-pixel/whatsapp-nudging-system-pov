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
    slots: [slot("slot-mon", "monday"), slot("slot-thu", "thursday")] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
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

test("an applied change names its deciding policy decision on every slot it changed or removed", async function (t) {
  const fx = fixture(baseSeed()); t.after(fx.restore);
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [slot("slot-mon", "monday"), slot("slot-thu", "thursday")] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
  const key = behaviourKey({ action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" });
  await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: key, target_frequency: 1,
    adaptation_decision_id: "policy-decision-1", now: "2026-09-01T00:00:00Z" });
  const slots = fx.tables.weekly_schedule.rows;
  assert.ok(slots.filter(row => row.status === "active").every(row => row.adaptation_decision_id === "policy-decision-1"));
  assert.ok(slots.filter(row => row.status === "inactive").every(row => row.adaptation_decision_id === "policy-decision-1"));

  // A clinician save that keeps the slot's day and time keeps its provenance;
  // a provenance value supplied in the request body is never trusted.
  const kept = slots.find(row => row.status === "active");
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [Object.assign(slot(kept.schedule_slot_id, kept.day), { adaptation_decision_id: "spoofed" })] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
  assert.equal(fx.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === kept.schedule_slot_id).adaptation_decision_id, "policy-decision-1");
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [Object.assign(slot(kept.schedule_slot_id, kept.day), { time: "18:00" })] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
  assert.equal(fx.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === kept.schedule_slot_id).adaptation_decision_id, "");
});

test("schedule-change experiment preserves sent history and rejects only stale unsent rows", async function (t) {
  const behaviour = { pillar: "sleep", category: "establish", action_text: "Be in bed by 10pm" };
  const fx = fixture(Object.assign({}, baseSeed(), {
    weekly_schedule: [
      Object.assign({}, slot("slot-mon", "monday"), { user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04", status: "active" }),
      Object.assign({}, slot("slot-thu", "thursday"), { user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04", status: "active" })
    ],
    nudges: [
      ...baseSeed().nudges,
      Object.assign({}, behaviour, { nudge_id: "schd_slot-mon_20260907", schedule_slot_id: "slot-mon", prescription_id: "rx-1", user_id: "patient-1", scheduled_date: "2026-09-07", scheduled_time: "09:00", status: "sent", sent_at: "2026-09-07T09:00:00.000Z", message_body: "Monday history" }),
      Object.assign({}, behaviour, { nudge_id: "schd_slot-mon_20260914", schedule_slot_id: "slot-mon", prescription_id: "rx-1", user_id: "patient-1", scheduled_date: "2026-09-14", scheduled_time: "09:00", status: "approved", sent_at: "", message_body: "Monday future" }),
      Object.assign({}, behaviour, { nudge_id: "schd_slot-thu_20260910", schedule_slot_id: "slot-thu", prescription_id: "rx-1", user_id: "patient-1", scheduled_date: "2026-09-10", scheduled_time: "09:00", status: "approved", sent_at: "", message_body: "Thursday future" })
    ],
    schedule_state: [
      { schedule_id: "sch_sent", nudge_id: "schd_slot-mon_20260907", user_id: "patient-1", status: "sent", sent_at: "2026-09-07T09:00:00.000Z", delivered_at: "2026-09-07T09:01:00.000Z", wa_message_id: "SM-history", last_updated: "2026-09-07T09:01:00.000Z" },
      { schedule_id: "sch_future_mon", nudge_id: "schd_slot-mon_20260914", user_id: "patient-1", status: "approved", sent_at: "", delivered_at: "", wa_message_id: "", last_updated: "2026-09-01T00:00:00.000Z" },
      { schedule_id: "sch_future_thu", nudge_id: "schd_slot-thu_20260910", user_id: "patient-1", status: "approved", sent_at: "", delivered_at: "", wa_message_id: "", last_updated: "2026-09-01T00:00:00.000Z" }
    ]
  })); t.after(fx.restore);
  const key = behaviourKey(behaviour);
  const sentBefore = JSON.stringify(fx.tables.nudges.rows.find(row => row.nudge_id === "schd_slot-mon_20260907"));
  const stateBefore = JSON.stringify(fx.tables.schedule_state.rows.find(row => row.nudge_id === "schd_slot-mon_20260907"));

  const result = await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: key,
    target_frequency: 1, target_time: "18:30", now: "2026-09-09T00:00:00.000Z" });

  assert.equal(result.applied, true);
  assert.equal(result.reason, "future_unsent_schedule_updated");
  assert.deepEqual(fx.tables.weekly_schedule.rows.filter(row => row.status === "active").map(row => [row.schedule_slot_id, row.day, row.scheduled_time]), [["slot-mon", "monday", "18:30"]]);
  assert.equal(JSON.stringify(fx.tables.nudges.rows.find(row => row.nudge_id === "schd_slot-mon_20260907")), sentBefore);
  assert.equal(JSON.stringify(fx.tables.schedule_state.rows.find(row => row.nudge_id === "schd_slot-mon_20260907")), stateBefore);
  assert.equal(fx.tables.nudges.rows.find(row => row.nudge_id === "schd_slot-mon_20260914").scheduled_time, "18:30");
  assert.equal(fx.tables.nudges.rows.find(row => row.nudge_id === "schd_slot-thu_20260910").status, "rejected");
  assert.equal(fx.tables.schedule_state.rows.find(row => row.nudge_id === "schd_slot-thu_20260910").status, "rejected");
});

test("frequency expansion creates stable, unique, evenly separated weekdays", function () {
  const rows = [{ schedule_slot_id: "slot-mon", day: "monday", scheduled_time: "09:00" }];
  const expanded = addFrequencyRows(rows, 3, { user_id: "patient-1", behaviour_key: "behaviour-1", now: "2026-09-01T00:00:00Z" });
  assert.equal(expanded.length, 3);
  assert.equal(new Set(expanded.map(row => row.day)).size, 3);
  assert.equal(new Set(expanded.map(row => row.schedule_slot_id)).size, 3);
});

test("a clinician save records who approved each slot and when; a policy write keeps it and the body cannot set it", async function (t) {
  const fx = fixture(baseSeed()); t.after(fx.restore);
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [Object.assign(slot("slot-mon", "monday"), { approved_by: "spoofed" }), slot("slot-thu", "thursday")] }, "approve", undefined,
    new Date("2026-09-01T00:00:00Z"), { approved_by: "auth-clinician" });
  assert.deepEqual(fx.tables.weekly_schedule.rows.map(row => [row.approved_by, row.approved_at]),
    [["auth-clinician", "2026-09-01T00:00:00.000Z"], ["auth-clinician", "2026-09-01T00:00:00.000Z"]]);
  const key = behaviourKey({ action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" });
  await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: key, target_frequency: 1, adaptation_decision_id: "policy-1", now: "2026-09-02T00:00:00Z" });
  const kept = fx.tables.weekly_schedule.rows.find(row => row.status === "active");
  assert.deepEqual([kept.approved_by, kept.approved_at, kept.adaptation_decision_id], ["auth-clinician", "2026-09-01T00:00:00.000Z", "policy-1"]);
  // Without an authenticated approver (no links), nothing is attributed.
  const unattributed = fixture(baseSeed()); t.after(unattributed.restore);
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04",
    slots: [Object.assign(slot("slot-mon", "monday"), { approved_by: "spoofed" })] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
  assert.equal(unattributed.tables.weekly_schedule.rows[0].approved_by || "", "");
});
