"use strict";

// Clinician prescription CRUD. Direct Sheets, never n8n — Workflow A owns intake,
// but every correction after that belongs to the doctor.
const { sendJson, method, jsonBody, apiError, httpError } = require("./_lib/http");
const { requireUser } = require("./_lib/auth");
const { assertPatientAccess, resolveDoctorId } = require("./_lib/policy");
const { loadClinicalData, buildPatients } = require("./_lib/clinical-data");
const { listProfiles } = require("./_lib/supabase");
const { createPrescription, updatePrescription, archivePrescription, reactivatePrescription } = require("./_lib/prescription-store");

const EDITABLE = ["pillar", "category", "frequency_per_week", "duration_weeks", "issued_date", "prescription_raw_text"];

module.exports = async function handler(req, res) {
  if (!method(req, res, ["POST", "PATCH", "DELETE"])) return;
  try {
    const { profile } = await requireUser(req);
    const body = await jsonBody(req);
    const data = await loadClinicalData();
    const patients = buildPatients(data);
    const patient = assertPatientAccess(profile, patients, String(body.user_id || "").trim());
    const active = String(patient.user_status || "active") === "active";

    let result;
    if (req.method === "POST") {
      // Create is only meaningful when the patient can actually be scheduled.
      if (!active) throw httpError(409, "Reactivate this patient before adding a prescription");
      // Ownership is the patient's, so an admin acting for another clinician does
      // not silently reassign the record. resolveDoctorId only covers the gap
      // where the patient row itself carries no clinician.
      const doctorId = String(patient.doctor_id || "").trim() ||
        resolveDoctorId(profile, body.doctor_id, profile.role === "admin" ? await listProfiles() : []);
      result = await createPrescription(patient.user_id, doctorId, body);
    } else {
      // Resolve against the raw rows: patient.prescriptions excludes archived
      // ones, which are exactly the rows reactivate exists to reach.
      const prescriptionId = String(body.prescription_id || "").trim();
      if (!prescriptionId) throw httpError(400, "prescription_id is required");
      if (req.method === "DELETE") {
        result = await archivePrescription(patient.user_id, prescriptionId);
      } else if (body.status != null) {
        if (String(body.status) !== "active") throw httpError(400, "Only reactivation to active is supported here; use DELETE to archive");
        if (!active) throw httpError(409, "Reactivate this patient before reactivating a prescription");
        result = await reactivatePrescription(patient.user_id, prescriptionId);
      } else {
        const changes = {};
        for (const key of EDITABLE) if (body[key] != null) changes[key] = body[key];
        result = { prescription: await updatePrescription(patient.user_id, prescriptionId, changes) };
      }
    }

    // Hand back the rebuilt patient so the client can swap state in without a
    // second round trip — the cascade changes nudges and weekly_schedule too.
    const refreshed = buildPatients(await loadClinicalData()).find(item => String(item.user_id) === String(patient.user_id));
    sendJson(res, 200, Object.assign({ status: "ok", persisted: true, patient: refreshed }, result));
  } catch (error) { apiError(res, error); }
};
