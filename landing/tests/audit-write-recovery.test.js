"use strict";

// Part 2 §5.2: a schedule write that succeeds followed by a failed audit write.
// Scenarios and pass criteria are fixed in scripts/audit-recovery/PROTOCOL.md,
// hashed before this test first ran; each property is its own subtest.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const handler = require("../api/adaptive");
const adaptiveStore = require("../api/_lib/adaptive-store");
const { behaviourKey } = require("../api/_lib/adaptive-core");
const { fixture } = require("./sheets-fixture");

const BEHAVIOUR = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
const KEY = behaviourKey(BEHAVIOUR);
const HOUR = 3600000;
const at = offset => new Date(Date.parse("2026-08-27T00:00:00Z") + offset).toISOString();

// PostgREST rejects a bulk insert whose objects differ in keys (PGRST102); the
// in-memory store enforces the same rule so the harness cannot hide it.
function postgrestInsert(rows) {
  const keys = rows.map(row => Object.keys(row).sort().join(","));
  if (new Set(keys).size > 1) throw new Error("PGRST102 All object keys must match");
}

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

// `failing` holds the run numbers (1-based) in which the adaptation store is down.
function scenario(t, days, failing) {
  const slot = (day, index) => Object.assign({ schedule_slot_id: `slot-${index}`, user_id: "patient-1", source_nudge_id: "source-1",
    prescription_id: "rx-1", day, scheduled_time: "09:00", nudge_type: "reminder", tone_variant: "encouraging",
    message_body: "Take a short walk", message_body_alt: "", template_name: "health_plan_reminder", status: "active",
    start_date: "2026-09-07", end_date: "2026-10-04", media_selection_mode: "automatic" }, BEHAVIOUR);
  // Two closed deliveries without interaction: the policy supports one decrease.
  const delivered = index => Object.assign({ nudge_id: `past-${index}`, schedule_slot_id: `slot-${index - 1}`,
    prescription_id: "rx-1", user_id: "patient-1", status: "sent", scheduled_date: `2026-08-${19 + index}`,
    scheduled_time: "09:00", message_body: "Take a short walk" }, BEHAVIOUR);
  const fx = fixture({
    user: [{ user_id: "patient-1", name: "Ada", user_status: "active" }],
    questionnaire: [{ questionnaire_id: "q-1", user_id: "patient-1", opt_in_whatsapp: true }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-08-01",
      pillar: "physical_activity", category: "increase", frequency_per_week: days.length, duration_weeks: 8, status: "active" }],
    weekly_schedule: days.map(slot),
    nudges: [Object.assign({ nudge_id: "source-1", prescription_id: "rx-1", user_id: "patient-1", status: "approved",
      scheduled_date: "2026-08-01", scheduled_time: "09:00", message_body: "Take a short walk" }, BEHAVIOUR), delivered(1), delivered(2)],
    schedule_state: [1, 2].map(index => ({ schedule_id: `state-${index}`, nudge_id: `past-${index}`, user_id: "patient-1",
      status: "delivered", delivered_at: `2026-08-${19 + index}T00:00:00Z` }))
  });
  const stored = []; let run = 0;
  adaptiveStore._setTestAdapter({
    plansForUser: async () => ({ envelopes: [Object.assign({ behaviour_key: KEY, status: "approved", automatic_schedule_apply: true,
      frequency_min: 1, frequency_max: 3, earliest_time: "09:00", latest_time: "09:00", formats: ["video", "paper", "reading"] }, BEHAVIOUR)],
      events: [], decisions: stored.slice(), states: [], assets: [], historical_assets: [], candidates: [], global_state: {} }),
    savePolicyEvaluation: async rows => {
      if (failing.has(run)) throw new Error("audit store unavailable");
      postgrestInsert(rows);
      const saved = rows.map(row => Object.assign({ decision_id: crypto.randomUUID() }, row));
      stored.push(...saved); return saved;
    },
    restorePolicyEvaluation: async rows => {
      if (failing.has(run)) throw new Error("audit store unavailable");
      const present = new Set(stored.map(row => String(row.decision_id)));
      const missing = rows.filter(row => !present.has(String(row.decision_id)));
      if (missing.length) postgrestInsert(missing);
      stored.push(...missing); return missing;
    }
  });
  const names = ["N8N_PROXY_SECRET", "ADAPTIVE_SCHEDULE_APPLY_ENABLED"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { N8N_PROXY_SECRET: "worker-test", ADAPTIVE_SCHEDULE_APPLY_ENABLED: "true" });
  const quiet = console.error; console.error = () => {};
  t.after(() => {
    console.error = quiet; fx.restore(); adaptiveStore._setTestAdapter(null);
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });

  const rows = () => fx.tables.weekly_schedule.rows.filter(row => String(row.user_id) === "patient-1");
  const activeShape = () => rows().filter(row => row.status === "active").map(row => `${row.schedule_slot_id}|${row.day}|${row.scheduled_time}`).sort();
  return {
    startCount: days.length,
    async run(now) {
      run += 1;
      const res = responseRecorder();
      await handler({ method: "POST", url: "/api/adaptive?op=frequency", headers: { "x-n8n-proxy-secret": "worker-test" },
        body: { user_id: "patient-1", now } }, res);
      let body = {}; try { body = JSON.parse(res.body); } catch (_) { body = {}; }
      const persisted = new Set(stored.map(row => String(row.decision_id))
        .concat(fx.tables.adaptation_decisions.rows.map(row => String(row.decision_id))));
      const named = [...new Set(rows().map(row => String(row.adaptation_decision_id || "")).filter(Boolean))];
      return { run, now, audit_failed: failing.has(run), status: res.statusCode, body_status: body.status || null,
        recovered_evaluations: body.recovered_evaluations == null ? null : body.recovered_evaluations,
        active: activeShape(), active_count: activeShape().length,
        unexplained: named.filter(id => !persisted.has(id)),
        applied: stored.filter(row => row.signal_type === "adaptive_policy_applied" && row.behaviour_key === KEY)
          .map(row => ({ decision_id: row.decision_id, frequency_before: row.frequency_before, frequency_after: row.frequency_after })),
        policy_rows: stored.filter(row => String(row.signal_type).startsWith("adaptive_policy_"))
          .map(row => `${row.signal_type} ${row.frequency_before}→${row.frequency_after}`) };
    }
  };
}

