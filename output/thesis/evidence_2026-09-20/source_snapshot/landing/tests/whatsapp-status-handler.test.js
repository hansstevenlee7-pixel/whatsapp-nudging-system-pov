"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/whatsapp-status");
const { expectedSignature } = require("../api/_lib/twilio");
const { fixture } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function call(fields, signatureToken) {
  const url = "https://portal.example.test/api/whatsapp-status";
  const req = { method: "POST", url: "/api/whatsapp-status", body: new URLSearchParams(fields).toString(), headers: {
    host: "portal.example.test", "x-forwarded-proto": "https", "x-twilio-signature": expectedSignature(signatureToken, url, fields)
  } };
  const res = responseRecorder(); await handler(req, res); return res;
}

test("signed status callbacks correlate by Message SID and duplicate safely", async t => {
  const token = "status-token"; const previous = process.env.TWILIO_AUTH_TOKEN; process.env.TWILIO_AUTH_TOKEN = token;
  t.after(() => { if (previous == null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous; });
  const sid = "SM" + "f".repeat(32); const fx = fixture({ schedule_state: [{ schedule_id: "sch-1", nudge_id: "n-1", user_id: "p-1",
    status: "sent", sent_at: "2026-08-30T00:00:00Z", wa_message_id: sid, last_updated: "2026-08-30T00:00:00Z" }] });
  t.after(() => fx.restore()); const fields = { MessageSid: sid, MessageStatus: "delivered" };
  const first = await call(fields, token); const second = await call(fields, token);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).duplicate, true); assert.equal(fx.tables.delivery_events.rows.length, 1);
  assert.equal(fx.tables.schedule_state.rows[0].status, "delivered");
});

test("invalid status signatures fail closed without writing delivery evidence", async t => {
  const previous = process.env.TWILIO_AUTH_TOKEN; process.env.TWILIO_AUTH_TOKEN = "real-token";
  t.after(() => { if (previous == null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous; });
  const sid = "SM" + "a".repeat(32); const fx = fixture({ schedule_state: [{ schedule_id: "sch-1", nudge_id: "n-1", user_id: "p-1",
    status: "sent", sent_at: "now", wa_message_id: sid, last_updated: "now" }] });
  t.after(() => fx.restore()); const res = await call({ MessageSid: sid, MessageStatus: "delivered" }, "wrong-token");
  assert.equal(res.statusCode, 403); assert.equal(fx.tables.delivery_events.rows.length, 0); assert.equal(fx.tables.schedule_state.rows[0].status, "sent");
});
