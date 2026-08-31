"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/adaptive");
const adaptiveStore = require("../api/_lib/adaptive-store");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function install(t, adapter) {
  const seed = baseSeed(); seed.nudges.forEach(row => { row.status = "approved"; row.category = "establish"; });
  const sheets = fixture(seed);
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).includes("auth_user_id=eq.auth-1")) return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  adaptiveStore._setTestAdapter(adapter);
  t.after(() => {
    sheets.restore(); adaptiveStore._setTestAdapter(null); global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

async function call(body) {
  const req = { method: "POST", url: "/api/adaptive?op=plan", headers: { authorization: "Bearer token" }, body };
  const res = responseRecorder(); await handler(req, res); return res;
}

test("a clinician can add a manual resource to their patient's existing media plan", async function (t) {
  let inserted = null;
  install(t, {
    plansForUser: async () => ({ envelopes: [{ behaviour_key: "behaviour-1", status: "draft" }] }),
    saveCandidates: async rows => { inserted = rows[0]; return [{ candidate_id: "candidate-1", ...rows[0] }]; }
  });
  const res = await call({ operation: "manual_resource", user_id: "patient-1", behaviour_key: "behaviour-1",
    media_kind: "video", title: "A walking guide", source_name: "Trusted health service",
    source_url: "https://health.example.test/walking", short_summary: "A short walking guide.",
    detailed_summary: "A practical guide to starting a walking routine.", limitations: "General education only." });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, "saved");
  assert.equal(inserted.behaviour_key, "behaviour-1");
  assert.deepEqual(inserted.ranking_reasons, ["clinician_added"]);
  assert.equal(inserted.metadata.entry_mode, "manual");
});

test("manual entry creates the draft media plan directly from a scheduled nudge", async function (t) {
  let envelope = null;
  install(t, {
    plansForUser: async () => ({ envelopes: [] }),
    saveDraftEnvelope: async value => { envelope = value; return value; },
    saveCandidates: async rows => [{ candidate_id: "candidate-1", ...rows[0] }]
  });
  const res = await call({ operation: "manual_resource", user_id: "patient-1", source_nudge_id: "source-wed",
    media_kind: "video", title: "A walking guide", source_name: "Trusted health service",
    source_url: "https://health.example.test/walking", short_summary: "A short walking guide." });
  assert.equal(res.statusCode, 200);
  assert.equal(envelope.user_id, "patient-1");
  assert.equal(envelope.status, "draft");
  assert.ok(envelope.behaviour_key);
});

test("manual resources reject invalid URLs and another patient's behaviour key", async function (t) {
  install(t, { plansForUser: async () => ({ envelopes: [{ behaviour_key: "behaviour-1" }] }), saveCandidates: async () => [] });
  const invalidUrl = await call({ operation: "manual_resource", user_id: "patient-1", behaviour_key: "behaviour-1",
    media_kind: "video", title: "Guide", source_name: "Source", source_url: "http://insecure.test/guide" });
  assert.equal(invalidUrl.statusCode, 400);
  const foreign = await call({ operation: "manual_resource", user_id: "patient-1", behaviour_key: "foreign-key",
    media_kind: "video", title: "Guide", source_name: "Source", source_url: "https://example.test/guide" });
  assert.equal(foreign.statusCode, 404);
});