async function runAll(t, s, offsets) {
  const runs = [];
  for (const offset of offsets) runs.push(await s.run(at(offset)));
  runs.forEach(row => t.diagnostic(JSON.stringify(row)));
  return runs;
}

function surfaced(runs) {
  for (const row of runs.filter(item => item.audit_failed)) {
    assert.ok(row.status < 200 || row.status >= 300, `run ${row.run} failed its audit write but answered ${row.status}`);
    assert.notEqual(row.body_status, "complete", `run ${row.run} failed its audit write but reported complete`);
  }
}

function explained(runs) {
  for (const row of runs) {
    assert.deepEqual(row.unexplained, [], `after run ${row.run}, schedule rows name decisions that were never persisted`);
  }
}

function recovered(runs, startCount) {
  const first = runs.find(row => !row.audit_failed);
  const last = runs.at(-1);
  for (const row of [first, last]) {
    assert.equal(row.applied.length, 1, `after run ${row.run}, the adaptation store holds ${row.applied.length} applied policy decisions (${row.policy_rows.join("; ") || "none"})`);
    assert.equal(Number(row.applied[0].frequency_before), startCount, `after run ${row.run}, the applied decision's frequency_before`);
    assert.equal(Number(row.applied[0].frequency_after), last.active_count, `after run ${row.run}, the applied decision's frequency_after`);
  }
}

test("S1 transient: the audit store fails in run 1 and works from run 2", async function (t) {
  const s = scenario(t, ["monday", "thursday"], new Set([1]));
  const runs = await runAll(t, s, [0, HOUR, 2 * HOUR]);
  await t.test("P1 surfaced", () => surfaced(runs));
  await t.test("P2 no unexplained change", () => explained(runs));
  await t.test("P3 recovered record", () => recovered(runs, s.startCount));
});

test("S2 persistent: the audit store fails in runs 1 to 3", async function (t) {
  const s = scenario(t, ["monday", "thursday"], new Set([1, 2, 3]));
  const runs = await runAll(t, s, [0, HOUR, 2 * HOUR]);
  await t.test("P1 surfaced", () => surfaced(runs));
  await t.test("P2 no unexplained change", () => explained(runs));
  await t.test("P5 no compounding during an outage", () => {
    for (const row of runs.slice(1)) assert.deepEqual(row.active, runs[0].active, `run ${row.run} changed the schedule again during the outage`);
  });
});

test("S3 step limit: from 3 per week, the audit store fails in run 1 and works in run 2", async function (t) {
  const s = scenario(t, ["monday", "wednesday", "friday"], new Set([1]));
  const runs = await runAll(t, s, [0, 24 * HOUR]);
  await t.test("P1 surfaced", () => surfaced(runs));
  await t.test("P2 no unexplained change", () => explained(runs));
  await t.test("P3 recovered record", () => recovered(runs, s.startCount));
  await t.test("P4 one step per week", () => {
    for (const row of runs) {
      assert.ok(Math.abs(row.active_count - s.startCount) <= 1, `after run ${row.run}, ${s.startCount} → ${row.active_count} per week within 7 days`);
    }
  });
});
