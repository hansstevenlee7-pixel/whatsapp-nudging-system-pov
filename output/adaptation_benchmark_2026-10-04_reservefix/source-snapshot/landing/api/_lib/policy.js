"use strict";

const { httpError } = require("./http");
const { canAccessPatient } = require("./auth");

function filterPatients(profile, patients) {
  return (patients || []).filter(patient => canAccessPatient(profile, patient));
}

function assertPatientAccess(profile, patients, userId) {
  const patient = (patients || []).find(item => item.user_id === userId);
  if (!patient) throw httpError(404, "Patient not found");
  if (!canAccessPatient(profile, patient)) throw httpError(403, "Patient is not assigned to this doctor");
  return patient;
}

function resolveDoctorId(profile, requestedDoctorId, profiles) {
  if (profile.role !== "admin" || !requestedDoctorId) {
    if (!profile.doctor_id) throw httpError(403, "Account has no clinician identity");
    return profile.doctor_id;
  }
  const target = (profiles || []).find(item => item.doctor_id === requestedDoctorId && item.status === "active");
  if (!target) throw httpError(400, "Assigned doctor is not active");
  return target.doctor_id;
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(raw)) throw httpError(400, "Phone must use E.164 format, for example +61412345678");
  return raw;
}

function duplicatePhone(patients, phone, exceptUserId) {
  const normalized = normalizePhone(phone);
  return (patients || []).find(patient => patient.user_id !== exceptUserId && String(patient.phone || "").trim() === normalized) || null;
}

module.exports = { filterPatients, assertPatientAccess, resolveDoctorId, normalizePhone, duplicatePhone };
