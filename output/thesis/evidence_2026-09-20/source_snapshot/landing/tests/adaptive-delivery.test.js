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

function deliverySeed(row, overrides = {}) {
  return Object.assign({
    user: [{ user_id: "patient-1", user_status: "active" }],
    questionnaire: [{ questionnaire_id: "q-1", user_id: "patient-1", opt_in_whatsapp: true }],
    nudges: [row],
    schedule_state: [{ schedule_id: `sch_${row.nudge_id}`, nudge_id: row.nudge_id, user_id: row.user_id,
      status: "approved", sent_at: "", delivered_at: "", wa_message_id: "", last_updated: "" }]
  }, overrides);
}

function setup(t, seed, adapter) {
  const fx = fixture(seed); const previous = process.env.N8N_PROXY_SECRET;
  process.env.N8N_PROXY_SECRET = "worker-test"; adaptiveStore._setTestAdapter(adapter);
  t.after(() => { fx.restore(); adaptiveStore._setTestAdapter(null); if (previous == null) delete process.env.N8N_PROXY_SECRET; else process.env.N8N_PROXY_SECRET = previous; });
  return fx;
}

test("text-only preparation records one decision and never attaches media", async function (t) {
  const fx = setup(t, deliverySeed(nudge({ media_selection_mode: "text_only" })), {
    adaptationState: async () => ({ format_scores: {} }),
    saveSelectionDecision: async () => ({ decision_id: "decision-text", decided_at: "2026-08-22T00:00:00Z" })
  });
  const first = await prepare("n-1");
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).reason, "clinician_text_only");
  assert.equal(fx.tables.nudges.rows[0].media_asset_id, "");
  assert.equal(fx.tables.nudges.rows[0].adaptation_decision_id, "decision-text");
  assert.equal(fx.tables.adaptation_decisions.rows.length, 1);
  assert.equal(fx.tables.schedule_state.rows[0].status, "sending");
  assert.match(fx.tables.schedule_state.rows[0].delivery_attempt_id, /^att_/);
  const second = await prepare("n-1");
  assert.equal(second.statusCode, 409);
  assert.match(JSON.parse(second.body).error, /already reserved/);
  assert.equal(fx.tables.adaptation_decisions.rows.length, 1);
});

test("clinician override attaches the exact approved asset through a tracked link", async function (t) {
  const asset = { asset_id: "asset-video", media_kind: "video", title: "Walking video", source_name: "Trusted channel",
    source_url: "https://example.test/video", short_summary: "A short walking guide." };
  const fx = setup(t, deliverySeed(nudge({ media_selection_mode: "clinician_selected", media_override_asset_id: asset.asset_id })), {
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
  assert.equal(fx.tables.schedule_state.rows[0].status, "sending");
});

test("preparation fails closed without active WhatsApp consent", async function (t) {
  const row = nudge({ media_selection_mode: "text_only" });
  const seed = deliverySeed(row); seed.questionnaire[0].opt_in_whatsapp = false;
  const fx = setup(t, seed, {}); const res = await prepare(row.nudge_id);
  assert.equal(res.statusCode, 409); assert.match(JSON.parse(res.body).error, /consent/);
  assert.equal(fx.tables.schedule_state.rows[0].status, "approved");
});

test("preparation refuses an existing send reservation", async function (t) {
  const row = nudge({ media_selection_mode: "text_only" }); const seed = deliverySeed(row);
  seed.schedule_state[0].status = "sending"; seed.schedule_state[0].delivery_attempt_id = "att_existing";
  const fx = setup(t, seed, {}); const res = await prepare(row.nudge_id);
  assert.equal(res.statusCode, 409); assert.match(JSON.parse(res.body).error, /already reserved/);
  assert.equal(fx.tables.adaptation_decisions.rows.length, 0);
});
