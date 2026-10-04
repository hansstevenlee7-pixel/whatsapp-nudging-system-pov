"use strict";

// The portal may report a patient as created only when Workflow A says so.
// On 5 October 2026 two production intakes failed at the Gemini call (rate
// limit), yet the form redirected to the Monitor as if the patients existed.
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/intake");
const { fixture, baseSeed } = require("./sheets-fixture");

const PATIENT = "5d190e28-090c-4083-b05a-6909bc8a8378";

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

// `answer` is what n8n's /webhook/intake sends back for this test.
function start(t, answer) {
  const store = fixture(baseSeed());
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "N8N_BASE_URL", "N8N_PROXY_SECRET"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, {
    SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    N8N_BASE_URL: "https://n8n.test", N8N_PROXY_SECRET: "proxy-secret"
  });
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async function (url, options) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) {
      return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    }
    if (url === "https://n8n.test/webhook/intake") {
      calls.push(JSON.parse(options.body));
      return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const quiet = console.error;
  console.error = () => {};
  t.after(function () {
    console.error = quiet;
    global.fetch = previousFetch;
    store.restore();
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
  return calls;
}

async function submitIntake() {
  const res = responseRecorder();
  await handler({ method: "POST", headers: { authorization: "Bearer token" }, body: {
    user: { user_id: PATIENT, name: "Synthetic provenance check 3", phone: "+61491570157", email: "" },
    questionnaire: { preferred_nudge_time: "09:00", opt_in_whatsapp: true },
    prescription_input: { prescription_text: "Walk 20 minutes twice a week", issued_date: "2026-10-05" }
  } }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test("Respond Success naming the submitted patient is the only success", async function (t) {
  const calls = start(t, { status: 200, body: JSON.stringify({ status: "ok", user_id: PATIENT, prescriptions: 1, nudges: 2 }) });
  const out = await submitIntake();
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { status: "ok", user_id: PATIENT, prescriptions: 1, nudges: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].user.doctor_id, "doc-1");
});

for (const [name, answer] of [
  ["an empty 2xx (the execution stopped before any Respond node)", { status: 200, body: "" }],
  ["a 2xx without a status", { status: 200, body: JSON.stringify({ message: "Workflow was started" }) }],
  ["a 2xx naming another patient", { status: 200, body: JSON.stringify({ status: "ok", user_id: "someone-else" }) }],
  ["a 2xx with status ok but no patient", { status: 200, body: JSON.stringify({ status: "ok" }) }],
  ["an n8n execution error", { status: 500, body: JSON.stringify({ message: "Error in workflow" }) }],
  ["an inactive webhook", { status: 404, body: JSON.stringify({ message: "The requested webhook is not registered" }) }]
]) {
  test(`${name} is reported as not confirmed, never as a created patient`, async function (t) {
    start(t, answer);
    const out = await submitIntake();
    assert.equal(out.status, 502);
    assert.equal(out.body.code, "intake_not_confirmed");
    assert.match(out.body.error, /did not confirm that the patient was created/);
    assert.equal(out.body.user_id, undefined);
  });
}

test("a proxy-secret mismatch is not passed on as 401, so the browser does not refresh and resubmit", async function (t) {
  const calls = start(t, { status: 401, body: JSON.stringify({ error: "Unauthorized" }) });
  const out = await submitIntake();
  assert.equal(out.status, 502);
  assert.equal(out.body.code, "intake_not_confirmed");
  assert.equal(calls.length, 1);
});

test("Respond Rejected reaches the clinician as a rejection with nothing saved", async function (t) {
  start(t, { status: 422, body: JSON.stringify({ status: "rejected", stage: "validation", errors: ["rx[0] has no nudges"] }) });
  const out = await submitIntake();
  assert.equal(out.status, 422);
  assert.equal(out.body.code, "intake_rejected");
  assert.match(out.body.error, /nothing was saved/);
});

test("the intake page redirects only on a confirmation naming the submitted patient", () => {
  const text = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../input.html"), "utf8");
  const submit = text.match(/form\.addEventListener\("submit"[\s\S]*?form\.addEventListener\("reset"/)[0];
  assert.match(submit, /out\.status !== "ok"/);
  assert.match(submit, /out\.user_id !== payload\.user\.user_id/);
  assert.doesNotMatch(submit, /out\.user_id \|\| payload\.user\.user_id/);
});
