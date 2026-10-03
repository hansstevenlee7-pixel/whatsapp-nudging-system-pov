"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
  delete global.fetch;
});

test("disabled Supabase profile cannot authenticate", async () => {
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  global.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "auth-1", email: "doctor@example.com" }), { status: 200 });
    return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "disabled" }]), { status: 200 });
  };
  const { requireUser } = require("../api/_lib/auth");
  await assert.rejects(() => requireUser({ headers: { authorization: "Bearer valid-token" } }), error => error.status === 403);
});

test("expired Supabase token is rejected", async () => {
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  global.fetch = async () => new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 });
  const { requireUser } = require("../api/_lib/auth");
  await assert.rejects(() => requireUser({ headers: { authorization: "Bearer expired-token" } }), error => error.status === 401);
});
