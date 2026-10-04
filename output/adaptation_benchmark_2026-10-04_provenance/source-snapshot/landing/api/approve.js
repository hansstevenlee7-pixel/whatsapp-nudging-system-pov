"use strict";

const { sendJson, method, jsonBody, apiError, httpError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { assertPatientAccess } = require("./_lib/policy");
const { loadClinicalData, buildPatients } = require("./_lib/clinical-data");
const { saveSchedule } = require("./_lib/schedule-store");
const { queuePatientBehaviours, validateMediaSelections } = require("./_lib/adaptive-service");
const { recordClinicianChanges } = require("./_lib/clinician-adaptation");

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    const { profile } = await requireUser(req);
    const body = await jsonBody(req);
    if (!["approve", "reject"].includes(body.decision)) throw httpError(400, "decision must be approve or reject");
    const data = await loadClinicalData();
    const patients = buildPatients(data);
    const patient = assertPatientAccess(profile, patients, body.user_id);
    if (patient.user_status === "disabled" && body.decision === "approve") {
      throw httpError(409, "Reactivate this patient before approving a schedule");
    }
    if (body.decision !== "reject") await validateMediaSelections(body.user_id, body.slots, data.prescriptions.rows);
    const result = await saveSchedule(body, body.decision === "reject" ? "reject" : "approve", data, new Date(), { approved_by: profile.auth_user_id });
    if (body.decision !== "reject") {
      await recordClinicianChanges(body.user_id, patient.weekly_schedule || [], result.weekly_schedule || []);
      await queuePatientBehaviours(body.user_id, result.weekly_schedule, data.prescriptions.rows).catch(error => console.error("media search queue failed", error));
    }
    sendJson(res, 200, result);
  } catch (error) { apiError(res, error); }
};
