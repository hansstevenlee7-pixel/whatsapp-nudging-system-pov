"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { bearerToken, canAccessPatient } = require("../api/_lib/auth");
const { filterPatients, assertPatientAccess, resolveDoctorId, normalizePhone, duplicatePhone } = require("../api/_lib/policy");
const { hydratePatient } = require("../review-state");

test("missing bearer token is rejected", () => {
  assert.throws(() => bearerToken({ headers: {} }), error => error.status === 401);
});

test("doctor sees only owned patients while admin sees all", () => {
  const patients = [{ user_id: "p1", doctor_id: "d1" }, { user_id: "p2", doctor_id: "d2" }, { user_id: "p3", doctor_id: "" }];
  assert.deepEqual(filterPatients({ role: "doctor", doctor_id: "d1" }, patients).map(p => p.user_id), ["p1"]);
  assert.equal(filterPatients({ role: "admin", doctor_id: "d9" }, patients).length, 3);
  assert.equal(canAccessPatient({ role: "doctor", doctor_id: "d1" }, patients[1]), false);
});

test("cross-doctor approval is forbidden", () => {
  assert.throws(
    () => assertPatientAccess({ role: "doctor", doctor_id: "d1" }, [{ user_id: "p2", doctor_id: "d2" }], "p2"),
    error => error.status === 403
  );
});

test("disabled remains an explicit reversible patient state", () => {
  const patient = assertPatientAccess(
    { role: "doctor", doctor_id: "d1" },
    [{ user_id: "p1", doctor_id: "d1", user_status: "disabled" }],
    "p1"
  );
  assert.equal(patient.user_status, "disabled");
});

test("client cannot forge doctor identity", () => {
  const doctor = { role: "doctor", doctor_id: "trusted" };
  assert.equal(resolveDoctorId(doctor, "forged", []), "trusted");
  const admin = { role: "admin", doctor_id: "admin-doc" };
  assert.equal(resolveDoctorId(admin, "target", [{ doctor_id: "target", status: "active" }]), "target");
  assert.throws(() => resolveDoctorId(admin, "disabled", [{ doctor_id: "disabled", status: "disabled" }]), error => error.status === 400);
});

test("duplicate phone numbers are rejected while an existing patient can retain their own number", () => {
  const patients = [{ user_id: "p1", phone: "+61411111111" }, { user_id: "p2", phone: "+61422222222" }];
  assert.equal(duplicatePhone(patients, "+61411111111").user_id, "p1");
  assert.equal(duplicatePhone(patients, "+61411111111", "p1"), null);
  assert.equal(normalizePhone(" +61411111111 "), "+61411111111");
  assert.throws(() => normalizePhone("0411 111 111"), error => error.status === 400);
});

