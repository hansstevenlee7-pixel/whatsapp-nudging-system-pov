"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/patient");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function installAuth(t) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) {
      return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(function () {
    global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

async function call(t, method, body, store) {
  installAuth(t);
  t.after(() => store.restore());
  const req = { method, headers: { authorization: "Bearer token" }, body };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

test("DELETE disables a patient without removing the clinical record", async function (t) {
  const store = fixture(baseSeed());
  const res = await call(t, "DELETE", { user_id: "patient-1" }, store);
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.user.rows.length, 1);
  assert.equal(store.tables.user.rows[0].user_status, "disabled");
  assert.equal(JSON.parse(res.body).patient.user_status, "disabled");
});

test("PATCH persists edited patient fields directly to Sheets", async function (t) {
  const store = fixture(baseSeed());
  const res = await call(t, "PATCH", {
    user_id: "patient-1", name: "Ada Lovelace", phone: "+61422222222", email: "lovelace@example.test", user_status: "active"
  }, store);
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.user.rows[0].name, "Ada Lovelace");
  assert.equal(store.tables.user.rows[0].phone, "+61422222222");
  assert.equal(JSON.parse(res.body).patient.email, "lovelace@example.test");
});

test("read-back mismatch cannot report a successful patient update", async function (t) {
  const store = fixture(baseSeed());
  store.ignoreNextBatch();
  const res = await call(t, "PATCH", { user_id: "patient-1", name: "Changed" }, store);
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /not confirmed in Google Sheets/);
});
