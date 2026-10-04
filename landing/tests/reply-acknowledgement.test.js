"use strict";

// The adaptation worker tells the patient "your request will be used" only when
// an explicit request was applied, not after an ordinary reply that merely
// rotated approved media (translation-trace finding, 4 October 2026).

const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture, baseSeed } = require("./sheets-fixture");
const adaptiveStore = require("../api/_lib/adaptive-store");
const handlers = require("../api/_lib/adaptive-handlers");
const core = require("../api/_lib/adaptive-core");

const behaviour = { action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" };
const key = core.behaviourKey(behaviour);

async function workerReply(t, body) {
  const fx = fixture(baseSeed()); const sent = [];
  const envelope = Object.assign(core.defaultEnvelope(Object.assign({ scheduled_time: "09:00", frequency_per_week: 2 }, behaviour)),
    { behaviour_key: key, user_id: "patient-1", status: "approved", frequency_min: 1, frequency_max: 3 });
  let pending = { interaction_id: "reply-1", user_id: "patient-1", behaviour_key: key, event_type: "inbound_reply", body,
    raw_payload: { from: "whatsapp:+61411111111" } };
  adaptiveStore._setTestAdapter({
    pendingInteraction: async () => { const event = pending; pending = null; return event; },
    envelopeFor: async () => envelope,
    adaptationState: async () => ({ preferred_frequency: 2, format_scores: {}, asset_history: [] }),
    assetsFor: async () => [{ asset_id: "video-1", media_kind: "video" }, { asset_id: "paper-1", media_kind: "paper" }],
    saveDecision: async (event, decision) => Object.assign({ decision_id: "decision-1", interaction_id: event.interaction_id }, decision),
    plansForUser: async () => ({ envelopes: [envelope], events: [], decisions: [], states: [], assets: [], historical_assets: [], candidates: [], global_state: {} })
  });
  const previous = Object.fromEntries(["N8N_PROXY_SECRET", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM", "GEMINI_API_KEY"].map(k => [k, process.env[k]]));
  Object.assign(process.env, { N8N_PROXY_SECRET: "worker-test", TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: "token",
    TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886" });
  delete process.env.GEMINI_API_KEY;
  const previousFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).startsWith("https://api.twilio.com/")) { sent.push(String(options.body)); return new Response(JSON.stringify({ sid: `SM${"1".repeat(32)}`, status: "queued" }), { status: 201 }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(() => {
    fx.restore(); adaptiveStore._setTestAdapter(null); global.fetch = previousFetch;
    for (const [k, v] of Object.entries(previous)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
  });
  const res = { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
  await handlers.adaptationWorker({ method: "POST", headers: { "x-n8n-proxy-secret": "worker-test" }, body: {} }, res);
  return { status: res.statusCode, decision: JSON.parse(res.body).decision, sent };
}

test("an ordinary reply is not acknowledged as a request", async function (t) {
  const result = await workerReply(t, "Thanks, done!");
  assert.equal(result.status, 200);
  assert.equal(result.decision.outcome, "applied");
  assert.equal(result.decision.interpretation.explicit, false);
  assert.equal(result.sent.length, 0);
});

test("an applied explicit request is acknowledged once", async function (t) {
  const result = await workerReply(t, "Send fewer messages");
  assert.equal(result.decision.outcome, "applied");
  assert.equal(result.decision.next_state.preferred_frequency, 1);
  assert.equal(result.sent.length, 1);
  assert.match(decodeURIComponent(result.sent[0].replace(/\+/g, " ")), /your request will be used/);
});
