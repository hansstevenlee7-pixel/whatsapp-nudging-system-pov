"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/adaptive");
const adaptiveStore = require("../api/_lib/adaptive-store");
const { fixture } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function prepare(nudgeId) {
  const req = { method: "POST", url: "/api/adaptive?op=delivery", headers: { "x-n8n-proxy-secret": "worker-test" }, body: { nudge_id: nudgeId } };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

function nudge(overrides) {
  return Object.assign({ nudge_id: "n-1", user_id: "patient-1", prescription_id: "rx-1", action_text: "Walk for 20 minutes",
    pillar: "physical_activity", category: "increase", message_body: "Take your walk today.", status: "approved",
    media_selection_mode: "automatic", media_override_asset_id: "", media_asset_id: "", adaptation_decision_id: "" }, overrides || {});
}

function setup(t, seed, adapter) {
  const fx = fixture(seed); const previous = process.env.N8N_PROXY_SECRET;
  process.env.N8N_PROXY_SECRET = "worker-test"; adaptiveStore._setTestAdapter(adapter);
  t.after(() => { fx.restore(); adaptiveStore._setTestAdapter(null); if (previous == null) delete process.env.N8N_PROXY_SECRET; else process.env.N8N_PROXY_SECRET = previous; });
  return fx;
}

test("text-only preparation records one decision and never attaches media", async function (t) {
  const fx = setup(t, { nudges: [nudge({ media_selection_mode: "text_only" })] }, {
    adaptationState: async () => ({ format_scores: {} }),
    saveSelectionDecision: async () => ({ decision_id: "decision-text", decided_at: "2026-08-22T00:00:00Z" })
  });
  const first = await prepare("n-1");
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).reason, "clinician_text_only");
  assert.equal(fx.tables.nudges.rows[0].media_asset_id, "");
  assert.equal(fx.tables.nudges.rows[0].adaptation_decision_id, "decision-text");
  assert.equal(fx.tables.adaptation_decisions.rows.length, 1);
  const second = await prepare("n-1");
  assert.equal(JSON.parse(second.body).idempotent, true);
  assert.equal(fx.tables.adaptation_decisions.rows.length, 1);
});

test("clinician override attaches the exact approved asset through a tracked link", async function (t) {
  const asset = { asset_id: "asset-video", media_kind: "video", title: "Walking video", source_name: "Trusted channel",
    source_url: "https://example.test/video", short_summary: "A short walking guide." };
  const fx = setup(t, { nudges: [nudge({ media_selection_mode: "clinician_selected", media_override_asset_id: asset.asset_id })] }, {
    envelopeFor: async () => ({ approved_asset_ids: [asset.asset_id], formats: ["video"], summary_lengths: ["short"], tones: ["encouraging"],
      earliest_time: "09:00", latest_time: "09:00", frequency_min: 1, frequency_max: 1, action_alternatives: [] }),
    assetsFor: async () => [asset], adaptationState: async () => ({ format_scores: {} }),
    saveSelectionDecision: async () => ({ decision_id: "decision-video", decided_at: "2026-08-22T00:00:00Z" }),
    createTrackedLink: async () => ({ token: "t".repeat(24) })
  });
  const res = await prepare("n-1");
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.media_asset_id, asset.asset_id);
  assert.match(body.message_body, /\/api\/r\/t{24}/);
  assert.equal(fx.tables.media_assignments.rows[0].media_asset_id, asset.asset_id);
  assert.equal(fx.tables.adaptation_decisions.rows[0].rule_applied, "clinician_media_override");
});
