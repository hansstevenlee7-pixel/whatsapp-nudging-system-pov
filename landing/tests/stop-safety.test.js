"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/whatsapp-inbound");
const { expectedSignature } = require("../api/_lib/twilio");
const { fixture } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function call(fields, token) {
  const url = "https://portal.example.test/api/whatsapp-inbound";
  const body = new URLSearchParams(fields).toString();
  const req = { method: "POST", url: "/api/whatsapp-inbound", body, headers: {
    host: "portal.example.test", "x-forwarded-proto": "https", "x-twilio-signature": expectedSignature(token, url, fields)
  } };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

test("signed STOP opts out the patient and cancels unsent rows", async t => {
  const token = "test-auth-token";
  const previous = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = token;
  t.after(() => { if (previous == null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous; });
  const fx = fixture({
    user: [{ user_id: "patient-1", phone: "+61411111111", user_status: "active", doctor_id: "doc-1" }],
    nudges: [{ nudge_id: "n-1", user_id: "patient-1", status: "approved", sent_at: "" }],
    schedule_state: [{ schedule_id: "sch-1", nudge_id: "n-1", user_id: "patient-1", status: "approved", sent_at: "", delivered_at: "", wa_message_id: "", last_updated: "" }]
  });
  t.after(() => fx.restore());
  const fields = { From: "whatsapp:+61411111111", Body: "STOP", MessageSid: "SM" + "c".repeat(32) };
  const res = await call(fields, token);
  assert.equal(res.statusCode, 200);
  assert.equal(fx.tables.user.rows[0].user_status, "opted_out");
  assert.equal(fx.tables.nudges.rows[0].status, "canceled");
  assert.equal(fx.tables.schedule_state.rows[0].status, "canceled");
});

test("ordinary signed replies are stored exactly once and acknowledged", async t => {
  const token = "test-auth-token";
  const previous = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_AUTH_TOKEN = token;
  t.after(() => { if (previous == null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous; });
  const fx = fixture({ user: [{ user_id: "patient-1", phone: "+61411111111", user_status: "active", doctor_id: "doc-1" }] });
  t.after(() => fx.restore());
  const fields = { From: "whatsapp:+61411111111", Body: "I prefer videos", MessageSid: "SM" + "d".repeat(32) };
  const res = await call(fields, token);
  assert.equal(res.statusCode, 200);
  assert.equal(fx.tables.user.rows[0].user_status, "active");
  assert.match(res.body, /reply has been received/);
  assert.equal(fx.tables.interaction_events.rows.length, 1);
  assert.equal(fx.tables.interaction_events.rows[0].body, "I prefer videos");
  await call(fields, token);
  assert.equal(fx.tables.interaction_events.rows.length, 1);
});

test("an invalid inbound signature is rejected before patient data is read or changed", async t => {
  const previous = process.env.TWILIO_AUTH_TOKEN; process.env.TWILIO_AUTH_TOKEN = "real-token";
  t.after(() => { if (previous == null) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = previous; });
  const fx = fixture({ user: [{ user_id: "patient-1", phone: "+61411111111", user_status: "active" }] });
  t.after(() => fx.restore());
  const fields = { From: "whatsapp:+61411111111", Body: "STOP", MessageSid: "SM" + "e".repeat(32) };
  const res = await call(fields, "wrong-token");
  assert.equal(res.statusCode, 403); assert.equal(JSON.parse(res.body).error, "invalid_signature");
  assert.equal(fx.tables.user.rows[0].user_status, "active"); assert.equal(fx.tables.interaction_events.rows.length, 0);
});
