"use strict";

const crypto = require("node:crypto");
const { httpError } = require("./http");
const { loadClinicalData, batchWrite, operation } = require("./clinical-data");
const adaptiveStore = require("./adaptive-store");

const ALLOWED_STATUSES = new Set(["accepted", "queued", "sending", "sent", "delivered", "read", "failed", "undelivered", "canceled"]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

function canonicalStatus(value) {
  const status = text(value).toLowerCase();
  return ALLOWED_STATUSES.has(status) ? status : "unknown";
}

function eventId(fields) {
  return "evt_" + crypto.createHash("sha256").update([
    text(fields.MessageSid), text(fields.MessageStatus), text(fields.ErrorCode), text(fields.Timestamp)
  ].join("|")).digest("hex").slice(0, 24);
}

async function recordDeliveryStatus(fields, now = new Date().toISOString()) {
  const sid = text(fields.MessageSid);
  if (!/^SM[0-9a-fA-F]{32}$/.test(sid)) throw httpError(400, "MessageSid is missing or invalid");
  const data = await loadClinicalData(["schedule_state", "delivery_events"]);
  const state = data.schedule_state.rows.find(row => text(row.wa_message_id) === sid);
  if (!state) throw httpError(404, "No scheduled nudge matches this MessageSid");

  const status = canonicalStatus(fields.MessageStatus);
  const id = eventId(fields);
  const existingEvent = data.delivery_events.rows.find(row => text(row.event_id) === id);
  if (existingEvent) return { duplicate: true, status, nudge_id: state.nudge_id };

  const event = {
    event_id: id,
    event_at: now,
    wa_message_id: sid,
    nudge_id: state.nudge_id,
    user_id: state.user_id,
    status,
    error_code: text(fields.ErrorCode),
    error_message: text(fields.ErrorMessage).slice(0, 500),
    channel_to: text(fields.To),
    raw_payload: JSON.stringify(fields).slice(0, 4000)
  };
  const nextState = Object.assign({}, state, {
    status,
    delivered_at: ["delivered", "read"].includes(status) ? (state.delivered_at || now) : state.delivered_at,
    read_at: status === "read" ? (state.read_at || now) : state.read_at,
    last_updated: now
  });
  await batchWrite([
    operation("delivery_events", data.delivery_events, event),
    operation("schedule_state", data.schedule_state, nextState, state)
  ]);
  await adaptiveStore.optional("recordInteraction", {
    interaction_id: id, event_at: now, event_type: "delivery_status", user_id: state.user_id,
    nudge_id: state.nudge_id, wa_message_id: sid, status, correlation_method: "twilio_message_sid", raw_payload: fields
  });
  return { duplicate: false, status, nudge_id: state.nudge_id };
}

module.exports = { ALLOWED_STATUSES, canonicalStatus, eventId, recordDeliveryStatus };
