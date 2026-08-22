"use strict";

const { httpError } = require("./http");

function env(name) {
  const value = process.env[name];
  if (!value) throw httpError(503, `${name} is not configured`);
  return value.replace(/\/$/, "");
}

async function request(path, options = {}, useServiceRole = false) {
  const base = env("SUPABASE_URL");
  const key = env(useServiceRole ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY");
  const headers = Object.assign({ apikey: key, "content-type": "application/json" }, options.headers || {});
  if (useServiceRole && !headers.authorization) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${base}${path}`, Object.assign({}, options, { headers }));
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!response.ok) {
    const message = body && (body.msg || body.message || body.error_description || body.error) || `Supabase HTTP ${response.status}`;
    throw httpError(response.status >= 500 ? 502 : response.status, message);
  }
  return body;
}

async function userForToken(token) {
  return request("/auth/v1/user", { headers: { authorization: `Bearer ${token}` } });
}

async function profileForAuthUser(authUserId) {
  const rows = await request(`/rest/v1/profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=auth_user_id,email,display_name,role,doctor_id,status`, {}, true);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function listProfiles() {
  return request("/rest/v1/profiles?select=auth_user_id,email,display_name,role,doctor_id,status,created_at&order=display_name.asc", {}, true);
}

async function inviteProfile({ email, displayName, role, redirectTo }) {
  const doctorId = `doc_${crypto.randomUUID()}`;
  const user = await request(`/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    body: JSON.stringify({ email, data: { display_name: displayName } })
  }, true);
  await request("/rest/v1/profiles?on_conflict=auth_user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ auth_user_id: user.id, email, display_name: displayName, role, doctor_id: doctorId, status: "active" })
  }, true);
  return profileForAuthUser(user.id);
}

async function updateProfile(authUserId, changes) {
  const allowed = {};
  for (const key of ["display_name", "role", "status"]) {
    if (changes[key] != null) allowed[key] = changes[key];
  }
  const rows = await request(`/rest/v1/profiles?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(allowed)
  }, true);
  if (changes.status) {
    await request(`/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, {
      method: "PUT",
      body: JSON.stringify({ ban_duration: changes.status === "disabled" ? "876000h" : "none" })
    }, true);
  }
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = { env, request, userForToken, profileForAuthUser, listProfiles, inviteProfile, updateProfile };
