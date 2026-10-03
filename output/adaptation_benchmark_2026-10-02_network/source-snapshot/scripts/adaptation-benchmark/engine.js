"use strict";
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { fixture } = require("../../landing/tests/sheets-fixture");
const store = require("../../landing/api/_lib/adaptive-store");
const core = require("../../landing/api/_lib/adaptive-core");
const { processInteraction } = require("../../landing/api/_lib/adaptive-service");
const handlers = require("../../landing/api/_lib/adaptive-handlers");
const inbound = require("../../landing/api/whatsapp-inbound");
const { expectedSignature } = require("../../landing/api/_lib/twilio");
const { database, clone } = require("./local-store");
const { none } = require("./cases");
const NOW = "2026-10-02T00:00:00.000Z";
const behaviour = { action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" };
const key = core.behaviourKey(behaviour);
const historySid = "SM" + "a".repeat(32);
const stateKeys = ["preferred_time", "preferred_frequency", "preferred_format", "preferred_summary_length", "preferred_tone", "preferred_action"];
function makeSeed(c) {
  const assets = ["paper", "video"].filter(k => !(c.unavailable_video && k === "video")).map(kind => ({ asset_id: `asset-${kind}`, behaviour_key: key,
    media_kind: kind, status: "approved", source_url: `https://example.test/${kind}`, title: `Synthetic ${kind} resource`, source_name: "Synthetic approved pool",
    short_summary: "SHORT synthetic explanation.", detailed_summary: "DETAILED synthetic explanation with additional context for this controlled software evaluation." }));
  const envelope = { ...behaviour, user_id: "synthetic-1", behaviour_key: key, status: "approved", automatic_schedule_apply: true,
    formats: ["paper", "video"], summary_lengths: ["short", "detailed"], tones: ["encouraging", "neutral_informational"],
    earliest_time: "08:00", latest_time: "20:00", frequency_min: 1, frequency_max: 3, action_alternatives: [behaviour.action_text],
    approved_asset_ids: assets.map(a => a.asset_id), ...c.envelope };
  const base = { ...behaviour, user_id: "synthetic-1", prescription_id: "rx-1", nudge_type: "reminder", message_body: "Prepare for sleep.",
    tone_variant: "encouraging", template_name: "health_plan_reminder", scheduled_time: "09:00", category: "establish",
    media_selection_mode: c.clinician_override ? "clinician_selected" : "automatic", media_override_asset_id: c.clinician_override ? "asset-paper" : "" };
  const slots = ["monday", "thursday"].map((day, i) => ({ ...base, schedule_slot_id: `slot-${i}`, source_nudge_id: "history", day,
    status: "active", start_date: "2026-10-05", end_date: "2026-10-18" }));
  const nudges = [{ ...base, nudge_id: "history", scheduled_date: "2026-09-28", status: "sent", sent_at: "2026-09-28T00:00:00.000Z", media_asset_id: "asset-paper" },
    ...slots.map((s,i) => ({ ...s, nudge_id: `schd_slot-${i}_${i ? "20261008" : "20261005"}`, scheduled_date: i ? "2026-10-08" : "2026-10-05", status: "approved", sent_at: "" }))];
  const sheets = { user: [{ user_id: "synthetic-1", name: "Synthetic Benchmark", phone: "+61400000000", user_status: "active", doctor_id: "doc-test" }],
    questionnaire: [{ questionnaire_id: "q1", user_id: "synthetic-1", opt_in_whatsapp: true }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "synthetic-1", doctor_id: "doc-test", ...behaviour, frequency_per_week: 2, status: "active" }],
    weekly_schedule: slots, nudges, schedule_state: nudges.map(n => ({ schedule_id: `state-${n.nudge_id}`, nudge_id: n.nudge_id, user_id: "synthetic-1",
      status: n.nudge_id === "history" ? "delivered" : "approved", sent_at: n.sent_at,
      delivered_at: n.nudge_id === "history" ? "2026-09-28T00:01:00.000Z" : "", read_at: "", wa_message_id: n.nudge_id === "history" ? historySid : "" })) };
  const db = { adaptation_envelopes: [envelope], media_assets: assets, media_candidates: [], media_search_jobs: [], tracked_links: [], patient_adaptation_state: [],
    user_adaptation_state: [{ user_id: "synthetic-1", behaviour_key: key, preferred_time: "09:00", preferred_frequency: 2, preferred_format: "paper", preferred_summary_length: "detailed", format_scores: {}, asset_history: [] }],
    adaptation_decisions: [], interaction_events: c.missing_evidence ? [] : [{ interaction_id: "old-positive", user_id: "synthetic-1", behaviour_key: key,
      nudge_id: "history", event_type: "inbound_reply", body: "Thanks", event_at: "2026-09-28T00:05:00.000Z", processed_at: "2026-09-28T00:06:00.000Z" }] };
  return { sheets, db, envelope };
}
function recorder() { return { statusCode: 0, headers: {}, body: "", setHeader(k,v) { this.headers[k] = v; }, end(v) { this.body = v || ""; } }; }
async function worker(fn, body) {
  const res = recorder(); await fn({ method: "POST", headers: { "x-n8n-proxy-secret": "benchmark-worker", host: "benchmark.invalid" }, body }, res);
  return { status: res.statusCode, body: JSON.parse(res.body || "{}") };
}
async function sendInbound(body, sid) {
  const fields = { MessageSid: sid, From: "whatsapp:+61400000000", Body: body, OriginalRepliedMessageSid: historySid, NumMedia: "0" };
  const url = "https://benchmark.invalid/api/whatsapp-inbound";
  const req = { method: "POST", url: "/api/whatsapp-inbound", headers: { host: "benchmark.invalid", "x-forwarded-proto": "https",
    "x-twilio-signature": expectedSignature("benchmark-token", url, fields), "content-type": "application/x-www-form-urlencoded" }, body: fields };
  const res = recorder(); await inbound(req, res); return { status: res.statusCode, body: res.body };
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
async function execute(c, arm, apiFetch) {
  const start = performance.now(); const seed = makeSeed(c); const fx = fixture(seed.sheets); const db = database(seed.db);
  const realFetch = global.fetch; const RealDate = global.Date; const previousEnv = { ...process.env };
  let apiMs = 0, apiCalls = 0;
  Object.assign(process.env, { SUPABASE_URL: "https://benchmark.invalid", SUPABASE_SERVICE_ROLE_KEY: "benchmark-only", ADAPTIVE_MEDIA_ENABLED: "true",
    ADAPTIVE_SCHEDULE_APPLY_ENABLED: "true", N8N_PROXY_SECRET: "benchmark-worker", TWILIO_AUTH_TOKEN: "benchmark-token", PUBLIC_APP_URL: "https://benchmark.invalid" });
  if (arm !== "hybrid") delete process.env.GEMINI_API_KEY;
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return RealDate.parse(NOW); } };
  global.fetch = async (url, options) => {
    if (new URL(url).origin === "https://benchmark.invalid") return db.fetch(url, options);
    if (arm === "hybrid" && new URL(url).hostname === "generativelanguage.googleapis.com") {
      const t = performance.now(); apiCalls++;
      try { return await apiFetch(url, options); } finally { apiMs += performance.now() - t; }
    }
    throw new Error("Benchmark blocked unexpected outbound request");
  };
  const trace = { case_id: c.id, category: c.category, arm, initial: clone({ sheets: fx.tables, database: db.tables }), steps: [], errors: [] };
  try {
    for (let i = 0; i < c.events.length; i++) {
      const eventSpec = c.events[i]; const before = clone(db.tables.user_adaptation_state[0]);
      const step = { input: eventSpec, checks: {}, before_state: before }; trace.steps.push(step);
      if (eventSpec.body != null) {
        const sid = "SM" + crypto.createHash("md5").update(`${c.id}-${i}`).digest("hex");
        step.inbound = await sendInbound(eventSpec.body, sid);
        step.checks.inbound_accepted = step.inbound.status === 200;
        let pending = await store.call("pendingInteraction");
        if (pending) {
          if (arm === "fixed") {
            step.decision = await store.call("saveDecision", pending, { previous_state: before, next_state: before, interpretation: none,
              outcome: "no_change", rule: "fixed_schedule_baseline", reason: "Preference adaptation disabled in reference arm" });
          } else step.decision = await processInteraction(pending);
          step.interpretation_correct = same(step.decision.interpretation, eventSpec.interpretation);
        }
        if (c.duplicate) {
          const stateBeforeDuplicate = clone(db.tables.user_adaptation_state);
          const count = db.tables.adaptation_decisions.length;
          step.duplicate_inbound = await sendInbound(eventSpec.body, sid);
          step.checks.duplicate_no_effect = !(await store.call("pendingInteraction")) && count === db.tables.adaptation_decisions.length && same(stateBeforeDuplicate, db.tables.user_adaptation_state);
        }
      }
      if (!c.stop && arm !== "fixed") {
        step.policy = await worker(handlers.frequencyWorker, { user_id: "synthetic-1", now: NOW });
        step.checks.policy_success = step.policy.status === 200;
      }
      const active = fx.tables.weekly_schedule.rows.filter(r => r.status === "active");
      const next = fx.tables.nudges.rows.filter(r => r.nudge_id !== "history" && !r.sent_at && (c.stop || (r.status === "approved" && !fx.tables.schedule_state.rows.some(st => st.nudge_id === r.nudge_id && st.status === "sending"))))
        .sort((a,b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`))[0];
      // A local prepared occurrence is consumed only as a delivery reservation, never sent.
      step.prepared = next ? await worker(handlers.prepareDelivery, { nudge_id: next.nudge_id }) : { status: 404, body: { error: "No future occurrence" } };
      const s = db.tables.user_adaptation_state[0];
      step.observed = { time: next?.scheduled_time, frequency: active.length, format: step.prepared.body.media_kind || null,
        summary: step.prepared.body.message_body?.includes("SHORT synthetic") ? "short" : step.prepared.body.message_body?.includes("DETAILED synthetic") ? "detailed" : null,
        blocked: step.prepared.status !== 200, user_status: fx.tables.user.rows[0].user_status };
      if (c.stop) {
        step.checks.stop_blocks = step.prepared.status === 409 && step.observed.user_status === "opted_out" && fx.tables.nudges.rows.filter(r=>r.nudge_id!=="history").every(r=>r.status === "canceled");
      } else {
        step.checks.prepared = step.prepared.status === 200;
        for (const field of ["time", "frequency", "format", "summary"]) step.checks[`expected_${field}`] = step.observed[field] === eventSpec.expected[field];
        step.checks.approved_asset = seed.envelope.approved_asset_ids.includes(step.prepared.body.media_asset_id);
        step.checks.time_inside_envelope = active.every(r => r.scheduled_time >= seed.envelope.earliest_time && r.scheduled_time <= seed.envelope.latest_time);
        step.checks.frequency_inside_envelope = active.length >= seed.envelope.frequency_min && active.length <= seed.envelope.frequency_max;
        step.checks.override_preserved = !c.clinician_override || step.prepared.body.media_asset_id === "asset-paper";
        step.checks.audit_complete = Boolean(step.prepared.body.adaptation_decision_id) && (eventSpec.body == null || Boolean(step.decision?.decision_id));
        const allowed = new Set(Object.keys(eventSpec.interpretation).filter(k => eventSpec.interpretation[k] != null && eventSpec.interpretation[k] !== false && eventSpec.interpretation[k] !== 0)
          .map(k => ({ time: "preferred_time", frequency_delta: "preferred_frequency", format: "preferred_format", summary_length: "preferred_summary_length", tone: "preferred_tone", action: "preferred_action" })[k]));
        step.checks.unrelated_preferences_preserved = stateKeys.filter(k=>!allowed.has(k)).every(k=>same(before[k], s[k]));
      }
      const history = fx.tables.nudges.rows.find(r=>r.nudge_id==="history");
      step.checks.sent_nudge_unchanged = same(history, trace.initial.sheets.nudges.rows.find(r=>r.nudge_id==="history"));
      const historyState = fx.tables.schedule_state.rows.find(r=>r.nudge_id==="history");
      const originalState = trace.initial.sheets.schedule_state.rows.find(r=>r.nudge_id==="history");
      step.checks.sent_delivery_fields_unchanged = ["sent_at", "delivered_at", "read_at", "wa_message_id", "status"].every(k=>historyState[k]===originalState[k]);
      step.after_state = clone(s);
      step.persisted_after = clone({ sheets: fx.tables, database: db.tables });
      // Sequential cases prepare the next different occurrence; retain the reservation.
    }
  } catch (error) { trace.errors.push(String(error.message).replace(/AIza[\w-]+/g,"[redacted]")); }
  finally {
    trace.final = clone({ sheets: fx.tables, database: db.tables }); trace.database_requests = db.requests;
    global.fetch = realFetch; global.Date = RealDate; fx.restore(); store._setTestAdapter(null);
    for (const k of Object.keys(process.env)) if (!(k in previousEnv)) delete process.env[k]; Object.assign(process.env, previousEnv);
  }
  trace.elapsed_ms = performance.now() - start; trace.api_ms = apiMs; trace.local_ms = Math.max(0, trace.elapsed_ms - apiMs); trace.api_calls = apiCalls;
  trace.failed_checks = trace.steps.flatMap((s,i)=>Object.entries(s.checks).filter(([,v])=>!v).map(([k])=>`${i}:${k}`));
  trace.success = trace.errors.length === 0 && trace.steps.length === c.events.length && trace.failed_checks.length === 0;
  trace.constraint_violations = trace.steps.flatMap((s,i)=>Object.entries(s.checks).filter(([k,v])=>!v && ["approved_asset","time_inside_envelope","frequency_inside_envelope","override_preserved","stop_blocks","sent_nudge_unchanged","sent_delivery_fields_unchanged"].includes(k)).map(([k])=>`${i}:${k}`));
  return trace;
}
module.exports = { execute, makeSeed, NOW };
