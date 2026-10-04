"use strict";

// RQ1 translation-to-feedback trace (PROTOCOL.md v1). Runs every case through the
// project's own workflow and API code against local stand-ins, then audits the
// links. No network, no WhatsApp, no Gemini, no deployment.
//
//   node scripts/translation-trace/run.js output/translation_trace_2026-10-04

const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
let OUT = path.resolve(ROOT, process.argv[2] || "output/translation_trace");
function setOut(dir) { OUT = path.resolve(ROOT, dir); fs.mkdirSync(path.join(OUT, "traces"), { recursive: true }); }
const PORTAL = "https://portal.invalid"; const N8N = "https://n8n.invalid"; const SUPA = "https://benchmark.invalid";
const sha = value => nodeCrypto.createHash("sha256").update(value).digest("hex");

// Deterministic randomness so reruns are byte-identical (declared stand-in). The
// application reads crypto.randomUUID and crypto.randomBytes at call time.
const realHash = (...parts) => nodeCrypto.createHash("sha256").update(parts.join("|")).digest();
let randomSeed = "init"; let randomCounter = 0;
nodeCrypto.randomUUID = function () {
  const h = realHash(randomSeed, "uuid", ++randomCounter).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const realRandomBytes = nodeCrypto.randomBytes;
nodeCrypto.randomBytes = function (size, callback) {
  if (callback) return realRandomBytes(size, callback);
  const out = Buffer.alloc(size); let filled = 0;
  while (filled < size) { const block = realHash(randomSeed, "bytes", ++randomCounter); block.copy(out, filled); filled += block.length; }
  return out;
};
function reseed(label) { randomSeed = label; randomCounter = 0; }

for (const name of ["GEMINI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEETS_SPREADSHEET_ID", "TWILIO_ACCOUNT_SID", "TWILIO_API_KEY",
  "TWILIO_API_SECRET", "YOUTUBE_API_KEY", "N8N_API_KEY"]) delete process.env[name];
Object.assign(process.env, { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "harness-anon", SUPABASE_SERVICE_ROLE_KEY: "harness-service",
  ADAPTIVE_MEDIA_ENABLED: "true", ADAPTIVE_SCHEDULE_APPLY_ENABLED: "true", N8N_PROXY_SECRET: "harness-worker", N8N_BASE_URL: N8N,
  TWILIO_AUTH_TOKEN: "harness-twilio", PUBLIC_APP_URL: PORTAL, TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886" });

const { fixture } = require("../../landing/tests/sheets-fixture");
const { database, clone } = require("../adaptation-benchmark/local-store");
const { runWorkflow, DateTime } = require("./n8n-runtime");
const { PART_A, PART_B, INTAKE_AT } = require("./cases");
const links = require("./links");
const intakeApi = require("../../landing/api/intake");
const approveApi = require("../../landing/api/approve");
const prescriptionApi = require("../../landing/api/prescription");
const statusApi = require("../../landing/api/whatsapp-status");
const inboundApi = require("../../landing/api/whatsapp-inbound");
const handlers = require("../../landing/api/_lib/adaptive-handlers");
const store = require("../../landing/api/_lib/adaptive-store");
const { expectedSignature } = require("../../landing/api/_lib/twilio");
const { behaviourKey } = require("../../landing/api/_lib/adaptive-core");

const WORKFLOW_A_PATH = "workflows/workflow_a_intake.json"; const WORKFLOW_B_PATH = "workflows/workflow_b_delivery_twilio.json";
const WORKFLOW_A = JSON.parse(fs.readFileSync(path.join(ROOT, WORKFLOW_A_PATH), "utf8"));
const WORKFLOW_B = JSON.parse(fs.readFileSync(path.join(ROOT, WORKFLOW_B_PATH), "utf8"));
const CLINICIAN = { auth_user_id: "11111111-1111-4111-a111-111111111111", email: "clinician@harness.invalid", display_name: "Synthetic clinician",
  role: "doctor", doctor_id: "doc-harness", status: "active" };
const SESSION = "harness-session";
const N8N_ENV = { N8N_PROXY_SECRET: process.env.N8N_PROXY_SECRET, PORTAL_BASE_URL: PORTAL, GEMINI_API_KEY: "harness-no-key", GOOGLE_SHEETS_SPREADSHEET_ID: "harness",
  TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`, TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886", TWILIO_SANDBOX_MODE: "true" };
const PHONE = "+61400000001";

// --- Clock ---------------------------------------------------------------------
const RealDate = global.Date; const clock = { ms: RealDate.parse(INTAKE_AT) };
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock.ms])); }
  static now() { return clock.ms; }
};
const melbourne = (date, time) => { const [y, m, d] = date.split("-").map(Number); const [h, mi] = time.split(":").map(Number);
  return DateTime.fromLocal({ year: y, month: m, day: d, hour: h, minute: mi }, "Australia/Melbourne").ms; };

// --- Stores and outbound routing ------------------------------------------------
const PRIMARY_KEYS = { media_search_jobs: "job_id", media_candidates: "candidate_id", media_assets: "asset_id", adaptation_envelopes: "envelope_id" };
let current = null; const refused = [];
function header(options, name) {
  const headers = options.headers || {};
  const found = Object.entries(headers instanceof Headers ? Object.fromEntries(headers) : headers).find(([k]) => k.toLowerCase() === name);
  return found ? String(found[1]) : "";
}
const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function newEnvironment(label) {
  reseed(label);
  const fx = fixture({});
  const db = database({ profiles: [CLINICIAN], media_search_jobs: [], media_candidates: [], media_assets: [], adaptation_envelopes: [],
    user_adaptation_state: [], interaction_events: [], adaptation_decisions: [], tracked_links: [], patient_adaptation_state: [], patient_adaptation_timeline: [] });
  // Emulates the uuid primary-key and timestamp defaults declared in supabase/migrations.
  const dbFetch = async (url, options = {}) => {
    const u = new URL(url); const table = u.pathname.split("/").at(-1);
    if ((options.method || "GET") === "POST" && options.body && PRIMARY_KEYS[table]) {
      const payload = JSON.parse(options.body); const list = [].concat(payload);
      const conflict = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
      for (const row of list) {
        const existing = conflict.length && db.tables[table].find(r => conflict.every(k => r[k] === row[k]));
        if (!row[PRIMARY_KEYS[table]]) row[PRIMARY_KEYS[table]] = existing ? existing[PRIMARY_KEYS[table]] : nodeCrypto.randomUUID();
        if (!existing && row.created_at == null) row.created_at = new Date().toISOString();
      }
      options = Object.assign({}, options, { body: JSON.stringify(Array.isArray(payload) ? list : list[0]) });
    }
    return db.fetch(url, options);
  };
  current = { label, fx, db, dbFetch, sheets: { tables: fx.tables, writes: [] }, gemini: [], llmResponse: null, workflowRuns: [], acks: [] };
  return current;
}

global.fetch = async (input, options = {}) => {
  const u = new URL(String(input));
  if (u.origin === SUPA && u.pathname === "/auth/v1/user") {
    return header(options, "authorization") === `Bearer ${SESSION}` ? json(200, { id: CLINICIAN.auth_user_id, email: CLINICIAN.email }) : json(401, { msg: "Invalid session" });
  }
  if (u.origin === SUPA && u.pathname.startsWith("/rest/v1/")) return current.dbFetch(String(input), options);
  if (u.origin === N8N && u.pathname === "/webhook/intake") {
    const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const run = await runWorkflow(WORKFLOW_A, { trigger: { headers, params: {}, query: {}, body: JSON.parse(options.body) }, env: N8N_ENV,
      now: () => clock.ms, sheets: current.sheets, uuidSeed: `${current.label}|workflow-a`, http: {
        "Call Gemini Vision": async request => {
          const prompt = JSON.parse(request.body).contents[0].parts[0].text;
          current.gemini.push({ url: request.url.replace(/key=[^&]*/, "key=[harness]"), prompt_sha256: sha(prompt), prompt });
          // A function stands in for a live call (FIDELITY_PROTOCOL.md); otherwise the recorded fixture.
          return typeof current.llmResponse === "function" ? current.llmResponse(request) : current.llmResponse;
        } } });
    current.workflowRuns.push({ workflow: "A", visited: run.visited, error: run.error || null, gate: run.outputs && run.outputs["Validation Gate"] });
    const body = run.response ? run.response.body : { message: run.error };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: run.response ? run.response.status : 500, headers: { "content-type": "application/json" } });
  }
  // Twilio REST stand-in for messages the portal sends itself (reply acknowledgements).
  if (u.origin === "https://api.twilio.com" && /\/Messages\.json$/.test(u.pathname) && (options.method || "GET") === "POST") {
    const sid = `SM${sha(`${current.label}|ack|${current.acks.length}`).slice(0, 32)}`;
    current.acks.push({ sid, form: Object.fromEntries(new URLSearchParams(String(options.body))) });
    return json(201, { sid, status: "queued" });
  }
  refused.push(`${options.method || "GET"} ${u.origin}${u.pathname}`);
  throw new Error(`Harness refused outbound request to ${u.host}`);
};

// --- Request helpers -------------------------------------------------------------
function recorder() { return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v || ""; } }; }
async function call(handler, { method = "POST", url = "/", headers = {}, body }) {
  const res = recorder();
  await handler({ method, url, headers: Object.assign({ host: "portal.invalid", "x-forwarded-proto": "https" }, headers), body, query: {} }, res);
  let parsed; try { parsed = JSON.parse(res.body || "{}"); } catch (_) { parsed = res.body; }
  return { status: res.statusCode || 200, body: parsed };
}
const asClinician = { authorization: `Bearer ${SESSION}` };
const asWorker = { "x-n8n-proxy-secret": process.env.N8N_PROXY_SECRET };
async function twilioPost(handler, pathname, fields) {
  return call(handler, { url: pathname, body: fields, headers: { "content-type": "application/x-www-form-urlencoded",
    "x-twilio-signature": expectedSignature(process.env.TWILIO_AUTH_TOKEN, `${PORTAL}${pathname}`, fields) } });
}
const snapshot = () => clone({ sheets: current.fx.tables, database: current.db.tables });
const geminiResponse = c => ({ candidates: [{ content: { parts: [{ text: c.raw != null ? c.raw : JSON.stringify(c.llm) }] } }] });

function intakePayload(c, userId) {
  return { user: { user_id: userId, name: "Synthetic patient", phone: PHONE, email: "patient@harness.invalid", created_at: new Date().toISOString(), user_status: "active" },
    questionnaire: { opt_in_whatsapp: true }, assigned_doctor_id: "", prescription_input: { issued_date: "2026-10-04", prescription_raw_text: c.text } };
}
async function submitIntake(c, userId) {
  current.llmResponse = c.responder || geminiResponse(c); clock.ms = RealDate.parse(INTAKE_AT);
  return call(intakeApi, { url: "/api/intake", headers: asClinician, body: intakePayload(c, userId) });
}

// --- Part A -------------------------------------------------------------------------
async function partA(c) {
  newEnvironment(c.id); const userId = `usr-${c.id.toLowerCase()}`;
  const response = await submitIntake(c, userId);
  const accepted = response.status === 200 && response.body && response.body.status === "ok";
  const rejected = response.status === 422;
  const verdict = accepted ? "ACCEPTED" : rejected ? "REJECTED" : `ERROR ${response.status}`;
  const rows = current.sheets.writes.length;
  const stores = snapshot(); const run = current.workflowRuns[0] || {};
  let agrees = false; let note = "";
  if (c.expected === "REJECT") agrees = rejected && rows === 0;
  if (c.expected === "ACCEPT") agrees = accepted;
  if (c.expected === "NORMALISE") {
    const category = (stores.sheets.prescriptions.rows[0] || {}).category;
    agrees = accepted && category === c.normalised_category; note = `stored category ${JSON.stringify(category)}`;
  }
  const t3 = accepted && c.llm ? links.translationLinks(stores, userId, c.llm, c.text).T3 : [];
  return { id: c.id, class: c.cls, expected: c.expected, verdict, agrees, rows_written: rows, rows_written_on_refusal: rejected ? rows : null,
    silent_acceptance: c.expected === "REJECT" && accepted, gate: run.gate && run.gate[0] ? { validation_passed: run.gate[0].validation_passed, stage: run.gate[0].stage || null,
      errors: run.gate[0].errors || (run.gate[0].error ? [run.gate[0].error] : []) } : null,
    response: { status: response.status, body: response.body }, visited: run.visited, draft_links: t3, note: note || undefined };
}

// --- Part B -------------------------------------------------------------------------
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const weekday = iso => WEEKDAYS[new RealDate(`${iso}T00:00:00Z`).getUTCDay()];
// Mirrors monitor.html slotFrom()/newSlotId() for an initial approval.
function slotFrom(row, index) {
  const day = weekday(row.scheduled_date);
  return { schedule_slot_id: `slot_${String(row.nudge_id).replace(/[^A-Za-z0-9_-]/g, "").slice(-24)}_${day}_${index}`, source_nudge_id: row.nudge_id,
    prescription_id: row.prescription_id, day, time: row.scheduled_time || "09:00", nudge_type: row.nudge_type || "reminder", pillar: row.pillar || "",
    category: row.category || "", action_text: row.action_text || "", tone_variant: row.tone_variant || "neutral_informational", message_body: row.message_body || "",
    message_body_alt: row.message_body_alt || "", template_name: row.template_name || "health_plan_reminder", media_selection_mode: "automatic", media_override_asset_id: "" };
}
const SLOT_TO_ROW = { time: "scheduled_time", action_text: "action_text", day: "day" };
const RESERVED = new Set(["sending", "accepted", "queued", "sent", "delivered", "read"]);

async function deliverDue(userId, label) {
  const deliveries = []; const sids = [];
  const run = await runWorkflow(WORKFLOW_B, { trigger: { timestamp: new Date().toISOString() }, env: N8N_ENV, now: () => clock.ms, sheets: current.sheets,
    uuidSeed: `${current.label}|${label}`, http: {
      "Prepare Adaptive Media": async request => {
        const r = await call(handlers.prepareDelivery, { url: "/api/internal/prepare-delivery", headers: { "x-n8n-proxy-secret": request.headers["x-n8n-proxy-secret"] }, body: JSON.parse(request.body) });
        if (r.status !== 200) throw new Error(`prepare-delivery HTTP ${r.status}: ${JSON.stringify(r.body)}`);
        return r.body;
      },
      "Send via Twilio": async request => {
        const sid = `SM${sha(`${current.label}|${label}|${sids.length}`).slice(0, 32)}`; sids.push(sid);
        return { sid, status: "queued", form_sha256: sha(request.body) };
      } } });
  current.workflowRuns.push({ workflow: "B", label, visited: run.visited, error: run.error || null });
  if (run.error) throw new Error(`Workflow B (${label}) failed: ${run.error}`);
  const prepared = (run.outputs && run.outputs["Prepare Adaptive Media"]) || [];
  for (const row of (run.outputs && run.outputs["Merge Twilio Response"]) || []) {
    if (row.user_id !== userId) continue;
    deliveries.push({ nudge_id: row.nudge_id, sid: row.wa_message_id, attempt: row.delivery_attempt_id, label,
      prepared: prepared.find(p => p.nudge_id === row.nudge_id) || null });
  }
  clock.ms += 60000;
  for (const delivery of deliveries) {
    const callback = await twilioPost(statusApi, "/api/whatsapp-status", { MessageSid: delivery.sid, MessageStatus: "delivered",
      AccountSid: N8N_ENV.TWILIO_ACCOUNT_SID, From: N8N_ENV.TWILIO_WHATSAPP_FROM, To: `whatsapp:${PHONE}` });
    delivery.callback = callback.status; delivery.delivered_at_ms = clock.ms;
  }
  return deliveries;
}

function nextOccurrence(userId) {
  const states = current.fx.tables.schedule_state.rows;
  return current.fx.tables.nudges.rows.filter(n => n.user_id === userId && String(n.nudge_id).startsWith("schd_") && n.status === "approved" && !n.sent_at &&
    !states.some(s => s.nudge_id === n.nudge_id && RESERVED.has(String(s.status))) && melbourne(n.scheduled_date, n.scheduled_time) > clock.ms)
    .sort((a, b) => melbourne(a.scheduled_date, a.scheduled_time) - melbourne(b.scheduled_date, b.scheduled_time))[0];
}

async function partB(c) {
  newEnvironment(c.id); const userId = `usr-${c.id.toLowerCase()}`;
  const chain = { user_id: userId, clinician: CLINICIAN, clinician_changes: [], deliveries: [], steps: [] };
  const intake = await submitIntake(c, userId);
  chain.steps.push({ step: "intake via portal and Workflow A", status: intake.status, body: intake.body });
  if (intake.status !== 200) throw new Error(`${c.id}: intake failed ${JSON.stringify(intake.body)}`);
  const afterIntake = snapshot();
  const { prescriptions, drafts } = links.intakeRows(afterIntake, userId, c.llm);

  // Clinician review: prescription corrections first, then the approval.
  clock.ms = RealDate.parse(INTAKE_AT) + 30 * 60000;
  for (const [ref, fields] of Object.entries((c.review || {}).prescription_corrections || {})) {
    const index = c.llm.prescriptions.findIndex(p => p.ref === ref); const row = prescriptions[index];
    const result = await call(prescriptionApi, { method: "PATCH", url: "/api/prescription", headers: asClinician,
      body: Object.assign({ user_id: userId, prescription_id: row.prescription_id }, fields) });
    chain.steps.push({ step: `prescription correction ${ref}`, status: result.status });
    for (const [field, value] of Object.entries(fields)) {
      chain.clinician_changes.push({ scope: "prescription", prescription_id: row.prescription_id, field, llm_value: row[field], approved_value: value,
        approved_kept: s => s.sheets.prescriptions.rows.some(p => p.prescription_id === row.prescription_id && String(p[field]) === String(value)) });
    }
  }
  const leaveOut = new Set((c.review || {}).leave_out || []); const edits = (c.review || {}).edits || {};
  const slots = [];
  drafts.forEach((draftRow, index) => {
    if (leaveOut.has(index)) return;
    const slot = slotFrom(draftRow, index);
    for (const [field, value] of Object.entries(edits[index] || {})) {
      slot[field] = value;
      const rowField = SLOT_TO_ROW[field];
      chain.clinician_changes.push({ scope: "draft", draft_id: draftRow.nudge_id, field: rowField, llm_value: draftRow[rowField], approved_value: value,
        approved_kept: s => s.sheets.weekly_schedule.rows.some(w => w.schedule_slot_id === slot.schedule_slot_id && String(w[rowField]) === String(value)) });
    }
    slots.push(slot);
  });
  const approval = await call(approveApi, { url: "/api/approve", headers: asClinician,
    body: { decision: "approve", user_id: userId, start_date: "2026-10-05", end_date: "2026-11-01", slots } });
  chain.steps.push({ step: "clinician approval", status: approval.status, body: approval.status === 200 ? { slots: (approval.body.weekly_schedule || []).length } : approval.body });
  if (approval.status !== 200) throw new Error(`${c.id}: approval failed ${JSON.stringify(approval.body)}`);

  // Media discovery stand-in, then the clinician's envelope and pool approval.
  for (const envelope of current.db.tables.adaptation_envelopes.filter(e => e.user_id === userId && e.status === "draft")) {
    for (const [kind, openAccess] of [["video", false], ["paper", true]]) {
      current.db.tables.media_candidates.push({ candidate_id: nodeCrypto.randomUUID(), behaviour_key: envelope.behaviour_key, media_kind: kind,
        title: `Synthetic ${kind} for ${envelope.action_text}`, source_name: "Synthetic approved pool", source_url: `https://example.test/${envelope.behaviour_key}/${kind}`,
        open_access: openAccess, short_summary: "SHORT synthetic explanation.", detailed_summary: "DETAILED synthetic explanation for this controlled evaluation.",
        ranking_score: kind === "video" ? 2 : 1, ranking_reasons: [], metadata: {} });
    }
    const fields = Object.fromEntries(Object.entries(envelope).filter(([k]) => !["envelope_id", "user_id", "behaviour_key", "status", "created_at", "updated_at"].includes(k)));
    const plan = await call(handlers.plan, { url: "/api/adaptive-plan", headers: asClinician, body: { user_id: userId, behaviour_key: envelope.behaviour_key,
      envelope: Object.assign(fields, { frequency_min: 1, frequency_max: 3, earliest_time: "08:00", latest_time: "21:00", automatic_schedule_apply: true }) } });
    chain.steps.push({ step: `envelope approval ${envelope.behaviour_key.slice(0, 8)}`, status: plan.status, body: plan.status === 200 ? undefined : plan.body });
  }
  const afterApproval = snapshot();

  // First delivery, reply, adaptation, next delivery.
  const first = nextOccurrence(userId);
  clock.ms = melbourne(first.scheduled_date, first.scheduled_time) + 60000;
  chain.deliveries.push(...await deliverDue(userId, "first-delivery"));
  const replied = chain.deliveries.find(d => d.nudge_id === first.nudge_id) || chain.deliveries[0];
  const before = snapshot();
  clock.ms += 28 * 60000;
  const inbound = await twilioPost(inboundApi, "/api/whatsapp-inbound", { MessageSid: `SM${sha(`${c.id}|reply`).slice(0, 32)}`, From: `whatsapp:${PHONE}`,
    To: N8N_ENV.TWILIO_WHATSAPP_FROM, Body: c.reply, OriginalRepliedMessageSid: replied.sid, NumMedia: "0", AccountSid: N8N_ENV.TWILIO_ACCOUNT_SID });
  chain.steps.push({ step: "signed reply", status: inbound.status });

  // Workflow C ticks (adaptation worker, then frequency worker): one just after the
  // reply and one just after the first delivery's 24-hour window closes. Due
  // deliveries are interleaved in time order; the "next message" is the first
  // delivery after the last tick.
  const workerTick = async label => {
    const adaptation = await call(handlers.adaptationWorker, { url: "/api/internal/adaptation-worker", headers: asWorker, body: {} });
    const frequency = await call(handlers.frequencyWorker, { url: "/api/internal/frequency-worker", headers: asWorker, body: { user_id: userId, now: new Date().toISOString() } });
    chain.steps.push({ step: `workflow C tick (${label})`, adaptation: adaptation.body && adaptation.body.status, decision: adaptation.body && adaptation.body.decision ?
      { outcome: adaptation.body.decision.outcome, rule: adaptation.body.decision.rule_applied, reason: adaptation.body.decision.reason } : null,
      frequency: frequency.body && frequency.body.status, policy: frequency.body && frequency.body.result ? { current: frequency.body.result.current_frequency,
        recommended: frequency.body.result.recommended_frequency, schedule: frequency.body.schedule } : null });
    return { adaptation, frequency };
  };
  clock.ms += 2 * 60000;
  const firstTick = await workerTick("after reply");
  const decision = firstTick.adaptation.body && firstTick.adaptation.body.decision || null;
  const closeAt = replied.delivered_at_ms + 24 * 3600000 + 2 * 60000;
  let policy = firstTick.frequency; let closed = false; let nextDeliveries = [];
  for (let guard = 0; guard < 10 && !(closed && nextDeliveries.length); guard++) {
    const next = nextOccurrence(userId); const due = next ? melbourne(next.scheduled_date, next.scheduled_time) + 60000 : Infinity;
    if (!closed && closeAt <= due) {
      clock.ms = closeAt; const tick = await workerTick("after the 24-hour window closes"); closed = true;
      if (tick.frequency.body && tick.frequency.body.status !== "idle") policy = tick.frequency;
    } else if (next) {
      clock.ms = due; const delivered = await deliverDue(userId, `delivery-${guard}`); chain.deliveries.push(...delivered);
      if (closed) nextDeliveries = delivered;
    } else break;
  }
  const final = snapshot();
  const preparedNext = nextDeliveries[0] && nextDeliveries[0].prepared;
  chain.acknowledgements = current.acks.map(a => ({ sid: a.sid, to: a.form.To, body: a.form.Body }));
  chain.feedback = { reply: c.reply, decision, policy, prepared: preparedNext ? { status: 200, body: preparedNext } : null, before, after: final };

  const result = { id: c.id, case_reply: c.reply, steps: chain.steps, decision: decision && { outcome: decision.outcome, rule: decision.rule_applied, reason: decision.reason, decision_id: decision.decision_id },
    acknowledgements: chain.acknowledgements, policy: policy.body && policy.body.result ? { current: policy.body.result.current_frequency,
      recommended: policy.body.result.recommended_frequency, applied: Boolean(policy.body.schedule && policy.body.schedule.applied) } : { status: policy.body && policy.body.status },
    deliveries: chain.deliveries.map(d => ({ nudge_id: d.nudge_id, sid: d.sid, label: d.label, callback: d.callback })), clinician_changes: chain.clinician_changes.map(ch => ({
      scope: ch.scope, field: ch.field, llm_value: ch.llm_value, approved_value: ch.approved_value })), links: {} };
  Object.assign(result.links, links.translationLinks(afterIntake, userId, c.llm, c.text), links.approvalLinks(afterApproval, chain),
    links.deliveryLinks(final, chain), links.feedbackLinks(chain));
  result.closure = links.chainClosure(final, chain, c.text);
  fs.writeFileSync(path.join(OUT, "traces", `${c.id}.json`), `${JSON.stringify({ case: c, result, prescriptions: prescriptions.map(p => p.prescription_id),
    drafts: drafts.map(d => d.nudge_id), gemini_requests: current.gemini.map(g => ({ url: g.url, prompt_sha256: g.prompt_sha256 })), workflow_runs: current.workflowRuns,
    after_intake: afterIntake, after_approval: afterApproval, final }, null, 2)}\n`);
  return result;
}

