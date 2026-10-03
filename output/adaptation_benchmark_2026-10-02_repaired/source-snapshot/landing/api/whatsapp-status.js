"use strict";

const { method, formBody, sendJson, apiError } = require("./_lib/http");
const { verifySignature, requestUrl } = require("./_lib/twilio");
const { recordDeliveryStatus } = require("./_lib/delivery-store");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { fields } = await formBody(req);
    if (!verifySignature({
      signature: req.headers["x-twilio-signature"],
      url: requestUrl(req),
      fields
    })) return sendJson(res, 403, { error: "invalid_signature" });

    const result = await recordDeliveryStatus(fields);
    return sendJson(res, 200, { ok: true, duplicate: result.duplicate });
  } catch (error) {
    return apiError(res, error);
  }
};
