"use strict";

const { sendJson, method, jsonBody, apiError, httpError } = require("./_lib/http");
const { requireUser, canAccessPatient } = require("./_lib/auth");
const { assertPatientAccess, duplicatePhone, normalizePhone } = require("./_lib/policy");
const { allPatients, updateUser } = require("./_lib/clinical-data");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["PATCH", "DELETE"])) return;
  try {
    const { profile } = await requireUser(req);
    const body = await jsonBody(req);
    const patients = await allPatients();
    const patient = assertPatientAccess(profile, patients, String(body.user_id || "").trim());
    const name = String(body.name == null ? patient.name || "" : body.name).trim();
    const email = String(body.email == null ? patient.email || "" : body.email).trim();
    const phone = normalizePhone(body.phone == null ? patient.phone : body.phone);
    // DELETE is intentionally reversible for clinical traceability: linked rows and
    // audit history remain intact while the patient is excluded from active delivery.
    const userStatus = req.method === "DELETE"
      ? "disabled"
      : String(body.user_status == null ? patient.user_status || "active" : body.user_status);
    if (!name) throw httpError(400, "Patient name is required");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, "Patient email is invalid");
    if (!["active", "disabled", "paused", "opted_out"].includes(userStatus)) throw httpError(400, "Patient status is invalid");
    const duplicate = duplicatePhone(patients, phone, patient.user_id);
    if (duplicate) {
      const details = canAccessPatient(profile, duplicate) ? { code: "duplicate_phone", existing_user_id: duplicate.user_id } : { code: "duplicate_phone" };
      throw httpError(409, "This phone number is already registered to another patient.", details);
    }
    const update = { user_id: patient.user_id, name, phone, email, user_status: userStatus };
    const persisted = await updateUser(patient.user_id, update);
    sendJson(res, 200, { status: "ok", persisted: true, patient: Object.assign({}, patient, persisted) });
  } catch (error) { apiError(res, error); }
};
