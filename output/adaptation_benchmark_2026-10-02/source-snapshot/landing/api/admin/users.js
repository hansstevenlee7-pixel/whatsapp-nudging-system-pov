"use strict";

// All three admin endpoints in one function.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and adding
// the reply-path endpoints put us at 13. These three were the obvious merge:
// they share the same admin-only guard, they are small, and — unlike the Twilio
// webhook — nothing here validates a request signature, so serving them through
// a rewrite has no security consequence.
//
// Public URLs are unchanged. vercel.json rewrites /api/admin/assign and
// /api/admin/user here with an `op` marker; the browser still calls the original
// paths. Dispatch cannot be on method alone, because /assign and /users both
// take POST.

const { sendJson, method, jsonBody, apiError, httpError } = require("../_lib/http");
const { requireUser } = require("../_lib/auth");
const { listProfiles, inviteProfile, updateProfile } = require("../_lib/supabase");
const { allPatients, updateUser } = require("../_lib/clinical-data");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function operation(req) {
  const query = String(req.url || "").split("?")[1] || "";
  const op = new URLSearchParams(query).get("op");
  return op || "users";
}

// PATCH /api/admin/user — change a clinician's display name, role or status.
async function updateClinician(req, res) {
  if (!method(req, res, ["PATCH"])) return;
  const actor = await requireUser(req, { admin: true });
  const body = await jsonBody(req);
  const authUserId = String(body.auth_user_id || "").trim();
  if (!authUserId) throw httpError(400, "auth_user_id is required");
  if (authUserId === actor.profile.auth_user_id && body.status === "disabled") {
    throw httpError(400, "You cannot disable your own account");
  }
  const changes = {};
  if (body.display_name != null) changes.display_name = String(body.display_name).trim();
  if (["admin", "doctor"].includes(body.role)) changes.role = body.role;
  if (["active", "disabled"].includes(body.status)) changes.status = body.status;
  if (!Object.keys(changes).length) throw httpError(400, "No valid changes supplied");
  const profile = await updateProfile(authUserId, changes);
  sendJson(res, 200, { profile });
}

// POST /api/admin/assign — move a patient to another active clinician.
async function assignPatient(req, res) {
  if (!method(req, res, ["POST"])) return;
  await requireUser(req, { admin: true });
  const body = await jsonBody(req);
  const userId = String(body.user_id || "").trim();
  const doctorId = String(body.doctor_id || "").trim();
  if (!userId || !doctorId) throw httpError(400, "user_id and doctor_id are required");
  const [profiles, patients] = await Promise.all([listProfiles(), allPatients()]);
  if (!profiles.some(p => p.doctor_id === doctorId && p.status === "active")) throw httpError(400, "Target doctor is not active");
  if (!patients.some(p => p.user_id === userId)) throw httpError(404, "Patient not found");
  const patient = await updateUser(userId, { doctor_id: doctorId });
  sendJson(res, 200, { status: "ok", persisted: true, user_id: userId, doctor_id: doctorId, patient });
}

// GET /api/admin/users — list clinicians. POST — invite one.
async function listOrInvite(req, res) {
  if (!method(req, res, ["GET", "POST"])) return;
  await requireUser(req, { admin: true });
  if (req.method === "GET") {
    const profiles = await listProfiles();
    sendJson(res, 200, { profiles });
    return;
  }
  const body = await jsonBody(req);
  const email = String(body.email || "").trim().toLowerCase();
  const displayName = String(body.display_name || "").trim();
  const role = body.role === "admin" ? "admin" : "doctor";
  if (!EMAIL_RE.test(email)) throw httpError(400, "A valid email is required");
  if (!displayName) throw httpError(400, "Display name is required");
  const origin = String(process.env.PUBLIC_APP_URL || `https://${req.headers.host}`).replace(/\/$/, "");
  const profile = await inviteProfile({ email, displayName, role, redirectTo: `${origin}/set-password.html` });
  sendJson(res, 201, { profile });
}

module.exports = async function handler(req, res) {
  try {
    const op = operation(req);
    if (op === "user") return await updateClinician(req, res);
    if (op === "assign") return await assignPatient(req, res);
    return await listOrInvite(req, res);
  } catch (error) { apiError(res, error); }
};
