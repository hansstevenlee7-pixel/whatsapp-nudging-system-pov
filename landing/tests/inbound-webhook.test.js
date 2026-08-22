"use strict";

// The inbound reply endpoint: signature, parsing, and the append-only log.
//
// None of this could be tested while the reply path lived in n8n. Signature
// validation did not exist, the form parsing was a Code node reached only through
// a webhook, and there was no log at all — a reply that failed to resolve left no
// trace, which is exactly how a missing patient reply became undiagnosable.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { parseForm } = require("../api/_lib/http");
const { expectedSignature, verifySignature, requestUrl, stripChannel } = require("../api/_lib/twilio");
const { buildRow, resolutionOperation, RAW_PAYLOAD_MAX } = require("../api/_lib/inbound-log");
const { parseInbound, resolveReply, applyReply, confirmationFor } = require("../api/_lib/feedback-store");
const { HEADERS } = require("./sheets-fixture");

const AUTH_TOKEN = "test_auth_token";
const URL = "https://portal.test/api/whatsapp-inbound";

const twilioFields = (over = {}) => Object.assign({
  AccountSid: "AC11111111111111111111111111111111",
  From: "whatsapp:+61406802419",
  To: "whatsapp:+14155238886",
  Body: "Yes",
  ButtonText: "Yes",
  ButtonPayload: "YES",
  MessageSid: "SM11111111111111111111111111111111",
  OriginalRepliedMessageSid: "MM7e73d12e90e9a5423b9ab2db5f510a4a",
  NumMedia: "0"
}, over);

function logTableFor(rows = []) {
  return {
    headers: HEADERS.inbound_messages.slice(),
    rows: rows.map((row, index) => Object.assign({ row_number: index + 2 }, row))
  };
}

// ---- Signature ------------------------------------------------------------

test("a correctly signed request verifies and a tampered one does not", () => {
  const fields = twilioFields();
  const signature = expectedSignature(AUTH_TOKEN, URL, fields);

  assert.equal(verifySignature({ signature, url: URL, fields, authToken: AUTH_TOKEN }), true);

  // Every one of these is a real attack shape, not a hypothetical: the endpoint
  // is public, so an unsigned or replayed-from-elsewhere POST is the threat.
  assert.equal(verifySignature({ signature: "", url: URL, fields, authToken: AUTH_TOKEN }), false, "missing signature");
  assert.equal(verifySignature({ signature: signature.slice(0, -1) + "X", url: URL, fields, authToken: AUTH_TOKEN }), false, "altered signature");
  assert.equal(verifySignature({ signature: "short", url: URL, fields, authToken: AUTH_TOKEN }), false, "wrong-length signature must not throw");
  assert.equal(verifySignature({ signature, url: URL + "?x=1", fields, authToken: AUTH_TOKEN }), false, "a different URL");
  assert.equal(verifySignature({ signature, url: URL, fields: Object.assign({}, fields, { ButtonPayload: "NO" }), authToken: AUTH_TOKEN }), false,
    "flipping the answer invalidates the signature — this is what stops a forged NO");
  assert.equal(verifySignature({ signature, url: URL, fields, authToken: "wrong_token" }), false, "a different account token");
});

test("the signature is order-independent, because Twilio sorts the fields", () => {
  const fields = twilioFields();
  const shuffled = {};
  Object.keys(fields).sort().reverse().forEach(key => { shuffled[key] = fields[key]; });
  assert.equal(expectedSignature(AUTH_TOKEN, URL, shuffled), expectedSignature(AUTH_TOKEN, URL, fields));
});

