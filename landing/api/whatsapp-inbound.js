"use strict";

// Inbound WhatsApp replies. Replaces Workflow C.
//
// Necessarily public — Twilio cannot present a Supabase token — so the request
// signature IS the authentication. Nothing reaches a Sheet before it verifies.
//
// Shape: ingest, then interpret. The raw message is banked in inbound_messages
// on its own round trip, and only then resolved and applied. If interpretation
// fails, the log row survives saying the message arrived and why it did not take
// effect. That is the property the n8n version lacked, and it is what made
// diagnosing a missing reply require the Twilio console.

const { method, formBody, sendJson, apiError } = require("./_lib/http");
const { loadClinicalData, batchWrite } = require("./_lib/clinical-data");
const { verifySignature, requestUrl, sendMessage } = require("./_lib/twilio");
const { melbourneTimestamp } = require("./_lib/followup");
const {
  parseInbound, resolveReply, applyReply, barrierPromptOperation, confirmationFor
} = require("./_lib/feedback-store");
const { recordInbound, reloadLog, resolutionOperation } = require("./_lib/inbound-log");

// Twilio treats any 2xx as delivered and stops retrying. Returning 200 once the
// message is banked is deliberate: a retry would append a second log row and be
// rejected as a duplicate anyway, so there is nothing to gain by asking for one.
function ok(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/xml; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { raw, fields } = await formBody(req);

    if (!verifySignature({
      signature: req.headers["x-twilio-signature"],
      url: requestUrl(req),
      fields
    })) {
      // Nothing is logged: an unverified request is not evidence a patient sent
      // anything, and writing it would let anyone append to the study record.
      return sendJson(res, 403, { error: "invalid_signature" });
    }

    const receivedAt = melbourneTimestamp();
    const parsed = parseInbound(fields, receivedAt);
    // A malformed sender or a missing SID cannot be correlated to anything and
    // cannot be replayed usefully. Accepted and dropped, never retried.
    if (!parsed.valid) return ok(res);

    const data = await loadClinicalData(["inbound_messages", "user", "schedule_state"]);

    // --- Ingest -------------------------------------------------------------
    const logRow = await recordInbound(data.inbound_messages, parsed, fields);

    // --- Interpret ----------------------------------------------------------
    let resolution = null;
    let applied = false;
    let note = "";
    let operations = [];
    try {
      resolution = resolveReply({ parsed, users: data.user.rows, states: data.schedule_state.rows });
      const result = applyReply({
        resolution,
        stateTable: data.schedule_state,
        userTable: data.user,
        now: receivedAt
      });
      operations = result.operations;
      applied = result.applied;
      note = result.note;
    } catch (error) {
      // The log row still lands with the reason. Re-throwing here would lose the
      // only record that the patient replied at all.
      console.error("whatsapp-inbound interpretation failed", error);
      note = String((error && error.message) || "interpretation_failed").slice(0, 240);
    }

    const logTable = await reloadLog();
    operations.push(resolutionOperation({ logRow, logTable, resolution, applied, note }));
    await batchWrite(operations);

    // --- Acknowledge --------------------------------------------------------
    // After the writes, never before: a confirmation the patient can see must not
    // promise something the Sheet does not record.
    const body = resolution && applied ? confirmationFor(resolution) : null;
    if (body) {
      try {
        const sent = await sendMessage({ to: parsed.from_phone, body });
        // A "not yet" acknowledgement IS the barrier question, so its SID becomes
        // the handle that recognises the patient's next message as the answer.
        const barrierOp = barrierPromptOperation({
          resolution, stateTable: data.schedule_state, messageSid: sent.sid, now: receivedAt
        });
        if (barrierOp) await batchWrite([barrierOp]);
      } catch (error) {
        // The state is already correct; only the acknowledgement failed. Surfacing
        // a 500 to Twilio would trigger a retry that re-sends nothing useful.
        console.error("whatsapp-inbound confirmation send failed", error);
      }
    }

    return ok(res);
  } catch (error) {
    return apiError(res, error);
  }
};
