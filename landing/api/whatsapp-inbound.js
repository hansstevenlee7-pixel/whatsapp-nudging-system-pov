"use strict";

// Fast inbound path: validate, persist exact text once, acknowledge, and leave
// interpretation to the asynchronous adaptation worker. STOP always wins and is
// handled immediately before any adaptive work is queued.

const { method, formBody, sendJson, apiError } = require("./_lib/http");
const { verifySignature, requestUrl, stripChannel } = require("./_lib/twilio");
const { loadClinicalData, batchWrite, operation } = require("./_lib/clinical-data");
const { behaviourKey } = require("./_lib/adaptive-core");
const adaptiveStore = require("./_lib/adaptive-store");
const crypto = require("node:crypto");

function xml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function twiml(res, message) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/xml; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response>" + (message ? `<Message>${xml(message)}</Message>` : "") + "</Response>");
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { fields } = await formBody(req);
    if (!verifySignature({ signature: req.headers["x-twilio-signature"], url: requestUrl(req), fields })) {
      return sendJson(res, 403, { error: "invalid_signature" });
    }
    const instruction = String(fields.OptOutType || fields.Body || "").trim().toUpperCase();
    const phone = stripChannel(fields.From);
    const data = await loadClinicalData(["user", "nudges", "schedule_state", "interaction_events"]);
    const user = data.user.rows.find(row => stripChannel(row.phone) === phone);
    if (!user) return twiml(res);
    const now = new Date().toISOString();
    if (instruction !== "STOP") {
      const sid = String(fields.MessageSid || "").trim();
      if (!/^SM[0-9a-fA-F]{32}$/.test(sid)) return sendJson(res, 400, { error: "invalid_message_sid" });
      const interactionId = "in_" + crypto.createHash("sha256").update(sid).digest("hex").slice(0, 24);
      const existing = data.interaction_events.rows.find(row => String(row.interaction_id) === interactionId || String(row.inbound_message_sid) === sid);
      if (!existing) {
        const replySid = String(fields.OriginalRepliedMessageSid || "").trim();
        const patientStates = data.schedule_state.rows.filter(row => String(row.user_id) === String(user.user_id) && row.wa_message_id);
        const state = patientStates.find(row => replySid && String(row.wa_message_id) === replySid) ||
          patientStates.slice().sort((a, b) => String(b.sent_at || b.last_updated || "").localeCompare(String(a.sent_at || a.last_updated || "")))[0];
        const nudge = state && data.nudges.rows.find(row => String(row.nudge_id) === String(state.nudge_id));
        let key = null;
        try { if (nudge) key = behaviourKey(nudge); } catch (_) {}
        const sheetEvent = {
          interaction_id: interactionId, event_at: now, inbound_message_sid: sid, user_id: user.user_id,
          from_phone: phone, reply_to_wa_message_id: replySid || state && state.wa_message_id || "",
          nudge_id: state && state.nudge_id || "", body: String(fields.Body || ""), media_count: Number(fields.NumMedia || 0),
          correlation_method: replySid && state ? "original_replied_message_sid" : state ? "latest_sent_nudge" : "unmatched",
          ack_status: "sent"
        };
        const operations = [operation("interaction_events", data.interaction_events, sheetEvent)];
        if (state) operations.push(operation("schedule_state", data.schedule_state, Object.assign({}, state, {
          interacted_at: state.interacted_at || now, last_inbound_message_sid: sid, last_updated: now
        }), state));
        await batchWrite(operations);
        await adaptiveStore.optional("recordInteraction", {
          interaction_id: interactionId, event_at: now, event_type: "inbound_reply", user_id: user.user_id,
          behaviour_key: key, nudge_id: state && state.nudge_id || null, wa_message_id: state && state.wa_message_id || null,
          inbound_message_sid: sid, reply_to_wa_message_id: replySid || null, body: String(fields.Body || ""),
          media_count: Number(fields.NumMedia || 0), correlation_method: sheetEvent.correlation_method,
          raw_payload: { from: fields.From, num_media: fields.NumMedia || "0" }
        });
      }
      return twiml(res, "Thank you — your reply has been received by the study team. Reply STOP at any time to opt out.");
    }

    const operations = [operation("user", data.user, Object.assign({}, user, { user_status: "opted_out" }), user)];
    data.nudges.rows.filter(row => String(row.user_id) === String(user.user_id) && String(row.status) === "approved" && !row.sent_at)
      .forEach(row => operations.push(operation("nudges", data.nudges, Object.assign({}, row, { status: "canceled" }), row)));
    data.schedule_state.rows.filter(row => String(row.user_id) === String(user.user_id) && !row.sent_at && !row.wa_message_id)
      .forEach(row => operations.push(operation("schedule_state", data.schedule_state, Object.assign({}, row, { status: "canceled", last_updated: now }), row)));
    await batchWrite(operations);
    return twiml(res);
  } catch (error) {
    return apiError(res, error);
  }
};
