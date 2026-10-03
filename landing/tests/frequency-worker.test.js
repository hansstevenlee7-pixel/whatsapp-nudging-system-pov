"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/adaptive");
const adaptiveStore = require("../api/_lib/adaptive-store");
const { behaviourKey } = require("../api/_lib/adaptive-core");
const { fixture } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function run(headers = {}) {
  const req = { method: "POST", url: "/api/adaptive?op=frequency", headers, body: { user_id: "patient-1", now: "2026-08-27T00:00:00Z" } };
  const res = responseRecorder(); await handler(req, res); return res;
}

function setup(t) {
  const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
  const key = behaviourKey(behaviour); const saved = [];
  const fx = fixture({
    user: [{ user_id: "patient-1", name: "Ada", user_status: "active" }],
    questionnaire: [{ questionnaire_id: "q-1", user_id: "patient-1", opt_in_whatsapp: true }],
    weekly_schedule: [1, 2].map(index => Object.assign({ schedule_slot_id: `slot-${index}`, user_id: "patient-1", status: "active" }, behaviour)),
    nudges: [1, 2].map(index => Object.assign({ nudge_id: `schd_${index}`, user_id: "patient-1", status: "delivered" }, behaviour)),
    schedule_state: [1, 2].map(index => ({ schedule_id: `state-${index}`, nudge_id: `schd_${index}`, user_id: "patient-1", status: "delivered", delivered_at: `2026-08-${20 + index}T00:00:00Z` }))
  });
  const plans = () => ({ envelopes: [Object.assign({ behaviour_key: key, status: "approved", frequency_min: 1, frequency_max: 3 }, behaviour)],
    events: [{ event_type: "inbound_reply", nudge_id: "schd_1", event_at: "2026-08-21T02:00:00Z", body: "Thanks" }], decisions: saved.slice(), states: [], assets: [], global_state: {} });
  adaptiveStore._setTestAdapter({
    plansForUser: async () => plans(),
    savePolicyEvaluation: async rows => {
      const stored = rows.map((row, index) => Object.assign({ decision_id: `shadow-${saved.length + index + 1}` }, row));
      saved.push(...stored); return stored;
    }
  });
  const previous = process.env.N8N_PROXY_SECRET; process.env.N8N_PROXY_SECRET = "worker-test";
  t.after(() => { fx.restore(); adaptiveStore._setTestAdapter(null); if (previous == null) delete process.env.N8N_PROXY_SECRET; else process.env.N8N_PROXY_SECRET = previous; });
  return { fx, saved };
}

test("protected frequency worker records one idempotent shadow evaluation without changing the schedule", async function (t) {
  const state = setup(t); const before = JSON.stringify(state.fx.tables.weekly_schedule.rows);
  const first = await run({ "x-n8n-proxy-secret": "worker-test" });
  assert.equal(first.statusCode, 200); assert.equal(JSON.parse(first.body).status, "complete");
  assert.deepEqual(state.saved.map(row => row.signal_type), ["frequency_model_recommendation", "adaptive_policy_shadow"]);
  assert.equal(JSON.stringify(state.fx.tables.weekly_schedule.rows), before);
  const second = await run({ "x-n8n-proxy-secret": "worker-test" });
  assert.equal(second.statusCode, 200); assert.equal(JSON.parse(second.body).status, "idle"); assert.equal(state.saved.length, 2);
});

test("frequency worker rejects a missing worker secret before reading or writing patient data", async function (t) {
  const state = setup(t); const response = await run();
  assert.equal(response.statusCode, 403); assert.equal(state.saved.length, 0);
});

test("enabled bounded policy applies a model decision to future unsent schedule rows", async function (t) {
  const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
  const key = behaviourKey(behaviour); const saved = [];
  const slot = (id, day) => Object.assign({ schedule_slot_id: id, user_id: "patient-1", source_nudge_id: "source-1",
    prescription_id: "rx-1", day, scheduled_time: "09:00", nudge_type: "reminder", tone_variant: "encouraging",
    message_body: "Take a short walk", message_body_alt: "", template_name: "health_plan_reminder", status: "active",
    start_date: "2026-09-07", end_date: "2026-10-04", media_selection_mode: "automatic" }, behaviour);
  const delivered = index => Object.assign({ nudge_id: `past-${index}`, schedule_slot_id: index === 1 ? "slot-mon" : "slot-thu",
    prescription_id: "rx-1", user_id: "patient-1", status: "sent", scheduled_date: `2026-08-${19 + index}`,
    scheduled_time: "09:00", message_body: "Take a short walk" }, behaviour);
  const fx = fixture({
    user: [{ user_id: "patient-1", name: "Ada", user_status: "active" }],
    questionnaire: [{ questionnaire_id: "q-1", user_id: "patient-1", opt_in_whatsapp: true }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-08-01",
      pillar: "physical_activity", category: "increase", frequency_per_week: 2, duration_weeks: 8, status: "active" }],
    weekly_schedule: [slot("slot-mon", "monday"), slot("slot-thu", "thursday")],
    nudges: [Object.assign({ nudge_id: "source-1", prescription_id: "rx-1", user_id: "patient-1", status: "approved",
      scheduled_date: "2026-08-01", scheduled_time: "09:00", message_body: "Take a short walk" }, behaviour), delivered(1), delivered(2)],
    schedule_state: [1, 2].map(index => ({ schedule_id: `state-${index}`, nudge_id: `past-${index}`, user_id: "patient-1",
      status: "delivered", delivered_at: `2026-08-${19 + index}T00:00:00Z` }))
  });
  adaptiveStore._setTestAdapter({
    plansForUser: async () => ({ envelopes: [Object.assign({ behaviour_key: key, status: "approved", automatic_schedule_apply: true, frequency_min: 1,
      frequency_max: 3, earliest_time: "09:00", latest_time: "09:00", formats: ["video", "paper", "reading"] }, behaviour)],
      events: [], decisions: saved.slice(), states: [], assets: [], historical_assets: [], candidates: [], global_state: {} }),
    savePolicyEvaluation: async rows => { const stored = rows.map((row, index) => Object.assign({ decision_id: `applied-${index}` }, row)); saved.push(...stored); return stored; }
  });
  const previousSecret = process.env.N8N_PROXY_SECRET; const previousApply = process.env.ADAPTIVE_SCHEDULE_APPLY_ENABLED;
  process.env.N8N_PROXY_SECRET = "worker-test"; process.env.ADAPTIVE_SCHEDULE_APPLY_ENABLED = "true";
  t.after(() => { fx.restore(); adaptiveStore._setTestAdapter(null); if (previousSecret == null) delete process.env.N8N_PROXY_SECRET; else process.env.N8N_PROXY_SECRET = previousSecret;
    if (previousApply == null) delete process.env.ADAPTIVE_SCHEDULE_APPLY_ENABLED; else process.env.ADAPTIVE_SCHEDULE_APPLY_ENABLED = previousApply; });
  const response = await run({ "x-n8n-proxy-secret": "worker-test" });
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).mode, "apply");
  assert.equal(saved[1].signal_type, "adaptive_policy_applied");
  assert.equal(fx.tables.weekly_schedule.rows.filter(row => row.status === "active").length, 1);
  // The changed recurring schedule names the persisted policy decision that changed it.
  assert.match(saved[1].decision_id, /^[0-9a-f-]{36}$/);
  assert.ok(fx.tables.weekly_schedule.rows.every(row => row.adaptation_decision_id === saved[1].decision_id));
});
