"use strict";

// Isolation of an applied frequency change (thesis §4.6): another behaviour of
// the same patient and an occurrence whose delivery is already reserved must come
// through unchanged. Bookkeeping timestamps (updated_at, reviewed_at,
// last_updated) and the derived week_number may be rewritten by the shared save
// path; content, schedule and delivery state may not.

const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, baseSeed } = require("./sheets-fixture");
const { saveSchedule, applyAdaptiveSchedule } = require("../api/_lib/schedule-store");
const { behaviourKey } = require("../api/_lib/adaptive-core");

const SLEEP = { pillar: "sleep", category: "establish", action_text: "Be in bed by 10pm" };
const WALK = { pillar: "physical_activity", category: "increase", action_text: "Walk for 20 minutes" };
const BOOKKEEPING = new Set(["updated_at", "reviewed_at", "last_updated", "week_number"]);

function slot(id, day, behaviour, prescriptionId, sourceId, body) {
  return Object.assign({ schedule_slot_id: id, source_nudge_id: sourceId, prescription_id: prescriptionId, day, time: "09:00",
    nudge_type: "reminder", tone_variant: "encouraging", message_body: body, message_body_alt: "",
    template_name: "health_plan_reminder", media_selection_mode: "automatic", media_override_asset_id: "" }, behaviour);
}

async function twoBehaviourPatient() {
  const seed = baseSeed();
  seed.prescriptions.push({ prescription_id: "rx-2", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-07-01",
    pillar: "physical_activity", category: "increase", target_behavior: "", frequency_per_week: 2, duration_weeks: 8,
    prescription_raw_text: "Walk more", status: "active" });
  seed.nudges.push(Object.assign({}, seed.nudges[0], WALK, { nudge_id: "source-walk", prescription_id: "rx-2", message_body: "Walk" }));
  const fx = fixture(seed);
  await saveSchedule({ user_id: "patient-1", start_date: "2026-09-07", end_date: "2026-10-04", slots: [
    slot("slot-mon", "monday", SLEEP, "rx-1", "source-wed", "Prepare for sleep"),
    slot("slot-thu", "thursday", SLEEP, "rx-1", "source-wed", "Prepare for sleep"),
    slot("walk-tue", "tuesday", WALK, "rx-2", "source-walk", "Time to walk"),
    slot("walk-sat", "saturday", WALK, "rx-2", "source-walk", "Time to walk")
  ] }, "approve", undefined, new Date("2026-09-01T00:00:00Z"));
  return fx;
}

// Reserve an occurrence exactly as prepareDelivery does: the nudge carries the
// selected media and decision, and its delivery state is "sending".
function reserve(fx, nudgeId) {
  Object.assign(fx.tables.nudges.rows.find(row => row.nudge_id === nudgeId), {
    message_body: "Prepare for sleep\n\nSleep guide — Source\nhttps://portal.invalid/api/r/token", media_asset_id: "asset-1",
    adaptation_decision_id: "selection-1" });
  Object.assign(fx.tables.schedule_state.rows.find(row => row.nudge_id === nudgeId), {
    status: "sending", delivery_attempt_id: "att_1", submission_started_at: "2026-09-08T23:00:00.000Z" });
}

function content(row) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !BOOKKEEPING.has(key)));
}

function rowsOf(fx, table, predicate) {
  return JSON.parse(JSON.stringify(fx.tables[table].rows.filter(predicate))).map(content);
}

const isWalk = row => row.pillar === "physical_activity" || String(row.nudge_id || "").startsWith("schd_walk-");

test("an applied frequency change leaves another behaviour's slots, occurrences and delivery state unchanged", async function (t) {
  const fx = await twoBehaviourPatient(); t.after(fx.restore);
  const walkNudgeIds = new Set(fx.tables.nudges.rows.filter(isWalk).map(row => row.nudge_id));
  const before = { slots: rowsOf(fx, "weekly_schedule", isWalk), nudges: rowsOf(fx, "nudges", isWalk),
    states: rowsOf(fx, "schedule_state", row => walkNudgeIds.has(row.nudge_id)) };
  assert.ok(before.slots.length === 2 && before.nudges.length > 2 && before.states.length > 0);

  const result = await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: behaviourKey(SLEEP), target_frequency: 1,
    adaptation_decision_id: "policy-1", now: "2026-09-09T00:00:00.000Z" });

  assert.equal(result.applied, true);
  assert.equal(fx.tables.weekly_schedule.rows.filter(row => row.status === "active" && row.pillar === "sleep").length, 1);
  assert.deepEqual(rowsOf(fx, "weekly_schedule", isWalk), before.slots);
  assert.deepEqual(rowsOf(fx, "nudges", isWalk), before.nudges);
  assert.deepEqual(rowsOf(fx, "schedule_state", row => walkNudgeIds.has(row.nudge_id)), before.states);
});

test("a reserved occurrence is neither rejected nor rebuilt when its behaviour's frequency changes", async function (t) {
  const fx = await twoBehaviourPatient(); t.after(fx.restore);
  // One reserved occurrence on the slot that the decrease keeps, one on the slot it removes.
  const reserved = ["schd_slot-mon_20260914", "schd_slot-thu_20260910"];
  reserved.forEach(id => reserve(fx, id));
  const before = { nudges: rowsOf(fx, "nudges", row => reserved.includes(row.nudge_id)),
    states: JSON.parse(JSON.stringify(fx.tables.schedule_state.rows.filter(row => reserved.includes(row.nudge_id)))) };

  const result = await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: behaviourKey(SLEEP), target_frequency: 1,
    adaptation_decision_id: "policy-1", now: "2026-09-09T00:00:00.000Z" });

  assert.equal(result.applied, true);
  assert.deepEqual(fx.tables.weekly_schedule.rows.filter(row => row.status === "active" && row.pillar === "sleep")
    .map(row => row.schedule_slot_id), ["slot-mon"]);
  assert.deepEqual(rowsOf(fx, "nudges", row => reserved.includes(row.nudge_id)), before.nudges);
  assert.deepEqual(fx.tables.schedule_state.rows.filter(row => reserved.includes(row.nudge_id)), before.states);
  // Unreserved future occurrences of the removed slot are still rejected.
  assert.equal(fx.tables.nudges.rows.find(row => row.nudge_id === "schd_slot-thu_20260917").status, "rejected");
  assert.equal(fx.tables.schedule_state.rows.find(row => row.nudge_id === "schd_slot-thu_20260917").status, "rejected");
});