test("intake keeps its proxy gate while Monitoring APIs use the server-only Sheets client", () => {
  const root = path.resolve(__dirname, "../..");
  const intake = JSON.parse(fs.readFileSync(path.join(root, "workflows/workflow_a_intake.json"), "utf8"));
  assert.equal(intake.connections["Intake Webhook"].main[0][0].node, "Authorize Proxy");
  assert.equal(intake.connections["Call Gemini Vision"].main[0][0].node, "Normalize Known Enum Drift");
  assert.equal(intake.connections["Normalize Known Enum Drift"].main[0][0].node, "Validation Gate");
  assert.match(intake.nodes.find(item => item.name === "Authorize Proxy").parameters.jsCode, /N8N_PROXY_SECRET/);
  const apiRoot = path.join(root, "landing/api");
  for (const file of ["patients.js", "patient.js", "prescription.js", "approve.js", "schedule.js", "admin/users.js"]) {
    const source = fs.readFileSync(path.join(apiRoot, file), "utf8");
    assert.doesNotMatch(source, /_lib\/n8n|webhook\//);
  }
  const sheets = fs.readFileSync(path.join(apiRoot, "_lib/google-sheets.js"), "utf8");
  assert.match(sheets, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
  assert.match(sheets, /GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(sheets, /GOOGLE_SHEETS_SPREADSHEET_ID/);
});

test("intake normalizes only known Gemini category drift before strict validation", () => {
  const workflow = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../workflows/workflow_a_intake.json"), "utf8"));
  const node = workflow.nodes.find(item => item.name === "Normalize Known Enum Drift");
  assert.match(node.parameters.jsCode, /smoking_cessation: 'avoid'/);
  assert.match(node.parameters.jsCode, /alcohol_reduction: 'reduce'/);
  assert.match(node.parameters.jsCode, /Leave malformed output untouched/);
});

test("Twilio delivery is scheduled in Melbourne and sends only generated rows in the current window", () => {
  const workflow = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../workflows/workflow_b_delivery_twilio.json"), "utf8"));
  const trigger = workflow.nodes.find(item => item.name === "Melbourne Schedule Trigger");
  const dedupe = workflow.nodes.find(item => item.name === "Deduplicate Generated Schedule");
  const due = workflow.nodes.find(item => item.name === "Prepare Due Nudges");
  assert.equal(workflow.active, true);
  assert.equal(workflow.settings.timezone, "Australia/Melbourne");
  assert.deepEqual(trigger.parameters.rule.interval[0], { field: "minutes", minutesInterval: 5 });
  assert.equal(workflow.connections["Read Nudges"].main[0][0].node, "Deduplicate Generated Schedule");
  assert.match(dedupe.parameters.jsCode, /most recently reviewed approved row/);
  assert.match(due.parameters.jsCode, /startsWith\('schd_'\)/);
  assert.match(due.parameters.jsCode, /ageMinutes >= 5/);
});

test("canonical weekly schedule ignores sent history and inactive deleted weekdays", () => {
  const source = { nudge_id: "ndg-source", prescription_id: "rx-1", status: "approved", scheduled_date: "2026-07-28", scheduled_time: "09:00", message_body: "Original" };
  const generated = [
    { nudge_id: "schd_ndg-source_20260728_0", prescription_id: "rx-1", status: "sent", scheduled_date: "2026-07-28", scheduled_time: "19:20", reviewed_at: "2026-07-28T10:00:00Z", message_body: "Edited" },
    { nudge_id: "schd_ndg-source_20260804_0", prescription_id: "rx-1", status: "approved", scheduled_date: "2026-08-04", scheduled_time: "19:20", reviewed_at: "2026-07-28T10:00:00Z", message_body: "Edited" }
  ];
  const weekly = [
    { schedule_slot_id: "slot-tuesday", user_id: "p1", source_nudge_id: "ndg-source", day: "tuesday", scheduled_time: "10:30", message_body: "Current", status: "active", start_date: "2026-07-28", end_date: "2026-08-28" },
    { schedule_slot_id: "slot-monday", user_id: "p1", source_nudge_id: "ndg-source", day: "monday", scheduled_time: "19:20", message_body: "Deleted", status: "inactive", start_date: "2026-07-28", end_date: "2026-08-28" }
  ];
  const patient = hydratePatient({ user_id: "p1", nudges: [source], schedule_nudges: generated, weekly_schedule: weekly });
  assert.equal(patient.nudges.length, 1);
  assert.equal(patient.weekly_schedule.length, 1);
  assert.equal(patient.weekly_schedule[0].day, "tuesday");
  assert.equal(patient.weekly_schedule[0].message_body, "Current");
  assert.equal(patient.legacy_schedule.length, 0);
  assert.equal(patient.schedule_start_date, "2026-07-28");
  assert.equal(patient.schedule_end_date, "2026-08-28");
});

test("a canonical tombstone prevents legacy delivery rows from recreating a deleted weekday", () => {
  const patient = hydratePatient({
    user_id: "p1", has_canonical_schedule: true,
    nudges: [{ nudge_id: "source-sunday", status: "approved", scheduled_date: "2026-08-02", scheduled_time: "09:00" }],
    schedule_nudges: [{ nudge_id: "schd_source-sunday_20260802", status: "sent", scheduled_date: "2026-08-02", scheduled_time: "09:00" }],
    weekly_schedule: []
  });
  assert.equal(patient.has_canonical_schedule, true);
  assert.deepEqual(patient.weekly_schedule, []);
  assert.deepEqual(patient.legacy_schedule, []);
});

test("monitor saves approved edits without reloading delivery history", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../monitor.html"), "utf8");
  assert.match(text, /Save schedule changes/);
  assert.match(text, /Auth\.api\(endpoint/);
  assert.match(text, /endpoint = approved \? "\/api\/schedule"/);
  assert.doesNotMatch(text, /Auth\.api\("\/api\/patients"\)\.then\(function \(data\)/);
  assert.match(text, /beforeunload/);
});

test("protected pages do not expose the n8n URL", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of ["input.html", "monitor.html", "auth.js"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(text, /ngrok|N8N_BASE|\/webhook\//);
  }
});

test("intake submits directly and handles duplicate phones without downloading JSON", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../input.html"), "utf8");
  assert.doesNotMatch(text, /createObjectURL|\.download\s*=|Copy JSON|Downloaded/);
  assert.match(text, /id="duplicateModal"/);
  assert.match(text, /Use a different number/);
  assert.match(text, /Open patient in Monitor/);
  assert.match(text, /err\.body\.code === "duplicate_phone"/);
  assert.match(text, /monitor\.html\?user_id=/);
});

test("monitor mutations use the verified canonical response without an immediate collection reload", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../monitor.html"), "utf8");
  const mutation = text.match(/function mutatePatient[\s\S]*?\n    function savePatient/)[0];
  assert.match(mutation, /out\.persisted/);
  assert.match(mutation, /out && out\.patient/);
  assert.doesNotMatch(mutation, /Auth\.api\("\/api\/patients"/);
  assert.match(text, /<option value="active" selected>Active patients<\/option>/);
});

test("all protected pages enforce the authentication guard", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of ["input.html", "monitor.html", "admin.html"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(text, /<html class="protected"/);
    assert.match(text, /Auth\.guard\(/);
  }
});

test("inline browser scripts parse", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of ["index.html", "login.html", "forgot-password.html", "set-password.html", "input.html", "monitor.html", "admin.html"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    const scripts = [...text.matchAll(/^\s*<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gim)].map(match => match[1]).filter(Boolean);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script), `${file} contains invalid JavaScript`);
  }
});

