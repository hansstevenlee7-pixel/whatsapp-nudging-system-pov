"use strict";

const { sendJson, method, apiError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { filterPatients } = require("./_lib/policy");
const { allPatients } = require("./_lib/clinical-data");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  try {
    const { profile } = await requireUser(req);
    const all = await allPatients();
    const patients = filterPatients(profile, all);
    sendJson(res, 200, { patients, count: patients.length, generated_at: new Date().toISOString() });
  } catch (error) { apiError(res, error); }
};