test("the signed URL is rebuilt from the proxy headers, not from req.url", () => {
  // Vercel terminates TLS upstream, so req.url is a bare path. Twilio signed the
  // public https URL it actually called; signing the path would never match.
  const req = {
    url: "/api/whatsapp-inbound",
    headers: { host: "internal.local", "x-forwarded-proto": "https", "x-forwarded-host": "portal.test" }
  };
  assert.equal(requestUrl(req), URL);
  // A comma-separated forwarding chain keeps only the first hop.
  req.headers["x-forwarded-proto"] = "https,http";
  req.headers["x-forwarded-host"] = "portal.test,inner.local";
  assert.equal(requestUrl(req), URL);
});

// ---- Form parsing ---------------------------------------------------------

test("form bodies parse the way Twilio sends them", () => {
  const raw = "From=whatsapp%3A%2B61406802419&Body=Not+yet&ButtonPayload=NOT_YET&MessageSid=SM1";
  const fields = parseForm(raw);
  assert.equal(fields.From, "whatsapp:+61406802419");
  assert.equal(fields.Body, "Not yet", "+ is a space in form encoding, not a plus sign");
  assert.equal(fields.ButtonPayload, "NOT_YET");
  assert.deepEqual(parseForm(""), {});
  assert.equal(stripChannel("whatsapp:+61406802419"), "+61406802419");
});

test("a quick-reply payload beats the visible text, which beats the body", () => {
  const both = parseInbound(twilioFields({ Body: "yeah ok", ButtonText: "Yes", ButtonPayload: "YES" }));
  assert.equal(both.reply_value, "YES");
  const noPayload = parseInbound(twilioFields({ Body: "yeah ok", ButtonText: "Yes", ButtonPayload: "" }));
  assert.equal(noPayload.reply_value, "Yes");
  const typed = parseInbound(twilioFields({ Body: "yeah ok", ButtonText: "", ButtonPayload: "" }));
  assert.equal(typed.reply_value, "yeah ok");
});

test("a malformed sender or a missing SID is not accepted as a reply", () => {
  assert.equal(parseInbound(twilioFields()).valid, true);
  assert.equal(parseInbound(twilioFields({ From: "whatsapp:not-a-number" })).valid, false);
  assert.equal(parseInbound(twilioFields({ MessageSid: "" })).valid, false);
});

// ---- The log --------------------------------------------------------------

test("the raw row is complete before anything is interpreted", () => {
  const fields = twilioFields();
  const parsed = parseInbound(fields, "2026-08-11T18:07:22+10:00");
  const row = buildRow(parsed, fields);

  // Every column exists, so the append cannot silently drop a value.
  assert.deepEqual(Object.keys(row).sort(), HEADERS.inbound_messages.slice().sort());

  assert.match(row.inbound_id, /^in_\d{14}_[0-9a-f]{8}$/);
  assert.equal(row.received_at, "2026-08-11T18:07:22+10:00");
  assert.equal(row.from_phone, "+61406802419");
  assert.equal(row.wa_message_id, fields.MessageSid);
  assert.equal(row.context_wa_id, fields.OriginalRepliedMessageSid,
    "the replied-to SID is what makes an unresolved reply diagnosable after the fact");
  assert.equal(row.button_payload, "YES");

  // Resolution fields start empty and pessimistic: a row that never reaches the
  // second write must not claim it took effect.
  assert.equal(row.applied, "FALSE");
  assert.deepEqual([row.user_id, row.matched_nudge_id, row.stage, row.classification, row.note], ["", "", "", "", ""]);
  assert.equal(JSON.parse(row.raw_payload).ButtonPayload, "YES");
});

test("two messages in the same second still get distinct ids", () => {
  const fields = twilioFields();
  const parsed = parseInbound(fields, "2026-08-11T18:07:22+10:00");
  const ids = new Set(Array.from({ length: 50 }, () => buildRow(parsed, fields).inbound_id));
  assert.equal(ids.size, 50);
});

test("an oversized payload is truncated rather than dropped", () => {
  const fields = twilioFields({ Body: "x".repeat(4000) });
  const row = buildRow(parseInbound(fields), fields);
  assert.ok(row.raw_payload.length <= RAW_PAYLOAD_MAX);
  assert.ok(row.raw_payload.length > 0, "a long message still leaves evidence it arrived");
});

