"use strict";

// Local synthetic preview of the clinician portal, used for thesis appendix
// screenshots. It serves the unchanged landing/ pages and API handlers.
// Supabase (authentication and PostgREST) and Google Sheets are replaced by
// in-memory stand-ins; every other outbound request is refused, so nothing can
// reach Twilio, WhatsApp, Gemini, Supabase or Google.
//
// The displayed record is not hand-written: the server starts from the
// adaptation-benchmark seed and then runs the application's own signed inbound
// webhook, reply interpretation, frequency worker (apply mode) and delivery
// preparation, exactly as benchmark case `frequency-1` does. Server time is
// frozen at the benchmark clock (2026-10-02T00:00:00Z) so the record is
// reproducible.
//
//   node scripts/local-preview/server.js [--out output/DIR]   (port 8790, or PREVIEW_PORT)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "../..");
const LANDING = path.join(ROOT, "landing");
const PORT = Number(process.env.PREVIEW_PORT || 8790);
const BASE = `http://127.0.0.1:${PORT}`;
const SESSION_TOKEN = "local-preview-session";
const DOCTOR = { auth_user_id: "local-preview-doctor", email: "clinician@preview.invalid", display_name: "Synthetic clinician",
  role: "doctor", doctor_id: "doc-test", status: "active" };

// Configuration is set before any application module reads it. Known
// credentials are removed so a misconfigured shell cannot leak them.
for (const name of ["GEMINI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_SHEETS_SPREADSHEET_ID", "TWILIO_ACCOUNT_SID",
  "TWILIO_API_KEY", "TWILIO_API_SECRET", "YOUTUBE_API_KEY", "N8N_API_KEY"]) delete process.env[name];
Object.assign(process.env, {
  SUPABASE_URL: `${BASE}/supabase`, SUPABASE_ANON_KEY: "local-preview-anon", SUPABASE_SERVICE_ROLE_KEY: "local-preview-service",
  ADAPTIVE_MEDIA_ENABLED: "true", ADAPTIVE_SCHEDULE_APPLY_ENABLED: "true", N8N_PROXY_SECRET: "local-preview-worker",
  TWILIO_AUTH_TOKEN: "local-preview-twilio", PUBLIC_APP_URL: BASE
});

const { fixture } = require("../../landing/tests/sheets-fixture");
const { database, clone } = require("../adaptation-benchmark/local-store");
const { makeSeed, NOW } = require("../adaptation-benchmark/engine");
const store = require("../../landing/api/_lib/adaptive-store");
const { processInteraction } = require("../../landing/api/_lib/adaptive-service");
const handlers = require("../../landing/api/_lib/adaptive-handlers");
const inbound = require("../../landing/api/whatsapp-inbound");
const { expectedSignature } = require("../../landing/api/_lib/twilio");

// Frozen server clock (the browser keeps its own clock).
const RealDate = global.Date;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return RealDate.parse(NOW); }
};

const seed = makeSeed({});
const sheetsFixture = fixture(seed.sheets);
const db = database(Object.assign({}, seed.db, { profiles: [DOCTOR] }));

function json(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

// In-memory Supabase: authentication for the single synthetic clinician and the
// benchmark PostgREST stand-in for every table.
async function supabase(url, options = {}) {
  const pathname = url.pathname.replace(/^\/supabase/, "");
  const authorization = String((options.headers && (options.headers.authorization || options.headers.Authorization)) || "");
  if (pathname === "/auth/v1/user") {
    return authorization === `Bearer ${SESSION_TOKEN}` ? json(200, { id: DOCTOR.auth_user_id, email: DOCTOR.email }) : json(401, { msg: "Invalid session" });
  }
  if (pathname === "/auth/v1/token") {
    return json(200, { access_token: SESSION_TOKEN, refresh_token: "local-preview-refresh", token_type: "bearer", expires_in: 3600,
      user: { id: DOCTOR.auth_user_id, email: DOCTOR.email } });
  }
  if (pathname.startsWith("/rest/v1/")) return db.fetch(`https://benchmark.invalid${pathname}${url.search}`, options);
  return json(404, { msg: "Not available in the local preview" });
}

const refused = [];
global.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  if (url.origin === BASE && url.pathname.startsWith("/supabase/")) return supabase(url, options);
  if (url.origin === "https://benchmark.invalid") return db.fetch(String(input), options);
  refused.push(`${options.method || "GET"} ${url.origin}${url.pathname}`);
  throw new Error(`Local preview refused outbound request to ${url.host}`);
};

function recorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function runWorker(fn, body) {
  const res = recorder();
  await fn({ method: "POST", headers: { "x-n8n-proxy-secret": process.env.N8N_PROXY_SECRET, host: `127.0.0.1:${PORT}` }, body }, res);
  return { status: res.statusCode, body: JSON.parse(res.body || "{}") };
}

async function sendInbound(text, sid) {
  const fields = { MessageSid: sid, From: "whatsapp:+61400000000", Body: text, OriginalRepliedMessageSid: "SM" + "a".repeat(32), NumMedia: "0" };
  const url = `${BASE}/api/whatsapp-inbound`;
  const req = { method: "POST", url: "/api/whatsapp-inbound", headers: { host: `127.0.0.1:${PORT}`, "x-forwarded-proto": "http",
    "x-twilio-signature": expectedSignature(process.env.TWILIO_AUTH_TOKEN, url, fields), "content-type": "application/x-www-form-urlencoded" }, body: fields };
  const res = recorder();
  await inbound(req, res);
  return { status: res.statusCode, body: res.body };
}

// The application's own pipeline, applied to the synthetic seed.
async function seedRecord() {
  const steps = [];
  steps.push({ step: "signed inbound reply \"Send fewer messages\"", result: await sendInbound("Send fewer messages", "SM" + crypto.createHash("md5").update("local-preview-1").digest("hex")) });
  const pending = await store.call("pendingInteraction");
  const decision = pending ? await processInteraction(pending) : null;
  steps.push({ step: "reply interpretation (rules interpreter; no Gemini key)", result: decision && { decision_id: decision.decision_id, outcome: decision.outcome, rule: decision.rule_applied, interpretation: decision.interpretation } });
  steps.push({ step: "frequency worker, apply mode", result: await runWorker(handlers.frequencyWorker, { user_id: "synthetic-1", now: NOW }) });
  const next = sheetsFixture.tables.nudges.rows.filter(row => row.nudge_id !== "history" && !row.sent_at && row.status === "approved")
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`))[0];
  steps.push({ step: "delivery preparation for the next occurrence (reservation only, nothing sent)",
    result: next ? await runWorker(handlers.prepareDelivery, { nudge_id: next.nudge_id }) : { status: 404 } });
  return steps;
}

const rewrites = JSON.parse(fs.readFileSync(path.join(LANDING, "vercel.json"), "utf8")).rewrites;
function rewrite(pathname, search) {
  for (const rule of rewrites) {
    const pattern = new RegExp("^" + rule.source.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    const match = pathname.match(pattern);
    if (match) {
      const target = rule.destination.replace(/:(\w+)/g, (_, name) => encodeURIComponent(match.groups[name]));
      const [targetPath, targetQuery] = target.split("?");
      const params = new URLSearchParams(search);
      for (const [key, value] of new URLSearchParams(targetQuery || "")) params.set(key, value);
      return { pathname: targetPath, search: params.toString() ? `?${params}` : "" };
    }
  }
  return { pathname, search };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function handle(req, res) {
  const url = new URL(req.url, BASE);
  if (url.pathname.startsWith("/supabase/")) {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const response = await supabase(url, { method: req.method, headers: req.headers, body: raw || undefined });
    res.writeHead(response.status, { "content-type": "application/json" });
    return res.end(await response.text());
  }
  if (url.pathname.startsWith("/api/")) {
    const target = rewrite(url.pathname, url.search);
    const file = path.join(LANDING, `${target.pathname}.js`);
    if (!file.startsWith(path.join(LANDING, "api")) || !fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
    req.url = `${target.pathname}${target.search}`;
    res.setHeader("Cache-Control", "no-store");
    return require(file)(req, res);
  }
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(LANDING, relative);
  if (!file.startsWith(LANDING + path.sep) || relative.startsWith("api/") || relative.startsWith("tests/") || relative.startsWith("node_modules/") ||
      !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  return fs.createReadStream(file).pipe(res);
}

async function main() {
  const steps = await seedRecord();
  const args = process.argv.slice(2);
  if (args.includes("--out")) {
    const out = path.resolve(ROOT, args[args.indexOf("--out") + 1]);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, "preview-seed-trace.json"), `${JSON.stringify({ clock: NOW, steps, refused_outbound: refused,
      stores_after_seeding: { sheets: clone(sheetsFixture.tables), database: clone(db.tables) } }, null, 2)}\n`);
  }
  http.createServer((req, res) => handle(req, res).catch(error => {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error.message) }));
  })).listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`Local synthetic preview on ${BASE}/monitor.html (seed steps: ${steps.map(s => s.result && s.result.status || "ok").join(", ")})\n`);
  });
}

main().catch(error => { console.error(error); process.exitCode = 1; });
