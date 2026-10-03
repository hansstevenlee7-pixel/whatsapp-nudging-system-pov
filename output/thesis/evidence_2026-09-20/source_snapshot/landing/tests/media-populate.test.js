"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/adaptive");
const adaptiveStore = require("../api/_lib/adaptive-store");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

test("clinician media button queues trusted search jobs without sending raw prescription text", async function (t) {
  const seed = baseSeed();
  seed.nudges.forEach(row => { row.status = "approved"; row.category = "establish"; });
  const sheets = fixture(seed);
  const previous = { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).includes("auth_user_id=eq.auth-1")) return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  adaptiveStore._setTestAdapter({
    queueSearch: async job => ({ job_id: "job-1", behaviour_key: job.behaviour_key, status: "pending" }),
    envelopeFor: async () => null,
    saveDraftEnvelope: async envelope => envelope
  });
  t.after(() => {
    sheets.restore(); adaptiveStore._setTestAdapter(null); global.fetch = previousFetch;
    for (const [name, value] of [["SUPABASE_URL", previous.url], ["SUPABASE_ANON_KEY", previous.anon], ["SUPABASE_SERVICE_ROLE_KEY", previous.service]]) {
      if (value == null) delete process.env[name]; else process.env[name] = value;
    }
  });
  const res = responseRecorder();
  await handler({ method: "POST", url: "/api/adaptive?op=plan", headers: { authorization: "Bearer token" }, body: { operation: "populate", user_id: "patient-1" } }, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, "queued");
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].status, "pending");
});
