"use strict";

// Localhost harness for the two-stage nudge feedback flow.
//
// Runs the real Monitor pages and the real /api/* handlers against an in-memory
// spreadsheet and a simulated WhatsApp, so the whole loop — configure a
// follow-up, deliver it, answer Yes, wait for the outcome check, answer Done —
// can be walked through in a browser before anything is deployed.
//
// It touches NOTHING live: no Google Sheets, no Supabase, no Twilio, no n8n.
// The Sheets test adapter is swapped in exactly as the unit tests do, and the
// Supabase endpoints the browser calls are served from this same process.
//
//   node local/dev-server.js          # http://127.0.0.1:4010
//   node local/dev-server.js --port 5000 --seed
//
// The delivery and scheduler logic is not re-implemented here: the Code nodes
// are lifted straight out of the workflow JSON and executed, so what you exercise
// locally is the same source that will run in n8n.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const LANDING = path.join(ROOT, "landing");
const WORKFLOWS = path.join(ROOT, "workflows");

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const PORT = Number(option("--port", 4010));
const HOST = "127.0.0.1";

// A fixed fake token. This server binds to loopback and never talks to a real
// Supabase project, but the value is still obviously non-secret by construction.
const DEV_TOKEN = "local-dev-token";
const DEV_PROFILE = {
  auth_user_id: "auth-local", email: "doctor@localhost.test", display_name: "Dr Local",
  role: "admin", doctor_id: "doc-local", status: "active"
};

