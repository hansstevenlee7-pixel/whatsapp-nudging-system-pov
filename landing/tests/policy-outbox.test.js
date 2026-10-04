"use strict";

// The policy outbox (audit-recovery repair, 5 Oct 2026): an applied evaluation's
// rows ride the schedule's Sheets batch and are replayed into the adaptation store.
const test = require("node:test");
const assert = require("node:assert/strict");
const { policyRows, outboxRow, fromOutbox } = require("../api/_lib/frequency-shadow");
const store = require("../api/_lib/adaptive-store");

const result = {
  behaviour_key: "physical_activity|increase|walk for 20 minutes", mode: "apply", model_id: "frequency-logistic-v1",
  evaluation_key: "frequency-logistic-v1:key:past-2:2026-08-21T00:00:00.000Z", current_frequency: 2, recommended_frequency: 1,
  model_recommended_frequency: 1, direction: "decrease", policy_reason: "model_lower", closed_delivery_count: 2,
  recent_outcomes: [{ nudge_id: "past-1", interacted_within_24h: 0 }, { nudge_id: "past-2", interacted_within_24h: 0 }],
  features: { noninteraction_streak: 2 }, candidate_scores: { 1: 0.31, 2: 0.22, 3: 0.12 },
  time_recommendation: { recommended_time: null }, media_recommendation: { recommended_format: null },
  current_time: "09:00", current_media_format: null, state: { state_version: 4, preferred_tone: "encouraging" }, evidence: {}
};
const ids = { recommendation_decision_id: "11111111-1111-4111-8111-111111111111", policy_decision_id: "22222222-2222-4222-8222-222222222222" };
const rows = schedule_applied => policyRows(Object.assign({ user_id: "patient-1", result, mode: "apply", schedule_applied, now: "2026-08-27T00:00:00.000Z" }, ids));
// Google Sheets returns every cell as text.
const asSheetCells = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value == null ? "" : String(value)]));

test("both rows of an evaluation carry ids, so the bulk insert has one key set (PostgREST PGRST102)", () => {
  for (const applied of [true, false]) {
    const [recommendation, policy] = rows(applied);
    assert.deepEqual(Object.keys(recommendation).sort(), Object.keys(policy).sort());
    assert.equal(recommendation.decision_id, ids.recommendation_decision_id);
    assert.equal(policy.decision_id, ids.policy_decision_id);
  }
  const shadow = policyRows({ user_id: "patient-1", result, mode: "shadow", schedule_applied: false, now: "2026-08-27T00:00:00.000Z" });
  assert.deepEqual(Object.keys(shadow[0]).sort(), Object.keys(shadow[1]).sort());
});

test("an applied evaluation survives the Sheets outbox round trip as the adaptation store would hold it", () => {
  for (const row of rows(true)) {
    assert.deepEqual(fromOutbox(asSheetCells(outboxRow(row))), JSON.parse(JSON.stringify(row)));
  }
});

function supabase(t, present) {
  const names = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const calls = []; const previousFetch = global.fetch;
  global.fetch = async function (url, options = {}) {
    calls.push({ method: options.method || "GET", url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).startsWith("https://supabase.test/rest/v1/adaptation_decisions?decision_id=in.")) {
      return new Response(JSON.stringify(present.map(decision_id => ({ decision_id }))), { status: 200 });
    }
    return new Response(JSON.stringify(options.body ? JSON.parse(options.body) : []), { status: 201 });
  };
  t.after(() => { global.fetch = previousFetch; names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; }); });
  return calls;
}

const stateUpdate = { user_id: "patient-1", behaviour_key: result.behaviour_key, preferred_frequency: 1, state_version: 5 };

test("replay inserts both rows and moves the state when neither reached the adaptation store", async function (t) {
  const calls = supabase(t, []);
  await store.call("restorePolicyEvaluation", rows(true), stateUpdate);
  assert.deepEqual(calls.map(call => call.method), ["GET", "POST", "POST"]);
  assert.match(calls[1].url, /user_adaptation_state/);
  assert.deepEqual(calls[2].body.map(row => row.decision_id), [ids.recommendation_decision_id, ids.policy_decision_id]);
});

test("replay is idempotent: rows already present are not inserted again and the state does not move twice", async function (t) {
  const calls = supabase(t, [ids.recommendation_decision_id, ids.policy_decision_id]);
  assert.deepEqual(await store.call("restorePolicyEvaluation", rows(true), stateUpdate), []);
  assert.deepEqual(calls.map(call => call.method), ["GET"]);
});

test("replay of a partly present evaluation inserts only the missing row", async function (t) {
  const calls = supabase(t, [ids.policy_decision_id]);
  await store.call("restorePolicyEvaluation", rows(true), stateUpdate);
  assert.deepEqual(calls.map(call => call.method), ["GET", "POST"]);
  assert.deepEqual(calls[1].body.map(row => row.decision_id), [ids.recommendation_decision_id]);
});
