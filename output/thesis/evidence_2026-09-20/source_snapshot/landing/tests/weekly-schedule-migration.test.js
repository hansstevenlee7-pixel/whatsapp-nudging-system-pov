"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { seedWeeklySchedule } = require("../../scripts/seed-weekly-schedule");

test("migration creates one recurring slot while preserving sent delivery history", function () {
  const rows = seedWeeklySchedule([
    { nudge_id: "ndg-1", user_id: "p1", prescription_id: "rx1", status: "approved", nudge_type: "reminder", pillar: "sleep", message_body: "Source" },
    { nudge_id: "schd_ndg-1_20260720_0", user_id: "p1", prescription_id: "rx1", status: "sent", scheduled_date: "2026-07-20", scheduled_time: "09:00", message_body: "Old" },
    { nudge_id: "schd_ndg-1_20260727_0", user_id: "p1", prescription_id: "rx1", status: "approved", scheduled_date: "2026-07-27", scheduled_time: "10:30", message_body: "Current" }
  ], "2026-07-28T00:00:00.000Z");

  assert.equal(rows.length, 1);
  assert.equal(rows[0].day, "monday");
  assert.equal(rows[0].scheduled_time, "10:30");
  assert.equal(rows[0].message_body, "Current");
});
