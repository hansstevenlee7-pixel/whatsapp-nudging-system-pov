"use strict";

const { httpError } = require("./http");
const { userForToken, profileForAuthUser } = require("./supabase");

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) throw httpError(401, "Authentication required");
  return match[1];
}

async function requireUser(req, options = {}) {
  const authUser = await userForToken(bearerToken(req));
  const profile = await profileForAuthUser(authUser.id);
  if (!profile || profile.status !== "active") throw httpError(403, "Account is not active");
  if (options.admin && profile.role !== "admin") throw httpError(403, "Administrator access required");
  return { authUser, profile };
}

function canAccessPatient(profile, patient) {
  return profile.role === "admin" || Boolean(profile.doctor_id && patient && patient.doctor_id === profile.doctor_id);
}

module.exports = { bearerToken, requireUser, canAccessPatient };
