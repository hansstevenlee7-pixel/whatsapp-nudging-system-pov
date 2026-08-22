"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const patientsHandler = require("../api/patients");
// /api/admin/assign is served by the merged admin function via a vercel.json
// rewrite that marks the operation with ?op=assign. The test drives the same
// entry point the rewrite produces.
const adminHandler = require("../api/admin/users");
const approveHandler = require("../api/approve");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function environment(t, profile, profiles) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).includes("auth_user_id=eq.auth-1")) return new Response(JSON.stringify([profile]), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) return new Response(JSON.stringify(profiles || [profile]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(function () {
    global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

test("GET patients builds the canonical Monitoring payload directly from Sheets", async function (t) {
  const seed = baseSeed();
  seed.weekly_schedule = [{ schedule_slot_id: "slot-wed", user_id: "patient-1", source_nudge_id: "source-wed", prescription_id: "rx-1", day: "wednesday", scheduled_time: "09:00", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", tone_variant: "encouraging", message_body: "Wednesday", message_body_alt: "", template_name: "health_plan_reminder", status: "active", start_date: "2099-08-01", end_date: "2099-08-31", created_at: "now", updated_at: "now" }];
  const store = fixture(seed);
  t.after(() => store.restore());
  environment(t, { auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" });
  const res = responseRecorder();
  await patientsHandler({ method: "GET", headers: { authorization: "Bearer token" } }, res);
  assert.equal(res.statusCode, 200);
  const patient = JSON.parse(res.body).patients[0];
  assert.equal(patient.user_id, "patient-1");
  assert.equal(patient.has_canonical_schedule, true);
  assert.deepEqual(patient.weekly_schedule.map(row => row.day), ["wednesday"]);
});

test("administrator assignment writes doctor_id directly to the user row", async function (t) {
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  environment(t,
    { auth_user_id: "auth-1", role: "admin", doctor_id: "admin-doc", status: "active" },
    [{ auth_user_id: "auth-2", role: "doctor", doctor_id: "doc-2", status: "active" }]
  );
  const res = responseRecorder();
  await adminHandler({ method: "POST", url: "/api/admin/users?op=assign", headers: { authorization: "Bearer token" }, body: { user_id: "patient-1", doctor_id: "doc-2" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.user.rows[0].doctor_id, "doc-2");
  assert.equal(JSON.parse(res.body).persisted, true);
});

test("reject marks source nudges directly and returns verified persistence", async function (t) {
  const store = fixture(baseSeed());
  t.after(() => store.restore());
  environment(t, { auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" });
  const res = responseRecorder();
  await approveHandler({ method: "POST", headers: { authorization: "Bearer token" }, body: {
    user_id: "patient-1", decision: "reject", start_date: "2099-08-01", end_date: "2099-08-31",
    slots: [{ source_nudge_id: "source-sun", prescription_id: "rx-1", day: "sunday", time: "09:00", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", tone_variant: "encouraging", message_body: "Sunday", template_name: "health_plan_reminder" }]
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.nudges.rows.find(row => row.nudge_id === "source-sun").status, "rejected");
  assert.equal(JSON.parse(res.body).persisted, true);
});
