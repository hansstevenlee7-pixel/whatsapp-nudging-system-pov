"use strict";

// Checks the RQ1 translation-trace harness itself (scripts/translation-trace):
// the n8n runtime stand-ins and the link checks must not create or hide links.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DateTime, evaluate, runWorkflow } = require("../../scripts/translation-trace/n8n-runtime");
const links = require("../../scripts/translation-trace/links");
const { fixture } = require("./sheets-fixture");

const workflowA = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../workflows/workflow_a_intake.json"), "utf8"));
const MELBOURNE = "Australia/Melbourne";

test("the $now stand-in follows Melbourne time across the October daylight-saving change", function () {
  const monday = new DateTime(Date.parse("2026-10-04T21:00:00Z"), MELBOURNE);
  assert.equal(monday.toISODate(), "2026-10-05");
  assert.equal(monday.toISO(), "2026-10-05T08:00:00.000+11:00");
  assert.equal(monday.startOf("day").toISO(), "2026-10-05T00:00:00.000+11:00");
  assert.equal(monday.plus({ days: 6 }).toISODate(), "2026-10-11");
  assert.equal(monday.startOf("day").plus({ minutes: 9 * 60 }).toISO(), "2026-10-05T09:00:00.000+11:00");
  assert.equal(monday.diff(monday.startOf("day"), "minutes").minutes, 480);
  // Saturday 3 October is still +10; adding a day keeps 22:00 local after the clocks change.
  const saturday = new DateTime(Date.parse("2026-10-03T12:00:00Z"), MELBOURNE);
  assert.equal(saturday.toISO(), "2026-10-03T22:00:00.000+10:00");
  assert.equal(saturday.plus({ days: 1 }).toISO(), "2026-10-04T22:00:00.000+11:00");
});

test("n8n expressions return raw values for a whole expression and text for a template", function () {
  assert.equal(evaluate("={{ $json.flag }}", { $json: { flag: true } }), true);
  assert.equal(evaluate("=https://x.test/{{ $json.id }}?k={{ $env.K }}", { $json: { id: 7 }, $env: { K: "v" } }), "https://x.test/7?k=v");
  assert.equal(evaluate("plain", {}), "plain");
});

async function intake(responseText, secret = "s") {
  const fx = fixture({}); const sheets = { tables: fx.tables, writes: [] };
  try {
    const run = await runWorkflow(workflowA, {
      trigger: { headers: { "x-n8n-proxy-secret": secret }, body: { user: { user_id: "u1" }, questionnaire: {}, prescription_input: { prescription_raw_text: "Walk", doctor_id: "d1" } } },
      env: { N8N_PROXY_SECRET: "s" }, now: () => Date.parse("2026-10-04T21:00:00Z"), sheets,
      http: { "Call Gemini Vision": async () => ({ candidates: [{ content: { parts: [{ text: responseText }] } }] }) } });
    return { run, sheets };
  } finally { fx.restore(); }
}
const valid = { prescriptions: [{ ref: "p1", pillar: "physical_activity", category: "increase", frequency_per_week: 1, duration_weeks: 6 }],
  nudges: [{ prescription_ref: "p1", pillar: "physical_activity", nudge_type: "reminder", action_text: "Walk", scheduled_date: "2026-10-06",
    scheduled_time: "18:00", tone_variant: "encouraging", message_body: "Walk today.", message_body_alt: "", template_name: "health_plan_reminder" }] };

test("Workflow A runs its stored nodes in order and writes only after the gate passes", async function () {
  const accepted = await intake(JSON.stringify(valid));
  assert.equal(accepted.run.response.status, 200);
  assert.deepEqual(accepted.run.visited.slice(-3), ["Prep Schedule State", "Write Schedule State", "Respond Success"]);
  assert.deepEqual(accepted.sheets.writes.map(w => w.tab), ["user", "questionnaire", "prescriptions", "nudges", "schedule_state"]);
  assert.equal(accepted.run.outputs["Extract Input"][0].week1_start, "2026-10-05");

  const rejected = await intake(JSON.stringify(Object.assign({}, valid, { prescriptions: [Object.assign({}, valid.prescriptions[0], { category: "improve" })] })));
  assert.equal(rejected.run.response.status, 422);
  assert.equal(rejected.sheets.writes.length, 0);
  assert.ok(!rejected.run.visited.includes("Write User"));

  const unauthorised = await intake(JSON.stringify(valid), "wrong");
  assert.equal(unauthorised.run.response.status, 401);
  assert.ok(!unauthorised.run.visited.includes("Call Gemini Vision"));
});

