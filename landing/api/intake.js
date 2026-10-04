"use strict";

const { sendJson, method, jsonBody, apiError, httpError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { listProfiles } = require("./_lib/supabase");
const { n8n } = require("./_lib/n8n");
const { allPatients } = require("./_lib/clinical-data");
const { resolveDoctorId, duplicatePhone } = require("./_lib/policy");
const { canAccessPatient } = require("./_lib/auth");

// Workflow A answers only through its Respond nodes. An execution that stops
// before one of them (a Gemini rate limit, a Sheets error) can still reach the
// portal as a 2xx without a confirmation, so a patient counts as created only
// when Respond Success names the patient that was submitted.
const NOT_CONFIRMED = "The intake workflow did not confirm that the patient was created. Check the Monitor before submitting again.";
const REJECTED = "The prescription could not be turned into a valid plan, so nothing was saved. Check the wording and submit again.";

async function submit(body) {
  try {
    return await n8n("/webhook/intake", { method: "POST", body: JSON.stringify(body) });
  } catch (error) {
    // Respond Rejected (422) sits before the first Sheets write.
    if (error.status === 422) throw httpError(422, REJECTED, { code: "intake_rejected" });
    console.error(error);
    return null;
  }
}

function confirmed(result, userId) {
  return Boolean(result && result.status === "ok" && result.user_id && (!userId || result.user_id === userId));
}

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
    const result = await submit(body);
    if (!confirmed(result, body.user.user_id)) {
      if (result) console.error("Workflow A returned without confirming the intake", { status: result.status || null, user_id: Boolean(result.user_id) });
      return sendJson(res, 502, { error: NOT_CONFIRMED, code: "intake_not_confirmed" });
    }
    sendJson(res, 200, result);
  } catch (error) { apiError(res, error); }
};
