"use strict";

// Safety-only inbound path. This send-and-observe project does not collect
// progress, barriers, commitments, or outcomes. The sole accepted instruction is
// STOP, which immediately opts the patient out and cancels future unsent nudges.

const { method, formBody, sendJson, apiError } = require("./_lib/http");
const { verifySignature, requestUrl, stripChannel } = require("./_lib/twilio");
const { loadClinicalData, batchWrite, operation } = require("./_lib/clinical-data");

function twiml(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/xml; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { fields } = await formBody(req);
    if (!verifySignature({ signature: req.headers["x-twilio-signature"], url: requestUrl(req), fields })) {
      return sendJson(res, 403, { error: "invalid_signature" });
    }
    const instruction = String(fields.OptOutType || fields.Body || "").trim().toUpperCase();
    if (instruction !== "STOP") return twiml(res);

    const phone = stripChannel(fields.From);
    const data = await loadClinicalData(["user", "nudges", "schedule_state"]);
    const user = data.user.rows.find(row => stripChannel(row.phone) === phone);
    if (!user) return twiml(res);
    const now = new Date().toISOString();
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
