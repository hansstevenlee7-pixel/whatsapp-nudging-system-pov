"use strict";

const { sendJson, method, apiError, httpError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { filterPatients, assertPatientAccess } = require("./_lib/policy");
const { allPatients } = require("./_lib/clinical-data");
const adaptiveStore = require("./_lib/adaptive-store");
const { buildPatientDictionary } = require("./_lib/patient-dictionary");
const { exportPatientDictionary } = require("./_lib/patient-dictionary-export");

function dateParam(value, name) {
  const text = String(value || "").trim();
  if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, `${name} must be YYYY-MM-DD`);
  return text;
}

async function dictionary(req, res) {
  const { profile } = await requireUser(req);
  const url = new URL(req.url, "https://portal.invalid");
  const userId = String(url.searchParams.get("user_id") || "").trim();
  if (!userId) throw httpError(400, "user_id is required");
  const from = dateParam(url.searchParams.get("from"), "from");
  const to = dateParam(url.searchParams.get("to"), "to");
  if (from && to && from > to) throw httpError(400, "from must be before to");
  const patient = assertPatientAccess(profile, await allPatients(), userId);
  let adaptive = {}; let adaptive_available = false;
  if (adaptiveStore.configured()) { adaptive = await adaptiveStore.call("plansForUser", userId); adaptive_available = true; }
  const result = buildPatientDictionary({ patient, adaptive, from, to });
  result.adaptive_available = adaptive_available;
  if (url.searchParams.get("export") === "1") result.export = await exportPatientDictionary(result);
  return sendJson(res, 200, result);
}

module.exports = async function handler(req, res) {
  if (!method(req, res, ["GET"])) return;
  try {
    const url = new URL(req.url, "https://portal.invalid");
    if (url.searchParams.get("op") === "dictionary") return await dictionary(req, res);
    const { profile } = await requireUser(req);
    const all = await allPatients();
    const patients = filterPatients(profile, all);
    sendJson(res, 200, { patients, count: patients.length, generated_at: new Date().toISOString() });
  } catch (error) { apiError(res, error); }
};
