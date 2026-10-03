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
  const seed = baseSeed(); seed.nudges.forEach(row => { row.category = "establish"; });
  const fx = fixture(seed);
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) return new Response(JSON.stringify([
      { auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }
    ]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  adaptiveStore._setTestAdapter(adapter);
  t.after(() => {
    fx.restore(); adaptiveStore._setTestAdapter(null); global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
  return fx;
}

async function call(body) {
  const req = { method: "POST", url: "/api/adaptive?op=upload", headers: { authorization: "Bearer token" }, body };
  const res = responseRecorder(); await handler(req, res); return res;
}

test("only an assigned clinician can obtain a signed upload for an approved media set", async function (t) {
  install(t, {
    envelopeFor: async () => ({ envelope_id: "env-1", approved_asset_ids: [] }),
    createSignedUpload: async path => ({ bucket: "clinician-media", path, token: "signed", signed_upload_url: "https://supabase.test/upload" })
  });
  const res = await call({ operation: "sign", user_id: "patient-1", source_nudge_id: "source-wed",
    file_name: "walking-guide.pdf", mime_type: "application/pdf", file_size: 1024 });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(body.path, /^patient-1\/source-wed\//);
  assert.equal(body.media_kind, "reading");
});

test("upload signing rejects unsupported files and unapproved media sets", async function (t) {
  install(t, { envelopeFor: async () => null });
  const unsupported = await call({ operation: "sign", user_id: "patient-1", source_nudge_id: "source-wed",
    file_name: "script.exe", mime_type: "application/octet-stream", file_size: 100 });
  assert.equal(unsupported.statusCode, 400);
  const unapproved = await call({ operation: "sign", user_id: "patient-1", source_nudge_id: "source-wed",
    file_name: "walking-guide.pdf", mime_type: "application/pdf", file_size: 100 });
  assert.equal(unapproved.statusCode, 409);
  assert.match(JSON.parse(unapproved.body).error, /Approve the media set/);
});

test("completed upload verifies storage metadata before registering the asset", async function (t) {
  let registered = null;
  install(t, {
    objectInfo: async () => ({ metadata: { size: 2048, mimetype: "video/mp4" } }),
    registerClinicianUpload: async input => { registered = input; return { asset_id: "asset-upload", title: input.title }; }
  });
  const res = await call({ operation: "complete", user_id: "patient-1", source_nudge_id: "source-wed",
    file_name: "demo.mp4", mime_type: "video/mp4", file_size: 2048,
    storage_path: "patient-1/source-wed/random-demo.mp4" });
  assert.equal(res.statusCode, 200);
  assert.equal(registered.media_kind, "video");
  assert.equal(registered.approved_by, "auth-1");
});