test("link checks fail on a planted broken link instead of inferring it", function () {
  const stores = { sheets: {
    prescriptions: { rows: [{ prescription_id: "rx_a", user_id: "u", prescription_raw_text: "Walk" }] },
    nudges: { rows: [{ nudge_id: "ndg_1", user_id: "u", prescription_id: "rx_a" }, { nudge_id: "schd_x_20261006", user_id: "u", schedule_slot_id: "slot-1", prescription_id: "rx_a" }] },
    schedule_state: { rows: [{ nudge_id: "ndg_1" }, { nudge_id: "schd_x_20261006", wa_message_id: "SM1" }] },
    weekly_schedule: { rows: [{ schedule_slot_id: "slot-1", user_id: "u", source_nudge_id: "ndg_missing", prescription_id: "rx_a", status: "active",
      action_text: "Walk", pillar: "physical_activity", category: "increase" }] },
    delivery_events: { rows: [] } }, database: { adaptation_decisions: [], adaptation_envelopes: [] } };
  const chain = { user_id: "u", clinician: { auth_user_id: "c" }, clinician_changes: [], deliveries: [{ nudge_id: "schd_x_20261006", sid: "SM1" }] };
  assert.equal(links.approvalLinks(stores, chain).T5[0].ok, false);
  assert.deepEqual(links.chainClosure(stores, chain, "Walk"), { closed: false, path: ["message SM1 -> occurrence schd_x_20261006", "occurrence -> slot slot-1"], broken_at: "T5 slot -> LLM draft" });
  stores.sheets.weekly_schedule.rows[0].source_nudge_id = "ndg_1";
  assert.equal(links.chainClosure(stores, chain, "Walk").closed, true);
  assert.equal(links.chainClosure(stores, chain, "Walk more").broken_at, "T1 prescription -> submitted text");
  const llm = { prescriptions: [{ ref: "p1" }], nudges: [{ prescription_ref: "p9" }] };
  assert.equal(links.translationLinks(stores, "u", llm, "Walk").T3[0].ok, false);
});

test("Workflow A records the model, prompt template, response and normalisation behind each row", async function () {
  const drifted = JSON.parse(JSON.stringify(valid)); drifted.prescriptions[0].category = " Increase ";
  const fx = fixture({}); const sheets = { tables: fx.tables, writes: [] }; let url = "";
  try {
    const run = await runWorkflow(workflowA, {
      trigger: { headers: { "x-n8n-proxy-secret": "s" }, body: { user: { user_id: "u1" }, questionnaire: {}, prescription_input: { prescription_raw_text: "Walk", doctor_id: "d1" } } },
      env: { N8N_PROXY_SECRET: "s", GEMINI_API_KEY: "k" }, now: () => Date.parse("2026-10-04T21:00:00Z"), sheets,
      http: { "Call Gemini Vision": async request => { url = request.url;
        return { modelVersion: "gemini-2.5-flash-001", responseId: "resp-1", candidates: [{ content: { parts: [{ text: JSON.stringify(drifted) }] } }] }; } } });
    assert.equal(run.response.status, 200);
  } finally { fx.restore(); }
  assert.match(url, /\/models\/gemini-2\.5-flash:generateContent\?key=k$/);
  const prescription = fx.tables.prescriptions.rows[0]; const draft = fx.tables.nudges.rows[0];
  for (const row of [prescription, draft]) {
    assert.equal(row.translation_model, "gemini-2.5-flash-001");
    assert.match(row.translation_prompt_sha256, /^[0-9a-f]{64}$/);
    assert.equal(row.translation_response_id, "resp-1");
    assert.ok(Number.isFinite(Date.parse(row.translated_at)) && row.translated_at.endsWith("Z"));
  }
  assert.equal(prescription.category, "increase");
  assert.equal(prescription.translation_normalised, 'category: " Increase " -> increase');
});

test("provenance checks need the clinician and a time, and accept a retained LLM value only from a matching revision", function () {
  const base = { sheets: { prescriptions: { rows: [{ prescription_id: "rx_a", category: "increase" }] }, nudges: { rows: [] },
    weekly_schedule: { rows: [{ schedule_slot_id: "s1", user_id: "u", status: "active", source_nudge_id: "", prescription_id: "rx_a",
      action_text: "Walk", pillar: "physical_activity", category: "increase", approved_by: "c" }] },
    prescription_revisions: { rows: [{ prescription_id: "rx_a", field: "category", previous_value: "maintain", new_value: "increase" }] } },
    database: { adaptation_decisions: [], adaptation_envelopes: [] } };
  const change = { scope: "prescription", prescription_id: "rx_a", field: "category", llm_value: "reduce", approved_value: "increase", approved_kept: () => true };
  const chain = { user_id: "u", clinician: { auth_user_id: "c" }, clinician_changes: [change] };
  let result = links.approvalLinks(base, chain);
  assert.equal(result.T6[0].ok, false, "an identity without a time is not enough");
  assert.equal(result.T7[0].ok, false, "a revision of a different value does not retain the LLM's");
  base.sheets.weekly_schedule.rows[0].approved_at = "2026-10-04T21:30:00.000Z";
  base.sheets.prescription_revisions.rows[0].previous_value = "reduce";
  result = links.approvalLinks(base, chain);
  assert.equal(result.T6[0].ok, true);
  assert.equal(result.T7[0].ok, true);
});
