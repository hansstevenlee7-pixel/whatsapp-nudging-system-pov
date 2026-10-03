"use strict";

const { sendJson, method, jsonBody, apiError, httpError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { listProfiles } = require("./_lib/supabase");
const { n8n } = require("./_lib/n8n");
const { allPatients } = require("./_lib/clinical-data");
const { resolveDoctorId, duplicatePhone } = require("./_lib/policy");
const { canAccessPatient } = require("./_lib/auth");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { profile } = await requireUser(req);
    const body = await jsonBody(req);
    const profiles = profile.role === "admin" && body.assigned_doctor_id ? await listProfiles() : [];
    const doctorId = resolveDoctorId(profile, body.assigned_doctor_id, profiles);
    const patients = await allPatients();
    const duplicate = duplicatePhone(patients, body.user && body.user.phone);
    if (duplicate) {
      const accessible = canAccessPatient(profile, duplicate);
      throw httpError(409, accessible
        ? "A patient with this phone number already exists. Modify the existing record instead."
        : "This phone number is already registered.",
      accessible ? { code: "duplicate_phone", existing_user_id: duplicate.user_id } : { code: "duplicate_phone" });
    }
    body.user = Object.assign({}, body.user, { doctor_id: doctorId });
    body.prescription_input = Object.assign({}, body.prescription_input, { doctor_id: doctorId });
    delete body.assigned_doctor_id;
    const result = await n8n("/webhook/intake", { method: "POST", body: JSON.stringify(body) });
    sendJson(res, 200, result);
  } catch (error) { apiError(res, error); }
};
