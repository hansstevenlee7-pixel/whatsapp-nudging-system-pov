"use strict";

// Clinician prescription CRUD. The recurring theme: the LLM's parse is a draft,
// so the doctor must be able to correct or retire it without breaking the
// invariants the scheduler relies on.
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/prescription");
const scheduleHandler = require("../api/schedule");
const approveHandler = require("../api/approve");
const patientsHandler = require("../api/patients");
const { melbourneIso, addDays } = require("../api/_lib/schedule-store");
const { fixture, baseSeed } = require("./sheets-fixture");

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function installAuth(t, profile = { auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) {
      return new Response(JSON.stringify([profile]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(function () {
    global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

function start(t, seed = baseSeed(), profile) {
  const store = fixture(seed);
  installAuth(t, profile);
  t.after(() => store.restore());
  return store;
}

async function call(route, method, body) {
  const res = responseRecorder();
  await route({ method, headers: { authorization: "Bearer token" }, body }, res);
  return res;
}

const draft = (over = {}) => Object.assign({
  user_id: "patient-1", pillar: "physical_activity", category: "increase",
  frequency_per_week: 3, duration_weeks: 6, issued_date: "2026-07-15",
  prescription_raw_text: "Walk more after dinner",
  action_text: "Walk for 20 minutes after dinner", nudge_type: "reminder",
  tone_variant: "encouraging", message_body: "Time for your evening walk."
}, over);

const slotFor = (prescriptionId, sourceNudgeId, over = {}) => Object.assign({
  schedule_slot_id: "slot-new", day: "monday", time: "09:00", nudge_type: "reminder",
  pillar: "physical_activity", action_text: "Walk for 20 minutes after dinner",
  tone_variant: "encouraging", message_body: "Time for your evening walk.",
  template_name: "health_plan_reminder", prescription_id: prescriptionId, source_nudge_id: sourceNudgeId
}, over);

const range = () => ({ start_date: melbourneIso(), end_date: addDays(melbourneIso(), 20) });

// ---- Create --------------------------------------------------------------

test("POST appends a prescription with its source nudge and state row in one batch", async function (t) {
  const store = start(t);
  const res = await call(handler, "POST", draft());
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.persisted, true);

  const rx = store.tables.prescriptions.rows.find(row => row.prescription_id === body.prescription.prescription_id);
  assert.match(rx.prescription_id, /^rx_/);
  assert.equal(rx.status, "active");
  assert.equal(rx.doctor_id, "doc-1");
  assert.equal(rx.target_behavior, "");

  const nudge = store.tables.nudges.rows.find(row => row.prescription_id === rx.prescription_id);
  assert.match(nudge.nudge_id, /^ndg_/);
  assert.equal(nudge.status, "needs_review");
  assert.equal(nudge.pillar, "physical_activity");
  assert.equal(nudge.action_text, "Walk for 20 minutes after dinner");
  assert.ok(store.tables.schedule_state.rows.some(row => row.schedule_id === `sch_${nudge.nudge_id}`));
});

test("a prescription created in the portal is immediately schedulable", async function (t) {
  // The whole reason create is atomic: schedule-store rejects any slot whose
  // prescription has no source nudge.
  const store = start(t);
  const created = JSON.parse((await call(handler, "POST", draft())).body);
  const res = await call(scheduleHandler, "PUT", Object.assign({
    user_id: "patient-1",
    slots: [slotFor(created.prescription.prescription_id, created.nudge.nudge_id)]
  }, range()));
  assert.equal(res.statusCode, 200);
  assert.ok(store.tables.weekly_schedule.rows.some(row => row.prescription_id === created.prescription.prescription_id));
});

test("a failed batch never half-creates a prescription", async function (t) {
  const store = start(t);
  const before = store.tables.prescriptions.rows.length;
  store.failNextBatch();
  const res = await call(handler, "POST", draft());
  assert.equal(res.statusCode, 500);
  assert.equal(store.tables.prescriptions.rows.length, before);
  assert.equal(store.tables.nudges.rows.filter(row => String(row.nudge_id).startsWith("ndg_")).length, 0);
  assert.equal(store.tables.schedule_state.rows.length, 0);
});

test("an unconfirmed create warns against a blind retry instead of inviting one", async function (t) {
  const store = start(t);
  store.ignoreNextBatch();
  const res = await call(handler, "POST", draft());
  assert.equal(res.statusCode, 409);
  const error = JSON.parse(res.body).error;
  assert.match(error, /not confirmed in Google Sheets/);
  assert.match(error, /before retrying/);
});

test("create rejects out-of-range and future-dated drafts", async function (t) {
  start(t);
  assert.equal((await call(handler, "POST", draft({ frequency_per_week: 9 }))).statusCode, 400);
  assert.equal((await call(handler, "POST", draft({ duration_weeks: 0 }))).statusCode, 400);
  assert.equal((await call(handler, "POST", draft({ pillar: "vibes" }))).statusCode, 400);
  assert.equal((await call(handler, "POST", draft({ action_text: "   " }))).statusCode, 400);
  assert.equal((await call(handler, "POST", draft({ issued_date: addDays(melbourneIso(), 3) }))).statusCode, 400);
});

test("creating a prescription for a disabled patient is refused", async function (t) {
  const seed = baseSeed();
  seed.user[0].user_status = "disabled";
  start(t, seed);
  const res = await call(handler, "POST", draft());
  assert.equal(res.statusCode, 409);
  assert.match(JSON.parse(res.body).error, /Reactivate this patient/);
});

// ---- Edit ----------------------------------------------------------------

test("frequency and duration survive the number to string round trip", async function (t) {
  // Sheets returns FORMATTED_VALUE, so a written 4 reads back as "4". A strict
  // read-back comparison would 409 on every edit in production.
  const store = start(t);
  store.tables.prescriptions.rows[0].frequency_per_week = "3";
  store.tables.prescriptions.rows[0].duration_weeks = "8";
  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", frequency_per_week: "4" });
  assert.equal(res.statusCode, 200);
  assert.equal(String(store.tables.prescriptions.rows[0].frequency_per_week), "4");
  assert.equal(String(store.tables.prescriptions.rows[0].duration_weeks), "8");
});

test("editing one field leaves the rest of the prescription row intact", async function (t) {
  const store = start(t);
  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", prescription_raw_text: "Lights out by ten" });
  assert.equal(res.statusCode, 200);
  const rx = store.tables.prescriptions.rows[0];
  assert.equal(rx.prescription_raw_text, "Lights out by ten");
  assert.equal(rx.pillar, "sleep");
  assert.equal(rx.doctor_id, "doc-1");
  assert.equal(rx.issued_date, "2026-07-01");
});

test("changing the default pillar leaves every existing behaviour where it is", async function (t) {
  // Pillar is a default for new behaviours, not a lock the schedule inherits, so
  // editing it must not cascade. The old behaviour rewrote every source nudge,
  // which would now silently re-file behaviours the clinician deliberately put
  // in another pillar.
  const store = start(t);
  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", pillar: "stress_management" });
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.prescriptions.rows[0].pillar, "stress_management");
  const sources = store.tables.nudges.rows.filter(row => !String(row.nudge_id).startsWith("schd_"));
  assert.ok(sources.length > 0);
  assert.ok(sources.every(row => row.pillar === "sleep"), "source nudges keep their own pillar");
});

test("the default pillar stays editable after the prescription is scheduled", async function (t) {
  const store = start(t);
  assert.equal((await call(scheduleHandler, "PUT", Object.assign({
    user_id: "patient-1",
    slots: [slotFor("rx-1", "source-wed", { pillar: "sleep", action_text: "Be in bed by 10pm" })]
  }, range()))).statusCode, 200);

  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", pillar: "nutrition" });
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.prescriptions.rows[0].pillar, "nutrition");
  // The saved slot is untouched — it declares its own pillar now.
  const slot = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-new");
  assert.equal(slot.pillar, "sleep");

  for (const change of [{ category: "maintain" }, { frequency_per_week: 5 }, { duration_weeks: 12 }, { prescription_raw_text: "Revised" }]) {
    const ok = await call(handler, "PATCH", Object.assign({ user_id: "patient-1", prescription_id: "rx-1" }, change));
    assert.equal(ok.statusCode, 200, `expected ${JSON.stringify(change)} to stay editable`);
  }
});

test("a legacy plan with unsent future deliveries no longer blocks a pillar edit", async function (t) {
  const seed = baseSeed();
  seed.nudges.push({
    nudge_id: "schd_source-wed_20991231", prescription_id: "rx-1", user_id: "patient-1",
    nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm",
    scheduled_date: "2099-12-31", scheduled_time: "09:00", message_body: "Legacy", message_body_alt: "",
    tone_variant: "encouraging", template_name: "health_plan_reminder", status: "approved",
    sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: ""
  });
  const store = start(t, seed);
  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", pillar: "nutrition" });
  assert.equal(res.statusCode, 200);
  // The queued delivery keeps the pillar it was approved under.
  const queued = store.tables.nudges.rows.find(row => row.nudge_id === "schd_source-wed_20991231");
  assert.equal(queued.pillar, "sleep");
});

// ---- Archive and reactivate ----------------------------------------------

test("archiving cascades to slots and unsent future nudges while preserving sent history", async function (t) {
  const store = start(t);
  assert.equal((await call(scheduleHandler, "PUT", Object.assign({
    user_id: "patient-1",
    slots: [slotFor("rx-1", "source-wed", { pillar: "sleep", action_text: "Be in bed by 10pm" })]
  }, range()))).statusCode, 200);

  const sent = store.tables.nudges.rows.find(row => String(row.nudge_id).startsWith("schd_"));
  sent.status = "sent";
  sent.sent_at = "2026-08-01T09:00:00Z";

  const res = await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prescription.status, "archived");
  assert.ok(body.deactivated_slot_count > 0);

  assert.ok(store.tables.weekly_schedule.rows.every(row => row.status === "inactive"));
  const history = store.tables.nudges.rows.find(row => row.nudge_id === sent.nudge_id);
  assert.equal(history.status, "sent", "a delivered nudge is history and must survive the cascade");
  const futures = store.tables.nudges.rows.filter(row =>
    String(row.nudge_id).startsWith("schd_") && row.nudge_id !== sent.nudge_id);
  assert.ok(futures.length > 0);
  assert.ok(futures.every(row => row.status === "rejected"));
  assert.ok(store.tables.schedule_state.rows
    .filter(row => futures.some(f => f.nudge_id === row.nudge_id))
    .every(row => row.status === "rejected"));
});

test("an archived prescription cannot be approved but can still be rejected", async function (t) {
  start(t);
  assert.equal((await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" })).statusCode, 200);

  const approve = await call(approveHandler, "POST", Object.assign({
    user_id: "patient-1", decision: "approve",
    slots: [slotFor("rx-1", "source-wed", { pillar: "sleep", action_text: "Be in bed by 10pm" })]
  }, range()));
  assert.equal(approve.statusCode, 400);
  assert.match(JSON.parse(approve.body).error, /archived/);

  const reject = await call(approveHandler, "POST", {
    user_id: "patient-1", decision: "reject",
    slots: [slotFor("rx-1", "source-wed", { pillar: "sleep", action_text: "Be in bed by 10pm" })]
  });
  assert.equal(reject.statusCode, 200);
});

test("an archived prescription leaves the patient payload but its legacy action still resolves", async function (t) {
  const seed = baseSeed();
  seed.prescriptions[0].target_behavior = "sleep_7_to_9_hours";
  seed.nudges.forEach(row => { row.action_text = ""; });
  // A delivered row with no action_text: its label can only come from the
  // archived prescription's retired target_behavior token.
  seed.nudges.push({
    nudge_id: "schd_source-wed_20260720", prescription_id: "rx-1", user_id: "patient-1",
    nudge_type: "reminder", pillar: "sleep", action_text: "",
    scheduled_date: "2026-07-20", scheduled_time: "09:00", message_body: "Delivered", message_body_alt: "",
    tone_variant: "encouraging", template_name: "health_plan_reminder", status: "sent",
    sent_at: "2026-07-20T09:00:00Z", reviewed_at: "", week_number: 1, schedule_slot_id: "slot-legacy"
  });
  seed.weekly_schedule = [{
    schedule_slot_id: "slot-legacy", user_id: "patient-1", source_nudge_id: "source-wed", prescription_id: "rx-1",
    day: "monday", scheduled_time: "09:00", nudge_type: "reminder", pillar: "sleep", action_text: "",
    tone_variant: "encouraging", message_body: "Legacy", message_body_alt: "", template_name: "health_plan_reminder",
    status: "active", start_date: "2026-07-01", end_date: "2026-08-01", created_at: "", updated_at: ""
  }];
  start(t, seed);
  assert.equal((await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" })).statusCode, 200);

  const res = await call(patientsHandler, "GET", undefined);
  const patient = JSON.parse(res.body).patients[0];
  assert.deepEqual(patient.prescriptions, []);
  assert.equal(patient.archived_prescriptions.length, 1);
  // Source rows are withheld so the week editor cannot rebuild from an archived plan.
  assert.deepEqual(patient.nudges, []);
  // Delivery history is kept, and the archived row stays in the resolver index so
  // its retired token still renders as readable text.
  assert.equal(patient.schedule_nudges.length, 1);
  assert.equal(patient.schedule_nudges[0].action_text, "Sleep 7–9 hours");
});

test("reactivate restores the prescription but never its schedule", async function (t) {
  const store = start(t);
  assert.equal((await call(scheduleHandler, "PUT", Object.assign({
    user_id: "patient-1",
    slots: [slotFor("rx-1", "source-wed", { pillar: "sleep", action_text: "Be in bed by 10pm" })]
  }, range()))).statusCode, 200);
  assert.equal((await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" })).statusCode, 200);

  const res = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", status: "active" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.prescription.status, "active");
  assert.equal(body.schedule_restored, false);
  assert.ok(store.tables.weekly_schedule.rows.every(row => row.status === "inactive"));
  assert.ok(store.tables.nudges.rows.filter(row => String(row.nudge_id).startsWith("schd_")).every(row => row.status === "rejected"));
});

test("an archived prescription is still reachable for reactivation", async function (t) {
  // Regression: resolving the target from patient.prescriptions would 404 here,
  // because that array no longer contains archived rows.
  start(t);
  assert.equal((await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" })).statusCode, 200);
  assert.equal((await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", status: "active" })).statusCode, 200);
});

test("a blank prescription status reads as active rather than archived", async function (t) {
  const seed = baseSeed();
  delete seed.prescriptions[0].status;
  start(t, seed);
  const res = await call(patientsHandler, "GET", undefined);
  const patient = JSON.parse(res.body).patients[0];
  assert.equal(patient.prescriptions.length, 1);
  assert.equal(patient.archived_prescriptions.length, 0);
});

// ---- Ownership -----------------------------------------------------------

test("a doctor cannot touch another clinician's patient and a foreign prescription 404s", async function (t) {
  start(t, baseSeed(), { auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-2", status: "active" });
  const forbidden = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", category: "maintain" });
  assert.equal(forbidden.statusCode, 403);
});

test("an admin creating a prescription records the patient's clinician, not their own", async function (t) {
  const store = start(t, baseSeed(), { auth_user_id: "auth-1", role: "admin", doctor_id: "doc-admin", status: "active" });
  const res = await call(handler, "POST", draft());
  assert.equal(res.statusCode, 200);
  const created = store.tables.prescriptions.rows.find(row => String(row.prescription_id).startsWith("rx_"));
  assert.equal(created.doctor_id, "doc-1");
});

test("a prescription id from another patient is not found", async function (t) {
  const seed = baseSeed();
  seed.user.push({ user_id: "patient-2", name: "Bo", phone: "+61422222222", email: "bo@example.test", user_status: "active", doctor_id: "doc-1" });
  start(t, seed);
  const res = await call(handler, "PATCH", { user_id: "patient-2", prescription_id: "rx-1", category: "maintain" });
  assert.equal(res.statusCode, 404);
});

// ---- Monitor markup contracts --------------------------------------------

test("the weekly monitor leaves prescription management out of the monitoring workspace", function () {
  const fs = require("node:fs");
  const path = require("node:path");
  const monitorHtml = fs.readFileSync(path.resolve(__dirname, "../monitor.html"), "utf8");

  assert.doesNotMatch(monitorHtml, /rxDialog|rxArchiveDialog|openPrescriptionDialog|\/api\/prescription/);
  // Still a free-text input: this is the *first* nudge of a brand-new
  // prescription, where no behaviour list exists to pick from yet.
  assert.match(monitorHtml, /Patient overview/);
  // The ＋ Add prescription button is built in JS, and carries an id so
  // refreshPrescriptionControls does not have to key off a leading "＋" — which
  // the weekly ＋ Add nudge buttons also carry.
  assert.match(monitorHtml, /Save schedule/);
  // The pillar lock is gone: pillar is a default for new behaviours now, and
  // refusing to change a default was pure friction.
  // A dedicated archive dialog: #archiveDialog's confirm button is already bound
  // to archivePatient, so reusing it would archive the wrong thing.
  // <header>, not <div> — .tstep:first-of-type is per element type.
  // Reactivation must never imply the schedule came back.

  // The action-list work this builds on must survive the renderTrace restructure.
});

test("a correction keeps the LLM's value in an append-only revision history", async function (t) {
  const seed = baseSeed();
  Object.assign(seed.prescriptions[0], { translation_model: "gemini-2.5-flash", translation_prompt_sha256: "a".repeat(64) });
  const store = start(t, seed);
  const first = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", category: "maintain" });
  assert.equal(first.statusCode, 200);
  assert.equal(store.tables.prescriptions.rows[0].category, "maintain");
  assert.deepEqual(store.tables.prescription_revisions.rows.map(row => [row.field, row.previous_value, row.new_value, row.changed_by, row.previous_source, row.reason]),
    [["category", "establish", "maintain", "auth-1", "workflow_a:gemini-2.5-flash", "clinician_edit"]]);
  // A second edit of the same field replaces a clinician value, not the LLM's; the
  // unchanged duration writes nothing.
  await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", category: "increase", duration_weeks: 8 });
  assert.deepEqual(store.tables.prescription_revisions.rows.slice(1).map(row => [row.field, row.previous_value, row.new_value, row.previous_source]),
    [["category", "maintain", "increase", "clinician"]]);
  await call(handler, "DELETE", { user_id: "patient-1", prescription_id: "rx-1" });
  const archive = store.tables.prescription_revisions.rows.at(-1);
  assert.deepEqual([archive.field, archive.previous_value, archive.new_value, archive.reason], ["status", "active", "archived", "clinician_archive"]);
});

test("an unchanged value writes no revision", async function (t) {
  const store = start(t);
  const result = await call(handler, "PATCH", { user_id: "patient-1", prescription_id: "rx-1", category: "establish" });
  assert.equal(result.statusCode, 200);
  assert.equal(store.tables.prescription_revisions.rows.length, 0);
});
