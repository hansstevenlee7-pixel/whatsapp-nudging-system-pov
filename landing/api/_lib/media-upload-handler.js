"use strict";

const crypto = require("node:crypto");
const { sendJson, method, jsonBody, apiError, httpError } = require("./http");
const { requireUser } = require("./auth");
const { allPatients } = require("./clinical-data");
const { assertPatientAccess } = require("./policy");
const { behaviourKey } = require("./adaptive-core");
const store = require("./adaptive-store");

const MAX_BYTES = 100 * 1024 * 1024;
const TYPES = new Map([
  ["video/mp4", "video"], ["video/webm", "video"], ["application/pdf", "reading"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "reading"], ["text/plain", "reading"]
]);

function safeName(value) {
  const name = String(value || "file").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100);
  return name || "file";
}

module.exports = async function mediaUpload(req, res) {
  if (!method(req, res, ["POST"])) return;
  try {
    if (!store.configured()) throw httpError(503, "Adaptive media database is not configured");
    const { profile } = await requireUser(req);
    const body = await jsonBody(req);
    const patient = assertPatientAccess(profile, await allPatients(), String(body.user_id || ""));
    const source = (patient.nudges || []).find(row => String(row.nudge_id) === String(body.source_nudge_id));
    if (!source) throw httpError(400, "The nudge source does not belong to this patient");
    const mimeType = String(body.mime_type || "").toLowerCase();
    const mediaKind = TYPES.get(mimeType);
    const size = Number(body.file_size);
    if (!mediaKind) throw httpError(400, "Upload an MP4, WebM, PDF, DOCX, or plain-text file");
    if (!Number.isInteger(size) || size < 1 || size > MAX_BYTES) throw httpError(400, "File size must be between 1 byte and 100 MB");
    const prescription = (patient.prescriptions || []).find(row => String(row.prescription_id) === String(source.prescription_id)) || {};
    const key = behaviourKey(Object.assign({}, source, { category: source.category || prescription.category }));
    const operation = String(body.operation || "sign");
    if (operation === "sign") {
      const envelope = await store.call("envelopeFor", patient.user_id, key);
      if (!envelope) throw httpError(409, "Approve the media set before uploading a clinician resource");
      const path = `${safeName(patient.user_id)}/${safeName(source.nudge_id)}/${crypto.randomUUID()}-${safeName(body.file_name)}`;
      const signed = await store.call("createSignedUpload", path);
      return sendJson(res, 200, Object.assign(signed, { behaviour_key: key, media_kind: mediaKind }));
    }
    if (operation !== "complete") throw httpError(400, "operation must be sign or complete");
    const path = String(body.storage_path || "");
    if (!path.startsWith(`${safeName(patient.user_id)}/${safeName(source.nudge_id)}/`) || path.includes("..")) throw httpError(400, "Invalid upload path");
    const info = await store.call("objectInfo", path);
    const storedSize = Number(info && info.metadata && info.metadata.size);
    const storedType = String(info && info.metadata && (info.metadata.mimetype || info.metadata.contentType) || "").toLowerCase();
    if (storedSize && storedSize !== size) throw httpError(409, "Uploaded file size does not match the signed request");
    if (storedType && storedType !== mimeType) throw httpError(409, "Uploaded file type does not match the signed request");
    const asset = await store.call("registerClinicianUpload", { user_id: patient.user_id, behaviour_key: key,
      storage_path: path, media_kind: mediaKind, title: safeName(body.file_name), mime_type: mimeType,
      file_size: size, approved_by: profile.auth_user_id });
    return sendJson(res, 200, { status: "approved", asset });
  } catch (error) { return apiError(res, error); }
};