test("landing page forwards Supabase invite and recovery fragments to password setup", () => {
  const text = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf8");
  assert.match(text, /type === "invite"/);
  assert.match(text, /type === "recovery"/);
  assert.match(text, /set-password\.html" \+ location\.search \+ location\.hash/);
});

test("the merged admin function routes each public path to its own operation", function () {
  // Vercel Hobby caps a deployment at 12 Serverless Functions, so /api/admin/user
  // and /api/admin/assign are rewritten onto /api/admin/users with an ?op= marker.
  // Dispatch cannot be on method alone — /assign and /users both take POST — so a
  // wrong or missing marker would silently run the wrong admin action.
  const root = path.resolve(__dirname, "../..");
  const config = JSON.parse(fs.readFileSync(path.join(root, "landing/vercel.json"), "utf8"));
  const rewrites = Object.fromEntries((config.rewrites || []).map(r => [r.source, r.destination]));
  assert.equal(rewrites["/api/admin/assign"], "/api/admin/users?op=assign");
  assert.equal(rewrites["/api/admin/user"], "/api/admin/users?op=user");

  // Under the cap, with headroom.
  const fnCount = fs.readdirSync(path.join(root, "landing/api"), { recursive: true })
    .filter(name => String(name).endsWith(".js") && !String(name).startsWith("_lib"));
  assert.ok(fnCount.length <= 12, `Hobby allows 12 Serverless Functions, found ${fnCount.length}`);

  // Each operation refuses the methods that belong to the others, which is what
  // proves the dispatch happened rather than falling through to the default.
  const handler = require("../api/admin/users");
  const call = async (url, method) => {
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(v) { this.body = v || ""; } };
    await handler({ method, url, headers: {}, body: {} }, res);
    return res.statusCode;
  };
  return Promise.all([
    call("/api/admin/users?op=user", "POST").then(code => assert.equal(code, 405, "the user op is PATCH-only")),
    call("/api/admin/users?op=assign", "PATCH").then(code => assert.equal(code, 405, "the assign op is POST-only")),
    call("/api/admin/users", "PATCH").then(code => assert.equal(code, 405, "the default op is GET/POST-only"))
  ]);
});
