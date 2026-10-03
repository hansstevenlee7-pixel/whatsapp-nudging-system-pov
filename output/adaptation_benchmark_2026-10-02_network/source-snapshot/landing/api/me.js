"use strict";

const { sendJson, method, apiError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  try {
    const { profile } = await requireUser(req);
    sendJson(res, 200, { profile });
  } catch (error) { apiError(res, error); }
};