test("the resolution patches the logged row instead of appending a second one", () => {
  const fields = twilioFields();
  const parsed = parseInbound(fields, "2026-08-11T18:07:22+10:00");
  const logRow = buildRow(parsed, fields);
  // The table as re-read AFTER the append: this is what carries row_number, and
  // without it the update would append a duplicate.
  const logTable = logTableFor([logRow]);

  const states = [{
    user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_commitment",
    wa_message_id: fields.OriginalRepliedMessageSid, followup_enabled: "TRUE",
    followup_delay_hours: "4", followup_due_at: "2026-08-11T21:54:00+10:00",
    sent_at: "2026-08-11T17:54:00+10:00"
  }];
  const resolution = resolveReply({
    parsed, states,
    users: [{ user_id: "usr_1", phone: "+61406802419", user_status: "active" }]
  });
  assert.equal(resolution.reply_type, "commit_yes");

  const op = resolutionOperation({ logRow, logTable, resolution, applied: true, note: "" });
  assert.equal(op.tab, "inbound_messages");
  assert.equal(op.rowNumber, 2, "an update, not an append");
  assert.equal(op.row.classification, "commit_yes");
  assert.equal(op.row.stage, "commitment");
  assert.equal(op.row.matched_nudge_id, "ndg_1");
  assert.equal(op.row.applied, "TRUE");
  // The raw fields survive the patch untouched.
  assert.equal(op.row.wa_message_id, fields.MessageSid);
  assert.equal(op.row.context_wa_id, fields.OriginalRepliedMessageSid);
});

test("every unapplied outcome records why, and none of them claims to have applied", () => {
  const cases = {
    unknown_patient: { users: [], states: [], expectNote: "unknown_patient" },
    duplicate: {
      users: [{ user_id: "usr_1", phone: "+61406802419", user_status: "active" }],
      states: [{ user_id: "usr_1", nudge_id: "ndg_1", response_wa_id: "SM11111111111111111111111111111111" }],
      expectNote: "duplicate"
    },
    no_match: {
      users: [{ user_id: "usr_1", phone: "+61406802419", user_status: "active" }],
      states: [],
      expectNote: "no_match"
    }
  };

  for (const [label, { users, states, expectNote }] of Object.entries(cases)) {
    const fields = twilioFields();
    const parsed = parseInbound(fields, "2026-08-11T18:07:22+10:00");
    const resolution = resolveReply({ parsed, users, states });
    const result = applyReply({
      resolution,
      stateTable: { headers: HEADERS.schedule_state.slice(), rows: [] },
      userTable: { headers: ["user_id", "user_status"], rows: [] },
      now: "2026-08-11T18:07:22+10:00"
    });
    assert.equal(result.applied, false, `${label} must not report applied`);
    assert.equal(result.note, expectNote, `${label} records why`);
    assert.deepEqual(result.operations, [], `${label} writes no state`);

    const logRow = buildRow(parsed, fields);
    const op = resolutionOperation({ logRow, logTable: logTableFor([logRow]), resolution, applied: false, note: result.note });
    assert.equal(op.row.applied, "FALSE");
    assert.equal(op.row.note, expectNote);
    // The record that a message arrived survives regardless.
    assert.equal(op.row.wa_message_id, fields.MessageSid);
  }
});

test("a duplicate and an unknown sender are answered with silence", () => {
  // A retry must not re-message the patient, and a wrong number must never be
  // messaged at all.
  assert.equal(confirmationFor({ reply_type: "duplicate" }), null);
  assert.equal(confirmationFor({ reply_type: "unknown_patient" }), null);
  assert.equal(confirmationFor({ reply_type: "stop_optout" }), null);
  // But a reply we understood but could not place still gets guidance.
  assert.match(confirmationFor({ reply_type: "unknown" }), /tap one of the buttons/i);
});