// ---- In-memory spreadsheet -----------------------------------------------
// Column order mirrors the migrated live Sheet, so a header that is missing here
// fails the same assertHeaders guard it would fail in production.
const HEADERS = {
  user: ["user_id", "name", "phone", "email", "user_status", "doctor_id"],
  questionnaire: ["questionnaire_id", "user_id", "preferred_nudge_time"],
  prescriptions: ["prescription_id", "user_id", "doctor_id", "issued_date", "pillar", "category", "target_behavior", "frequency_per_week", "duration_weeks", "prescription_raw_text", "status"],
  // `category` last on both tabs, mirroring where the live migration appends it.
  nudges: ["nudge_id", "prescription_id", "user_id", "nudge_type", "pillar", "action_text", "scheduled_date", "scheduled_time", "message_body", "message_body_alt", "tone_variant", "template_name", "status", "sent_at", "reviewed_at", "week_number", "schedule_slot_id", "followup_enabled", "followup_delay_hours", "category"],
  weekly_schedule: ["schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "action_text", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "created_at", "updated_at", "followup_enabled", "followup_delay_hours", "category"],
  schedule_state: ["schedule_id", "nudge_id", "user_id", "parent_nudge_id", "status", "sent_at", "delivered_at", "wa_message_id", "response_wa_id", "barrier_followup_wa_id", "tone_sent", "response", "responded_at", "last_response_at", "barrier_tag", "followup_enabled", "followup_delay_hours", "commitment_response", "commitment_responded_at", "followup_due_at", "followup_sent_at", "followup_wa_id", "outcome_response", "outcome_responded_at", "done_count", "skip_count", "current_streak", "consecutive_skips", "last_updated"],
  inbound_messages: ["inbound_id", "received_at", "from_phone", "to_phone", "wa_message_id", "context_wa_id", "body", "button_text", "button_payload", "opt_out_type", "user_id", "matched_nudge_id", "stage", "classification", "applied", "note", "raw_payload"]
};

const tables = {};
const outbox = [];          // simulated WhatsApp messages, newest last
let sidCounter = 1000;
const nextSid = prefix => `${prefix}${String(++sidCounter).padStart(8, "0")}${"0".repeat(24)}`;

const clone = value => JSON.parse(JSON.stringify(value));

function resetTables(seed = {}) {
  for (const [name, headers] of Object.entries(HEADERS)) {
    tables[name] = {
      headers: headers.slice(),
      rows: (seed[name] || []).map((row, index) => Object.assign({ row_number: index + 2 }, clone(row)))
    };
  }
}

const sheetsAdapter = {
  async readTabs(names) {
    return Object.fromEntries(names.map(name => {
      if (!tables[name]) throw new Error(`Unknown tab: ${name}`);
      return [name, clone(tables[name])];
    }));
  },
  async batchWrite(operations) {
    const next = clone(tables);
    for (const operation of operations) {
      const table = next[operation.tab];
      if (!table) throw new Error(`Unknown tab: ${operation.tab}`);
      // Production drops keys that have no column, so the local sheet must too —
      // otherwise a missing header would look like it worked here and silently
      // lose data against the real spreadsheet.
      const row = Object.fromEntries(table.headers.map(header => [header, operation.row[header] == null ? "" : operation.row[header]]));
      if (operation.rowNumber) {
        const index = table.rows.findIndex(item => item.row_number === operation.rowNumber);
        if (index < 0) throw new Error(`row ${operation.rowNumber} missing from ${operation.tab}`);
        table.rows[index] = Object.assign({ row_number: operation.rowNumber }, row);
      } else {
        const rowNumber = table.rows.reduce((max, item) => Math.max(max, item.row_number), 1) + 1;
        table.rows.push(Object.assign({ row_number: rowNumber }, row));
      }
    }
    Object.assign(tables, next);
    return { replies: operations.map(() => ({})) };
  }
};

// ---- Workflow Code-node harness -------------------------------------------
// The n8n Code nodes are the real delivery and scheduler logic. Rather than
// paraphrase them, load and run them, so a local walkthrough exercises exactly
// what will be imported into n8n.
const workflow = name => JSON.parse(fs.readFileSync(path.join(WORKFLOWS, name), "utf8"));
const codeOf = (wf, nodeName) => {
  const found = wf.nodes.find(item => item.name === nodeName);
  if (!found) throw new Error(`missing node ${nodeName}`);
  return found.parameters.jsCode;
};
const runCode = (code, globals) => Function(...Object.keys(globals), code)(...Object.values(globals));

// Minimal Luxon stand-in — only what the Code nodes touch.
function nowLike(ms) {
  return {
    toMillis: () => ms,
    toISO: () => new Date(ms).toISOString(),
    toISODate: () => new Date(ms).toISOString().slice(0, 10),
    setZone: () => nowLike(ms),
    startOf: () => nowLike(Date.parse(`${new Date(ms).toISOString().slice(0, 10)}T00:00:00Z`)),
    plus: ({ hours = 0, minutes = 0 }) => nowLike(ms + hours * 3600000 + minutes * 60000),
    diff: (other, unit) => ({ [unit]: (ms - other.toMillis()) / (unit === "minutes" ? 60000 : 1) })
  };
}

const FAKE_ENV = {
  TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
  TWILIO_AUTH_TOKEN: "local-dev-not-a-real-token",
  TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
  TWILIO_CONTENT_SID: "HX" + "2".repeat(32),
  TWILIO_COMMITMENT_CONTENT_SID: "HX" + "3".repeat(32),
  TWILIO_OUTCOME_CONTENT_SID: "HX" + "4".repeat(32),
  FOLLOWUP_OUTCOME_WINDOW_HOURS: "24",
  FOLLOWUP_TICK_SECRET: "local-dev-tick-secret",
  // Localhost only. Lets /__sim/tick?at=... walk a multi-hour delay by hand,
  // which is the whole point of the harness. No deployment sets this.
  ALLOW_TICK_TIME_TRAVEL: "1"
};
Object.assign(process.env, FAKE_ENV);

// Everything outbound is intercepted here. The handlers call the real Twilio
// REST client; this answers as Twilio would and drops the message in the outbox
// instead, so no credential is needed and no message can escape.
const realFetch = global.fetch;
global.fetch = async function (url, init) {
  if (String(url).startsWith("https://api.twilio.com/")) {
    const form = new URLSearchParams(String((init && init.body) || ""));
    const sid = nextSid("SM");
    outbox.push({
      direction: "out", sid, to: form.get("To") || "", kind: form.get("ContentSid") ? "template" : "confirmation",
      body: form.get("Body") || "", content_sid: form.get("ContentSid") || "",
      content_variables: form.get("ContentVariables") || "", at: new Date().toISOString(), buttons: []
    });
    return new Response(JSON.stringify({ sid, status: "queued" }), { status: 201, headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};

// Invokes a real Vercel-style handler in-process and captures its response.
async function invokeHandler(handler, { method, url, headers, body }) {
  const chunks = typeof body === "string" ? [body] : [];
  const req = {
    method, url: url || "/", headers: Object.assign({ host: `${HOST}:${PORT}` }, headers || {}),
    body: typeof body === "string" ? undefined : body,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; }
  };
  let statusCode = 0, payload = "";
  const res = {
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = value; },
    setHeader() {},
    end(value) { payload = value || ""; }
  };
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(payload); } catch { parsed = null; }
  return Object.assign({ statusCode }, parsed || { body: payload });
}

const rowsOf = tab => clone(tables[tab].rows);
const writeRow = (tab, matchKey, matchValue, changes) => {
  const table = tables[tab];
  const row = table.rows.find(item => String(item[matchKey]) === String(matchValue));
  if (!row) return false;
  for (const [key, value] of Object.entries(changes)) {
    if (table.headers.includes(key)) row[key] = value;
  }
  return true;
};

// Simulated Workflow B: deliver every approved nudge due at or before `now`,
// ignoring the five-minute window so a local walkthrough is not a waiting game.
function simulateDelivery(nowMs) {
  const wfB = workflow("workflow_b_delivery_twilio.json");
  const users = rowsOf("user");
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const nowTime = new Date(nowMs).toISOString().slice(11, 16);

  const due = rowsOf("nudges").filter(n =>
    String(n.status) === "approved" && String(n.nudge_id).startsWith("schd_") &&
    String(n.scheduled_date) <= today &&
    (String(n.scheduled_date) < today || String(n.scheduled_time) <= nowTime));
  if (!due.length) return { delivered: 0 };

  // Reuse the real Prepare node by pinning $now to each row's own slot time.
  const prepared = [];
  for (const nudge of due) {
    const slotMs = Date.parse(`${nudge.scheduled_date}T${nudge.scheduled_time}:00Z`) + 60000;
    const result = runCode(codeOf(wfB, "Prepare Due Nudges"), {
      items: [{ json: nudge }],
      $: () => ({ first: () => ({ json: { users } }) }),
      $now: nowLike(slotMs)
    });
    prepared.push(...result);
  }
  if (!prepared.length) return { delivered: 0 };

  const built = runCode(codeOf(wfB, "Build Twilio Requests"), { items: prepared, $env: FAKE_ENV, Buffer });
  const responses = built.map(item => {
    const sid = nextSid("SM");
    const form = new URLSearchParams(item.json.twilio_form);
    outbox.push({
      direction: "out", sid, to: form.get("To"), kind: item.json.twilio_mode,
      nudge_id: item.json.nudge_id, action_text: item.json.action_text || "",
      body: item.json.message_body, at: new Date(nowMs).toISOString(),
      buttons: item.json.two_stage ? ["Yes", "No"] : ["Done", "In progress", "Not yet"]
    });
    return { json: { sid, status: "queued" } };
  });

  const merged = runCode(codeOf(wfB, "Merge Twilio Response"), {
    items: responses, $: () => ({ all: () => built }), $now: nowLike(nowMs)
  });

  for (const item of merged) {
    const n = item.json;
    writeRow("nudges", "nudge_id", n.nudge_id, { status: "sent", sent_at: n.sent_at });
    const state = tables.schedule_state.rows.find(row => String(row.nudge_id) === String(n.nudge_id));
    const changes = {
      schedule_id: n.schedule_id, nudge_id: n.nudge_id, user_id: n.user_id, parent_nudge_id: n.nudge_id,
      status: n.state_status, sent_at: n.sent_at, wa_message_id: n.wa_message_id,
      tone_sent: n.tone_variant || "", followup_enabled: n.followup_enabled_normalized,
      followup_delay_hours: n.followup_delay_hours, followup_due_at: n.followup_due_at,
      last_updated: n.sent_at
    };
    if (state) writeRow("schedule_state", "nudge_id", n.nudge_id, changes);
    else sheetsAdapter.batchWrite([{ tab: "schedule_state", headers: tables.schedule_state.headers, row: changes, rowNumber: null }]);
  }
  return { delivered: merged.length };
}

// Workflow F is now a two-node cron that POSTs to /api/followup-tick. The tick
// itself is real JS, so this calls the actual handler rather than re-implementing
// what the workflow's Sheets nodes used to do.
async function simulateScheduler(nowMs) {
  const handler = require(path.join(LANDING, "api/followup-tick.js"));
  return invokeHandler(handler, {
    method: "POST",
    headers: { "x-followup-secret": FAKE_ENV.FOLLOWUP_TICK_SECRET, "content-type": "application/json" },
    body: { source: "dev-simulator", now: new Date(nowMs).toISOString() }
  });
}

// Workflow C is retired: the reply path is /api/whatsapp-inbound. This signs a
// Twilio-shaped form body exactly as Twilio would and calls the real handler, so
// the simulator exercises signature validation, the inbound_messages log and the
// resolver — not a local re-implementation of them.
async function simulateInbound({ from, body, buttonPayload, contextSid, optOutType }, nowMs) {
  const handler = require(path.join(LANDING, "api/whatsapp-inbound.js"));
  const sid = nextSid("SM");
  const fields = {
    AccountSid: FAKE_ENV.TWILIO_ACCOUNT_SID,
    From: `whatsapp:${from}`,
    To: FAKE_ENV.TWILIO_WHATSAPP_FROM,
    Body: body || "",
    ButtonText: buttonPayload || "",
    ButtonPayload: buttonPayload || "",
    MessageSid: sid,
    OriginalRepliedMessageSid: contextSid || "",
    OptOutType: optOutType || "",
    NumMedia: "0"
  };
  const raw = new URLSearchParams(fields).toString();
  const url = `http://${HOST}:${PORT}/api/whatsapp-inbound`;
  const { expectedSignature } = require(path.join(LANDING, "api/_lib/twilio.js"));

  outbox.push({
    direction: "in", sid, from, body: buttonPayload || body || "",
    context: contextSid || "", at: new Date(nowMs).toISOString()
  });

  const result = await invokeHandler(handler, {
    method: "POST",
    url: "/api/whatsapp-inbound",
    headers: {
      host: `${HOST}:${PORT}`,
      "x-forwarded-proto": "http",
      "x-forwarded-host": `${HOST}:${PORT}`,
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": expectedSignature(FAKE_ENV.TWILIO_AUTH_TOKEN, url, fields)
    },
    body: raw
  });

  // The log row is the honest answer to "what happened to that reply?", so the
  // simulator surfaces it rather than a summary reconstructed here.
  const logged = rowsOf("inbound_messages").filter(row => String(row.wa_message_id) === sid)[0] || {};
  return {
    status: result.statusCode,
    reply_type: logged.classification || "",
    stage: logged.stage || "",
    nudge_id: logged.matched_nudge_id || "",
    applied: logged.applied || "FALSE",
    note: logged.note || "",
    inbound_id: logged.inbound_id || ""
  };
}

// ---- Seed -----------------------------------------------------------------
function seedData() {
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  const weekday = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][today.getUTCDay()];
  resetTables({
    user: [
      { user_id: "patient-local-1", name: "Ada Lovelace", phone: "+61400000001", email: "ada@localhost.test", user_status: "active", doctor_id: "doc-local" },
      { user_id: "patient-local-2", name: "Grace Hopper", phone: "+61400000002", email: "grace@localhost.test", user_status: "active", doctor_id: "doc-local" }
    ],
    questionnaire: [
      { questionnaire_id: "qn-1", user_id: "patient-local-1", preferred_nudge_time: "09:00" },
      { questionnaire_id: "qn-2", user_id: "patient-local-2", preferred_nudge_time: "18:30" }
    ],
    prescriptions: [
      { prescription_id: "rx-local-1", user_id: "patient-local-1", doctor_id: "doc-local", issued_date: iso, pillar: "physical_activity", category: "increase", target_behavior: "", frequency_per_week: 3, duration_weeks: 8, prescription_raw_text: "Walk more, most days, after dinner.", status: "active" },
      { prescription_id: "rx-local-2", user_id: "patient-local-2", doctor_id: "doc-local", issued_date: iso, pillar: "sleep", category: "establish", target_behavior: "", frequency_per_week: 5, duration_weeks: 6, prescription_raw_text: "Consistent bedtime before 11pm.", status: "active" }
    ],
    // Ada's prescription carries three wordings, exactly as Workflow A emits one
    // `nudges` row per frequency_per_week. That is what makes the slot's Option
    // 1..N list worth looking at — a single-wording seed would hide the feature.
    nudges: [
      { nudge_id: "ndg-local-1a", prescription_id: "rx-local-1", user_id: "patient-local-1", nudge_type: "reminder", pillar: "physical_activity", action_text: "Walk for 20 minutes after dinner", scheduled_date: iso, scheduled_time: "09:00", message_body: "Time for your 20-minute walk after dinner tonight.", message_body_alt: "Your 20-minute walk after dinner is scheduled for today.", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "", followup_enabled: "FALSE", followup_delay_hours: "" },
      { nudge_id: "ndg-local-1b", prescription_id: "rx-local-1", user_id: "patient-local-1", nudge_type: "reminder", pillar: "physical_activity", action_text: "Walk for 20 minutes after dinner", scheduled_date: iso, scheduled_time: "09:00", message_body: "Another day, another step — enjoy your walk after dinner.", message_body_alt: "Today's plan includes a 20-minute post-dinner walk.", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "", followup_enabled: "FALSE", followup_delay_hours: "" },
      { nudge_id: "ndg-local-1c", prescription_id: "rx-local-1", user_id: "patient-local-1", nudge_type: "reminder", pillar: "physical_activity", action_text: "Walk for 20 minutes after dinner", scheduled_date: iso, scheduled_time: "09:00", message_body: "Wonderful progress! Time for your walk — every one counts.", message_body_alt: "Walk session due: 20 minutes after dinner.", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "", followup_enabled: "FALSE", followup_delay_hours: "" },
      { nudge_id: "ndg-local-2", prescription_id: "rx-local-2", user_id: "patient-local-2", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10:30pm", scheduled_date: iso, scheduled_time: "20:00", message_body: "Start winding down — aim to be in bed by 10:30pm.", message_body_alt: "Bedtime target tonight is 10:30pm.", tone_variant: "neutral_informational", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "", followup_enabled: "FALSE", followup_delay_hours: "" }
    ]
  });
  return { iso, weekday };
}

// ---- HTTP -----------------------------------------------------------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

// The browser's auth.js speaks Supabase. Serving those few endpoints here keeps
// login.html, auth.js and every handler's requireUser() on their real code paths.
function handleSupabase(req, res, url) {
  const route = url.pathname.replace("/__supabase", "");
  if (route === "/auth/v1/token") {
    return sendJson(res, 200, { access_token: DEV_TOKEN, refresh_token: DEV_TOKEN, token_type: "bearer", expires_in: 3600, user: { id: DEV_PROFILE.auth_user_id, email: DEV_PROFILE.email } });
  }
  if (route === "/auth/v1/user") {
    const ok = String(req.headers.authorization || "").includes(DEV_TOKEN);
    return ok ? sendJson(res, 200, { id: DEV_PROFILE.auth_user_id, email: DEV_PROFILE.email }) : sendJson(res, 401, { msg: "invalid token" });
  }
  if (route === "/rest/v1/profiles") return sendJson(res, 200, [DEV_PROFILE]);
  if (route === "/auth/v1/logout") return sendJson(res, 200, {});
  return sendJson(res, 404, { msg: `Unhandled Supabase route ${route}` });
}

const API_ROUTES = {
  "/api/config": () => ({ handler: null, inline: (req, res) => sendJson(res, 200, { supabaseUrl: `http://${HOST}:${PORT}/__supabase`, supabaseAnonKey: "local-anon-key" }) }),
  "/api/me": () => ({ handler: require(path.join(LANDING, "api/me.js")) }),
  "/api/patients": () => ({ handler: require(path.join(LANDING, "api/patients.js")) }),
  "/api/patient": () => ({ handler: require(path.join(LANDING, "api/patient.js")) }),
  "/api/prescription": () => ({ handler: require(path.join(LANDING, "api/prescription.js")) }),
  "/api/approve": () => ({ handler: require(path.join(LANDING, "api/approve.js")) }),
  "/api/schedule": () => ({ handler: require(path.join(LANDING, "api/schedule.js")) }),
  // The retired Workflows C and F, now served here exactly as in production.
  "/api/whatsapp-inbound": () => ({ handler: require(path.join(LANDING, "api/whatsapp-inbound.js")) }),
  "/api/followup-tick": () => ({ handler: require(path.join(LANDING, "api/followup-tick.js")) })
};

// Local-only control surface for walking the two-stage flow by hand.
async function handleSim(req, res, url) {
  const route = url.pathname.replace("/__sim", "");
  const now = url.searchParams.get("at") ? Date.parse(url.searchParams.get("at")) : Date.now();

  if (route === "/state" && req.method === "GET") {
    return sendJson(res, 200, {
      now: new Date(now).toISOString(),
      outbox: outbox.slice(-40).reverse(),
      schedule_state: rowsOf("schedule_state"),
      inbound_messages: rowsOf("inbound_messages"),
      weekly_schedule: rowsOf("weekly_schedule"),
      nudges: rowsOf("nudges").map(n => ({ nudge_id: n.nudge_id, user_id: n.user_id, status: n.status, scheduled_date: n.scheduled_date, scheduled_time: n.scheduled_time, action_text: n.action_text, followup_enabled: n.followup_enabled, followup_delay_hours: n.followup_delay_hours })),
      users: rowsOf("user")
    });
  }
  if (route === "/deliver" && req.method === "POST") return sendJson(res, 200, simulateDelivery(now));
  if (route === "/tick" && req.method === "POST") return sendJson(res, 200, await simulateScheduler(now));
  if (route === "/reply" && req.method === "POST") {
    const body = await readBody(req);
    const result = await simulateInbound(body, now);
    return sendJson(res, result.error ? 400 : 200, result);
  }
  if (route === "/reset" && req.method === "POST") {
    outbox.length = 0;
    const info = seedData();
    return sendJson(res, 200, Object.assign({ reset: true }, info));
  }
  return sendJson(res, 404, { error: `Unknown simulator route ${route}` });
}

function serveStatic(req, res, url) {
  const rel = url.pathname === "/" ? "/monitor.html" : url.pathname;
  const target = path.join(LANDING, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!target.startsWith(LANDING)) { res.statusCode = 403; return res.end("forbidden"); }
  fs.readFile(target, (error, data) => {
    if (error) {
      if (rel === "/simulator.html") return serveSimulator(res);
      res.statusCode = 404; return res.end("not found");
    }
    res.setHeader("content-type", MIME[path.extname(target)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.end(data);
  });
}

function serveSimulator(res) {
  res.setHeader("content-type", MIME[".html"]);
  res.setHeader("cache-control", "no-store");
  res.end(fs.readFileSync(path.join(__dirname, "dev-simulator.html")));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (url.pathname.startsWith("/__supabase")) return handleSupabase(req, res, url);
    if (url.pathname.startsWith("/__sim")) return handleSim(req, res, url);
    if (url.pathname === "/simulator.html") return serveSimulator(res);

    const route = API_ROUTES[url.pathname];
    if (route) {
      const { handler, inline } = route();
      if (inline) return inline(req, res);
      req.body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await readBody(req) : undefined;
      return handler(req, res);
    }
    return serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: String(error.message || error) });
  }
});

// ---- Boot -----------------------------------------------------------------
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "local-dev-sheet";
process.env.SUPABASE_URL = `http://${HOST}:${PORT}/__supabase`;
process.env.SUPABASE_ANON_KEY = "local-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "local-service-key";

require(path.join(LANDING, "api/_lib/google-sheets.js"))._setTestAdapter(sheetsAdapter);
seedData();

server.listen(PORT, HOST, () => {
  console.log(`\n  Two-stage feedback dev server`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Monitor    http://${HOST}:${PORT}/monitor.html`);
  console.log(`  Simulator  http://${HOST}:${PORT}/simulator.html`);
  console.log(`  Login      any email / any password (auth is stubbed locally)\n`);
  console.log(`  In-memory sheet only — no Google Sheets, Supabase, Twilio or n8n is contacted.`);
  console.log(`  Nothing is persisted; restart to reset.\n`);
});
