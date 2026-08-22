"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./sheets-fixture");
const { recordDeliveryStatus, canonicalStatus } = require("../api/_lib/delivery-store");

test("canonicalStatus accepts Twilio delivery states and bounds unknown values", () => {
  assert.equal(canonicalStatus("DELIVERED"), "delivered");
  assert.equal(canonicalStatus("something-new"), "unknown");
});

test("delivery callback appends an audit event and updates current state", async t => {
  const sid = "SM" + "a".repeat(32);
  const fx = fixture({ schedule_state: [{ schedule_id: "sch-1", nudge_id: "n-1", user_id: "patient-1", status: "sent", sent_at: "2026-08-22T09:00:00+10:00", delivered_at: "", wa_message_id: sid, last_updated: "2026-08-22T09:00:00+10:00" }] });
  t.after(() => fx.restore());
  const result = await recordDeliveryStatus({ MessageSid: sid, MessageStatus: "delivered", To: "whatsapp:+61411111111" }, "2026-08-22T09:00:05+10:00");
  assert.equal(result.status, "delivered");
  assert.equal(fx.tables.delivery_events.rows.length, 1);
  assert.equal(fx.tables.delivery_events.rows[0].status, "delivered");
  assert.equal(fx.tables.schedule_state.rows[0].status, "delivered");
  assert.equal(fx.tables.schedule_state.rows[0].delivered_at, "2026-08-22T09:00:05+10:00");
});

test("duplicate delivery callbacks are idempotent", async t => {
  const sid = "SM" + "b".repeat(32);
  const fx = fixture({ schedule_state: [{ schedule_id: "sch-1", nudge_id: "n-1", user_id: "patient-1", status: "sent", sent_at: "now", delivered_at: "", wa_message_id: sid, last_updated: "now" }] });
  t.after(() => fx.restore());
  const fields = { MessageSid: sid, MessageStatus: "read", To: "whatsapp:+61411111111" };
  await recordDeliveryStatus(fields, "2026-08-22T10:00:00+10:00");
  const duplicate = await recordDeliveryStatus(fields, "2026-08-22T10:00:01+10:00");
  assert.equal(duplicate.duplicate, true);
  assert.equal(fx.tables.delivery_events.rows.length, 1);
});
