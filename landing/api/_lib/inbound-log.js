"use strict";

// The append-only inbound event log.
//
// Written BEFORE the reply is interpreted, and that ordering is the whole point:
// the record that a message arrived must never depend on our ability to
// understand it. Before this existed, a reply that failed to resolve left no
// trace at all, and "did Twilio even deliver it?" could only be answered from a
// vendor console — outside the study record.
//
// This is a log, not state. schedule_state remains the state machine and the only
// thing the schedulers read.

const crypto = require("node:crypto");
const { loadClinicalData, batchWrite, operation } = require("./clinical-data");
const { melbourneTimestamp } = require("./followup");

const RAW_PAYLOAD_MAX = 1024;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function inboundId(receivedAt) {
  const stamp = text(receivedAt).replace(/[^0-9]/g, "").slice(0, 14) || "unknown";
  return `in_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
}

// Truncated rather than dropped: a mis-parsed message can still be reprocessed
// from what the vendor actually sent, and Sheets cells cap out well below this.
function rawPayload(fields) {
  try {
    return JSON.stringify(fields || {}).slice(0, RAW_PAYLOAD_MAX);
  } catch {
    return "";
  }
}

function buildRow(parsed, fields) {
  const receivedAt = parsed.received_at || melbourneTimestamp();
  return {
    inbound_id: inboundId(receivedAt),
    received_at: receivedAt,
    from_phone: parsed.from_phone || "",
    to_phone: parsed.to_phone || "",
    wa_message_id: parsed.incoming_wa_id || "",
    context_wa_id: parsed.context_wa_id || "",
    body: parsed.reply_body || "",
    button_text: parsed.button_text || "",
    button_payload: parsed.button_payload || "",
    opt_out_type: parsed.opt_out_type || "",
    // Filled by resolution, in the second write.
    user_id: "", matched_nudge_id: "", stage: "", classification: "",
    applied: "FALSE", note: "",
    raw_payload: rawPayload(fields)
  };
}

// Step 1 of two. Appends the raw record immediately, on its own round trip: if
// interpretation throws afterwards, this row survives to say the message arrived.
async function recordInbound(table, parsed, fields) {
  const row = buildRow(parsed, fields);
  await batchWrite([operation("inbound_messages", table, row, null)]);
  return row;
}

// Locating the appended row needs a fresh read — the table handed to
// recordInbound predates the append, so it carries no row_number for it and an
// update built from it would append a duplicate instead of patching. inbound_id
// is unique per webhook hit (retries included), so it is the safe key.
async function reloadLog() {
  const data = await loadClinicalData(["inbound_messages"]);
  return data.inbound_messages;
}

// Step 2. Produces the operation that fills in how the message was resolved, to
// be batched together with the schedule_state writes so log and state move in one
// call — a log row claiming applied=TRUE can never outlive a failed state write.
function resolutionOperation({ logRow, logTable, resolution, applied, note }) {
  const existing = (logTable.rows || []).find(row => text(row.inbound_id) === text(logRow.inbound_id));
  const changes = {
    user_id: text(resolution && resolution.user_id),
    matched_nudge_id: text(resolution && resolution.nudge_id),
    stage: text(resolution && resolution.stage),
    classification: text(resolution && resolution.reply_type),
    applied: applied ? "TRUE" : "FALSE",
    note: text(note)
  };
  // Merge onto whichever view is newer, then write the whole row back.
  const merged = Object.assign({}, logRow, existing || {}, changes);
  delete merged.row_number;
  return operation("inbound_messages", logTable, merged, existing || null);
}

module.exports = {
  RAW_PAYLOAD_MAX, buildRow, recordInbound, reloadLog, resolutionOperation, inboundId
};