// --- Report -------------------------------------------------------------------------
function tally(results) {
  const table = {};
  for (const r of results) for (const [id, instances] of Object.entries(r.links)) {
    const cell = table[id] = table[id] || { present: 0, applicable: 0, missing: [] };
    for (const instance of instances) { cell.applicable += 1; if (instance.ok) cell.present += 1; else if (!cell.missing.includes(r.id)) cell.missing.push(r.id); }
  }
  return table;
}

async function main() {
  fs.mkdirSync(path.join(OUT, "traces"), { recursive: true });
  const partAResults = []; for (const c of PART_A) partAResults.push(await partA(c));
  const partBResults = []; for (const c of PART_B) partBResults.push(await partB(c));
  global.Date = RealDate;
  const linkTable = tally(partBResults);
  const protocolSha = sha(fs.readFileSync(path.join(__dirname, "PROTOCOL.md")));
  const results = { protocol: "translation-trace-v1", protocol_sha256: protocolSha,
    part_a: { cases: partAResults, agree: partAResults.filter(r => r.agrees).length, total: partAResults.length,
      rows_written_on_refusal: partAResults.reduce((s, r) => s + (r.rows_written_on_refusal || 0), 0),
      silent_acceptances: partAResults.filter(r => r.silent_acceptance).map(r => `${r.id} (${r.class})`) },
    part_b: { cases: partBResults, links: linkTable, chains_closed: partBResults.filter(r => r.closure.closed).length, total: partBResults.length },
    refused_outbound: refused };
  const text = `${JSON.stringify(results, null, 2)}\n`;
  fs.writeFileSync(path.join(OUT, "results.json"), text);
  fs.writeFileSync(path.join(OUT, "results.sha256"), `${sha(text)}  results.json\n`);
  const sources = ["scripts/translation-trace/PROTOCOL.md", "scripts/translation-trace/cases.js", "scripts/translation-trace/run.js", "scripts/translation-trace/links.js",
    "scripts/translation-trace/n8n-runtime.js", "scripts/adaptation-benchmark/trace-completeness.js", "scripts/adaptation-benchmark/local-store.js", WORKFLOW_A_PATH, WORKFLOW_B_PATH,
    "landing/api/intake.js", "landing/api/approve.js", "landing/api/prescription.js", "landing/api/whatsapp-status.js", "landing/api/whatsapp-inbound.js",
    "landing/api/_lib/adaptive-handlers.js", "landing/api/_lib/schedule-store.js", "landing/api/_lib/prescription-store.js", "landing/api/_lib/delivery-store.js",
    "landing/api/_lib/adaptive-service.js", "landing/api/_lib/adaptive-store.js", "landing/api/_lib/frequency-shadow.js", "landing/models/frequency-logistic-v1.json".replace("landing/models", "landing/api/_models")];
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify({ created_at: new RealDate().toISOString(), node: process.version, protocol_sha256: protocolSha,
    git_commit: require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    working_tree: "dirty; source_sha256 identifies the exact files run", network: "none (outbound requests refused)", gemini: "recorded synthetic fixtures; no API call",
    source_sha256: Object.fromEntries(sources.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), results_sha256: sha(text) }, null, 2)}\n`);
  writeReport(results);
}

function writeReport(results) {
  const a = results.part_a; const b = results.part_b;
  const lines = ["# RQ1 translation-to-feedback trace", "", `Protocol \`translation-trace-v1\` (SHA-256 \`${results.protocol_sha256.slice(0, 16)}…\`). Synthetic fixtures, local stand-ins, no network.`, "",
    "## Part A: translation gate under faulty LLM output", "", `Verdict agrees with the declared expectation in ${a.agree}/${a.total} cases. Rows written on refused intakes: ${a.rows_written_on_refusal}. Silent acceptances: ${a.silent_acceptances.join(", ") || "none"}.`, "",
    "| Case | Class | Expected | Verdict | Rows written | Gate stage | Draft → intended prescription | Agrees |", "|---|---|---|---|---:|---|---|---|"];
  for (const r of a.cases) {
    const t3 = r.draft_links.length ? `${r.draft_links.filter(x => x.ok).length}/${r.draft_links.length}` : "—";
    lines.push(`| ${r.id} | ${r.class} | ${r.expected} | ${r.verdict} | ${r.rows_written} | ${r.gate ? (r.gate.validation_passed ? "passed" : r.gate.stage) : "—"} | ${t3} | ${r.agrees ? "yes" : "**no**"} |`);
  }
  lines.push("", "## Part B: end-to-end lineage", "", `Chains closed from the last delivered message back to the submitted prescription text: ${b.chains_closed}/${b.total}.`, "",
    "| Link | Present / applicable | Missing in |", "|---|---:|---|");
  for (const id of Object.keys(links.LINKS)) if (b.links[id]) lines.push(`| ${id} ${links.LINKS[id]} | ${b.links[id].present}/${b.links[id].applicable} | ${b.links[id].missing.join(", ") || "—"} |`);
  lines.push("", "| Case | Reply | Decision on the reply | Frequency policy (current → recommended) | Deliveries | Chain closed |", "|---|---|---|---|---|---|");
  for (const r of b.cases) {
    const policy = r.policy.current != null ? `${r.policy.current} → ${r.policy.recommended}${r.policy.applied ? ", applied" : ""}` : r.policy.status || "—";
    lines.push(`| ${r.id} | ${JSON.stringify(r.case_reply)} | ${r.decision ? `${r.decision.outcome} (${r.decision.rule}${r.decision.reason ? `: ${r.decision.reason}` : ""})` : "—"} | ${policy} | ${r.deliveries.length} | ${r.closure.closed ? "yes" : `no (${r.closure.broken_at})`} |`);
  }
  lines.push("", `Outbound requests refused: ${results.refused_outbound.length}.`);
  fs.writeFileSync(path.join(OUT, "REPORT.md"), `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) main().catch(error => { global.Date = RealDate; console.error(error); process.exitCode = 1; });

module.exports = { partB, submitIntake, newEnvironment, snapshot, setOut, tally, links, RealDate, clock, refused,
  current: () => current, restoreDate: () => { global.Date = RealDate; } };
