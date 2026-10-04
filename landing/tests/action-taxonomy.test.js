"use strict";

// Dynamic action taxonomy: pillar × category stay locked enumerations, while the
// concrete Action is clinician-owned free text held per recurring weekly slot.
// These tests pin the boundary — what stays enumerated, what stays editable, and
// what neither the LLM nor a materialization pass may overwrite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const scheduleHandler = require("../api/schedule");
const approveHandler = require("../api/approve");
const patientsHandler = require("../api/patients");
const { buildPatients } = require("../api/_lib/clinical-data");
const { seedWeeklySchedule } = require("../../scripts/seed-weekly-schedule");
const { fixture, baseSeed } = require("./sheets-fixture");
const ReviewState = require("../review-state");

const projectRoot = path.resolve(__dirname, "../..");
const readJson = relative => JSON.parse(fs.readFileSync(path.join(projectRoot, relative), "utf8"));
const intake = readJson("workflows/workflow_a_intake.json");
const monitorHtml = fs.readFileSync(path.resolve(__dirname, "../monitor.html"), "utf8");

const ACTION = "Walk for 20 minutes after dinner — outdoors if it's dry";

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

function installAuth(t) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  const previousFetch = global.fetch;
  global.fetch = async function (url) {
    if (url === "https://supabase.test/auth/v1/user") return new Response(JSON.stringify({ id: "auth-1" }), { status: 200 });
    if (String(url).startsWith("https://supabase.test/rest/v1/profiles")) {
      return new Response(JSON.stringify([{ auth_user_id: "auth-1", role: "doctor", doctor_id: "doc-1", status: "active" }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  t.after(function () {
    global.fetch = previousFetch;
    names.forEach(name => { if (previous[name] == null) delete process.env[name]; else process.env[name] = previous[name]; });
  });
}

function slot(id, day, source, overrides = {}) {
  return Object.assign({
    schedule_slot_id: id, source_nudge_id: source, prescription_id: "rx-1", day, time: "09:00",
    nudge_type: "reminder", pillar: "sleep", action_text: ACTION, tone_variant: "encouraging",
    message_body: `${day} reminder`, message_body_alt: "", template_name: "health_plan_reminder"
  }, overrides);
}

async function save(slots, range = { start_date: "2099-08-01", end_date: "2099-08-31" }) {
  const res = responseRecorder();
  await scheduleHandler({ method: "PUT", headers: { authorization: "Bearer token" }, body: Object.assign({ user_id: "patient-1", slots }, range) }, res);
  return res;
}

function start(t, seed = baseSeed()) {
  installAuth(t);
  const store = fixture(seed);
  t.after(() => store.restore());
  return store;
}

function node(workflow, name) {
  const found = workflow.nodes.find(item => item.name === name);
  assert.ok(found, `Missing workflow node: ${name}`);
  return found;
}

function runCode(code, globals) {
  return Function(...Object.keys(globals), code)(...Object.values(globals));
}

function intakeGate(parsed, context) {
  const ctx = Object.assign({
    user: { user_id: "usr-1", name: "Ada", phone: "+61411111111", email: "ada@example.test" },
    questionnaire: { age: 40, gender: "female", activity_level: "sedentary", primary_goal: "sleep_improvement", preferred_nudge_time: "21:00", opt_in_whatsapp: true },
    prescription_input: { doctor_id: "doc-1", issued_date: "2026-08-01", prescription_raw_text: "Sleep earlier" }
  }, context);
  const code = node(intake, "Validation Gate").parameters.jsCode;
  const items = [{ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }] } }];
  return runCode(code, { items, $: () => ({ first: () => ({ json: ctx }) }), require })[0].json;
}

function intakePayload(overrides = {}) {
  return {
    prescriptions: [{ ref: "p1", pillar: "sleep", category: "establish", frequency_per_week: 2, duration_weeks: 8 }],
    nudges: [Object.assign({
      prescription_ref: "p1", pillar: "sleep", nudge_type: "reminder", action_text: "Be in bed by 10pm",
      scheduled_date: "2026-08-03", scheduled_time: "21:00", tone_variant: "encouraging",
      message_body: "Lights out soon.", message_body_alt: "Bedtime is at 10pm.", template_name: "health_plan_reminder"
    }, overrides)]
  };
}

// ---- Locked taxonomy vs free-text action --------------------------------

test("intake rejects an invalid pillar or category but accepts any sensible action wording", function () {
  assert.match(intakeGate(intakePayload({ pillar: "sleep_hygiene" })).errors.join(" "), /pillar: sleep_hygiene/);

  const badCategory = intakePayload();
  badCategory.prescriptions[0].category = "improve";
  assert.match(intakeGate(badCategory).errors.join(" "), /category: improve/);

  for (const action of ["Be in bed by 10pm", "Aim for 7–9 h of sleep (no screens after 21:30)", "Take a 15-min walk; then journal"]) {
    const passed = intakeGate(intakePayload({ action_text: action }));
    assert.equal(passed.validation_passed, true, `rejected: ${action}`);
    assert.equal(passed.nudges[0].action_text, action);
  }
});

test("intake rejects a blank or oversized action and stops writing target_behavior", function () {
  assert.match(intakeGate(intakePayload({ action_text: "   " })).errors.join(" "), /action_text is required/);
  assert.match(intakeGate(intakePayload({ action_text: "x".repeat(1025) })).errors.join(" "), /action_text is longer than 1024/);
  assert.equal(intakeGate(intakePayload()).prescriptions[0].target_behavior, "");
});

test("intake rejects a draft that names no prescription when more than one exists, and a prescription with no draft", function () {
  const two = intakePayload();
  two.prescriptions.push({ ref: "p2", pillar: "sleep", category: "maintain", frequency_per_week: 1, duration_weeks: 8 });
  two.nudges.push(Object.assign({}, two.nudges[0], { prescription_ref: "p2", scheduled_date: "2026-08-04" }));
  assert.equal(intakeGate(two).validation_passed, true);

  const unresolved = JSON.parse(JSON.stringify(two)); unresolved.nudges[1].prescription_ref = "p9";
  assert.match(intakeGate(unresolved).errors.join(" "), /unresolved prescription_ref: p9/);
  const missing = JSON.parse(JSON.stringify(two)); delete missing.nudges[1].prescription_ref;
  assert.match(intakeGate(missing).errors.join(" "), /unresolved prescription_ref/);
  const orphan = JSON.parse(JSON.stringify(two)); orphan.nudges.pop();
  assert.match(intakeGate(orphan).errors.join(" "), /rx\[1\] has no nudges/);

  // With a single prescription the draft can only belong to it.
  const single = intakePayload({ prescription_ref: undefined });
  assert.equal(intakeGate(single).validation_passed, true);
});

test("saving rejects a blank or oversized action and an out-of-enum taxonomy", async function (t) {
  start(t);
  assert.match(JSON.parse((await save([slot("slot-a", "sunday", "source-sun", { action_text: "   " })])).body).error, /action_text is required/);
  assert.match(JSON.parse((await save([slot("slot-a", "sunday", "source-sun", { action_text: "x".repeat(1025) })])).body).error, /1024 characters or fewer/);
  // The slot declares its own taxonomy now, so only membership of the enum is
  // checked — agreeing with the prescription is explicitly no longer required.
  assert.match(JSON.parse((await save([slot("slot-a", "sunday", "source-sun", { pillar: "sleep_hygiene" })])).body).error, /pillar is invalid/);
  assert.match(JSON.parse((await save([slot("slot-a", "sunday", "source-sun", { category: "encourage" })])).body).error, /category is invalid/);
  assert.equal((await save([slot("slot-a", "sunday", "source-sun", { pillar: "nutrition", category: "reduce" })])).statusCode, 200);
});

test("a legacy plan with no action can still be rejected", async function (t) {
  const store = start(t);
  const res = responseRecorder();
  await approveHandler({ method: "POST", headers: { authorization: "Bearer token" }, body: {
    user_id: "patient-1", decision: "reject", start_date: "2099-08-01", end_date: "2099-08-31",
    slots: [slot("slot-sun", "sunday", "source-sun", { action_text: "", pillar: "nutrition" })]
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(store.tables.nudges.rows.find(row => row.nudge_id === "source-sun").status, "rejected");
});

// ---- Per-slot ownership and exact preservation ---------------------------

test("two slots under one prescription keep different actions", async function (t) {
  const store = start(t);
  const res = await save([
    slot("slot-wed", "wednesday", "source-wed", { action_text: "Be in bed by 10pm" }),
    slot("slot-fri", "friday", "source-fri", { action_text: "No screens after 9pm" })
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    store.tables.weekly_schedule.rows.map(row => [row.schedule_slot_id, row.action_text]).sort(),
    [["slot-fri", "No screens after 9pm"], ["slot-wed", "Be in bed by 10pm"]]
  );
});

test("one prescription persists behaviours in two different pillars", async function (t) {
  // The headline of the behaviour-taxonomy change. A doctor's note like "walk
  // more, sleep by 10" is one prescription; before this, covering both pillars
  // meant creating a second prescription and retyping the doctor's words.
  const store = start(t);
  const res = await save([
    slot("slot-wed", "wednesday", "source-wed", { action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" }),
    slot("slot-fri", "friday", "source-fri", { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" })
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    store.tables.weekly_schedule.rows.map(row => [row.schedule_slot_id, row.pillar, row.category]).sort(),
    [["slot-fri", "physical_activity", "increase"], ["slot-wed", "sleep", "establish"]]
  );
  // And the reload keeps them apart, rather than collapsing both onto the
  // prescription's own pillar.
  const read = responseRecorder();
  await patientsHandler({ method: "GET", headers: { authorization: "Bearer token" } }, read);
  const weekly = JSON.parse(read.body).patients[0].weekly_schedule;
  assert.deepEqual(weekly.map(row => row.pillar).sort(), ["physical_activity", "sleep"]);
});

test("a slot that names no category inherits its prescription's", async function (t) {
  // Case A of the migration: the live column is blank on every row, so the first
  // clinician save is what fills it. A slot may omit it; it may never be garbage.
  const store = start(t);
  assert.equal((await save([slot("slot-sun", "sunday", "source-sun", { category: undefined })])).statusCode, 200);
  assert.equal(store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-sun").category, "establish");
});

test("a dated delivery carries its slot's pillar and category, not its prescription's", async function (t) {
  const store = start(t);
  assert.equal((await save([slot("slot-sun", "sunday", "source-sun", { pillar: "nutrition", category: "reduce" })])).statusCode, 200);
  const generated = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun");
  assert.ok(generated.length > 1);
  // Workflow B reads the dated row, so the delivery must be self-describing.
  assert.ok(generated.every(row => row.pillar === "nutrition" && row.category === "reduce"));
});

test("save, materialization and reload preserve the action byte for byte", async function (t) {
  const store = start(t);
  assert.equal((await save([slot("slot-sun", "sunday", "source-sun")])).statusCode, 200);

  const weekly = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-sun");
  assert.equal(weekly.action_text, ACTION);
  const generated = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun");
  assert.ok(generated.length > 1);
  assert.ok(generated.every(row => row.action_text === ACTION));

  const res = responseRecorder();
  await patientsHandler({ method: "GET", headers: { authorization: "Bearer token" } }, res);
  const patient = JSON.parse(res.body).patients[0];
  assert.equal(patient.weekly_schedule[0].action_text, ACTION);
  assert.equal(patient.preferred_nudge_time, "20:30");
});

test("editing a future slot leaves an already-sent delivery and its action untouched", async function (t) {
  const store = start(t);
  assert.equal((await save([slot("slot-sun", "sunday", "source-sun", { action_text: "Original action" })])).statusCode, 200);
  const sent = store.tables.nudges.rows.find(row => row.schedule_slot_id === "slot-sun");
  sent.status = "sent";
  sent.sent_at = "2099-08-02T09:00:00Z";

  assert.equal((await save([slot("slot-sun", "sunday", "source-sun", { action_text: "Revised action" })])).statusCode, 200);
  const history = store.tables.nudges.rows.find(row => row.nudge_id === sent.nudge_id);
  assert.equal(history.status, "sent");
  assert.equal(history.action_text, "Original action");
  const upcoming = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-sun" && row.nudge_id !== sent.nudge_id);
  assert.ok(upcoming.length > 0);
  assert.ok(upcoming.every(row => row.action_text === "Revised action"));
});

// ---- Custom nudges attach to an explicitly chosen prescription ------------

test("a custom nudge cannot borrow a source row from another prescription", async function (t) {
  const seed = baseSeed();
  seed.prescriptions.push({ prescription_id: "rx-2", user_id: "patient-1", pillar: "nutrition", category: "increase", target_behavior: "", frequency_per_week: 2, duration_weeks: 4 });
  seed.nudges.push(Object.assign({}, seed.nudges[0], { nudge_id: "source-veg", prescription_id: "rx-2", pillar: "nutrition", action_text: "Eat 5 servings of vegetables" }));
  const store = start(t, seed);

  const mismatched = await save([slot("slot-custom", "monday", "source-veg", { prescription_id: "rx-1" })]);
  assert.equal(mismatched.statusCode, 400);
  assert.match(JSON.parse(mismatched.body).error, /belongs to a different prescription/);
  assert.equal(store.tables.weekly_schedule.rows.length, 0);

  const chosen = await save([slot("slot-custom", "monday", "source-veg", {
    prescription_id: "rx-2", pillar: "nutrition", action_text: "Add a side salad at lunch"
  })]);
  assert.equal(chosen.statusCode, 200);
  const saved = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-custom");
  assert.equal(saved.prescription_id, "rx-2");
  assert.equal(saved.pillar, "nutrition");
  assert.equal(saved.action_text, "Add a side salad at lunch");
});

test("the monitoring screen removes nudge and prescription creation", function () {
  assert.doesNotMatch(monitorHtml, /Add nudge|customDialog|rxDialog|Add prescription/);
  assert.match(monitorHtml, /intake-generated nudges/);
  assert.match(monitorHtml, /source_nudge_id:s\.source_nudge_id/);
});

test("the monitor opens on the current Monday-to-Sunday week", function () {
  assert.match(monitorHtml, /function currentMonday/);
  assert.match(monitorHtml, /id="prevWeek"/);
  assert.match(monitorHtml, /id="nextWeek"/);
  assert.match(monitorHtml, /Plan next week/);
});

test("a doctor's own wording survives save, reload and re-edit", async function (t) {
  // The save -> reload contract, end to end. Only message_body and
  // message_body_alt persist, so on reload the option list is rebuilt from the
  // prescription's source rows and the saved body must find its way back — as a
  // generated option if the model wrote it, as the doctor-custom option if not.
  installAuth(t);
  const seed = baseSeed();
  // Two wordings for one behaviour, exactly what frequency_per_week produces.
  seed.nudges[0].message_body = "Wednesday reminder";
  seed.nudges[0].message_body_alt = "Wednesday, neutral phrasing";
  const store = fixture(seed);
  t.after(() => store.restore());

  const doctorWording = "Bed by 10 — phone in the kitchen, lights off.";
  const res = await save([slot("slot-wed", "wednesday", "source-wed", {
    action_text: "Be in bed by 10pm", message_body: doctorWording, message_body_alt: ""
  })]);
  assert.equal(res.statusCode, 200);

  const saved = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-wed");
  assert.equal(saved.message_body, doctorWording);

  const sources = store.tables.nudges.rows
    .filter(row => !String(row.nudge_id).startsWith("schd_") && row.prescription_id === "rx-1")
    .map(row => ({
      prescription_id: row.prescription_id, action_text: row.action_text,
      message_body: row.message_body, message_body_alt: row.message_body_alt, tone_variant: row.tone_variant
    }));

  const rebuilt = ReviewState.buildMessageOptions({
    sources, prescriptionId: "rx-1", actionText: saved.action_text,
    currentText: saved.message_body, customTone: saved.tone_variant,
    preferredTone: saved.tone_variant, ordinal: 0
  });

  // The doctor's wording comes back selected, as custom, unmangled...
  const active = rebuilt.options[rebuilt.selected];
  assert.equal(active.generated, false);
  assert.equal(active.text, doctorWording);
  assert.equal(active.tone, "encouraging", "the chosen tone must not be flattened on the way back");
  // ...and every model wording is still offered, so the edit stays reversible.
  assert.ok(rebuilt.generatedCount >= 2);
  assert.ok(rebuilt.options.some(option => option.text === "Wednesday reminder"));
  // A body the model did write reselects its own option instead.
  const reselected = ReviewState.buildMessageOptions({
    sources, prescriptionId: "rx-1", actionText: saved.action_text,
    currentText: "Wednesday reminder", customTone: "encouraging", preferredTone: "encouraging", ordinal: 0
  });
  assert.equal(reselected.options[reselected.selected].generated, true);
  assert.equal(reselected.options[reselected.generatedCount].text, "");
});

test("the weekly editor exposes no add or remove entry point", function () {
  assert.doesNotMatch(monitorHtml, /Add nudge|addnudge|Remove message|className="rm"/);
  assert.match(monitorHtml, /No nudge scheduled/);
});

test("clinicians can drag approved uploads onto an existing nudge", function () {
  assert.match(monitorHtml, /Drop a clinician video or file here/);
  assert.match(monitorHtml, /\/api\/media-upload/);
  assert.match(monitorHtml, /dataTransfer\.files\[0\]/);
  assert.match(monitorHtml, /100 MB maximum/);
});

test("the monitor exposes a clinician-controlled media population action", function () {
  assert.match(monitorHtml, /id="populateMedia"/);
  assert.match(monitorHtml, /operation:"populate"/);
  assert.match(monitorHtml, /paper summary will be prepared asynchronously/);
});

test("the monitor can add a resource manually without waiting for Gemini", function () {
  assert.match(monitorHtml, /Add resource manually/);
  assert.match(monitorHtml, /operation:"manual_resource"/);
  assert.match(monitorHtml, /Save to media pool/);
  assert.match(monitorHtml, /Manual resource saved\. Review and approve the media set\./);
});

test("the weekly editor supports automatic, text-only and clinician-selected media", function () {
  assert.match(monitorHtml, /value="automatic"/);
  assert.match(monitorHtml, /value="text_only"/);
  assert.match(monitorHtml, /value="clinician_selected"/);
  assert.match(monitorHtml, /media_override_asset_id:s\.media_override_asset_id/);
});

test("the monitor hides clinical filing while preserving it in the save payload", function () {
  assert.doesNotMatch(monitorHtml, />Pillar<|>Behaviour category<|How the AI read|Adaptive media plan/);
  assert.doesNotMatch(monitorHtml, /actionpick|actiontax|renderTrace/);
  // Each behaviour row carries its own pillar and category selects: the separate
  // "Taxonomy" trace step is gone, because it described the prescription rather
  // than the behaviour and could name only one of several pillars.
  assert.match(monitorHtml, /pillar:s\.pillar,category:s\.category,action_text:s\.action_text/);
  // The weekly editor now PICKS a behaviour rather than retyping its wording.
  // The previous free-text input let one behaviour exist under three spellings
  // and gave the slot no way to inherit a pillar the clinician had set once;
  // rewording in place moved to the trace card, where it follows every slot.
  // A stored action missing from the list is pinned verbatim, or the <select>
  // would snap to its first option and silently change what the slot sends.
});

test("the monitor exposes the patient adaptation summary and time-ordered drill-down", function () {
  assert.match(monitorHtml, /id="adaptSummary"/);
  assert.match(monitorHtml, /id="adaptModel"/);
  assert.match(monitorHtml, /Frequency model/);
  assert.match(monitorHtml, /shadow/);
  assert.match(monitorHtml, /patient-dictionary/);
  assert.match(monitorHtml, /Change over time/);
  assert.match(monitorHtml, /Requested /);
});

// ---- Legacy rows keep working ------------------------------------------

test("legacy rows read as readable action text without losing their schedule", function () {
  const patients = buildPatients({
    user: { rows: [{ user_id: "p1", name: "Legacy", user_status: "active", doctor_id: "doc-1" }] },
    questionnaire: { rows: [] },
    prescriptions: { rows: [{ prescription_id: "rx-old", user_id: "p1", pillar: "physical_activity", category: "increase", target_behavior: "daily_steps_10000" }] },
    nudges: { rows: [{ nudge_id: "ndg-old", user_id: "p1", prescription_id: "rx-old", action_text: "", status: "approved" }] },
    weekly_schedule: { rows: [{ schedule_slot_id: "slot-old", user_id: "p1", prescription_id: "rx-old", day: "monday", action_text: "", status: "active" }] }
  });
  assert.equal(patients[0].nudges[0].action_text, "Walk 10,000 steps");
  assert.equal(patients[0].weekly_schedule[0].action_text, "Walk 10,000 steps");
  assert.equal(patients[0].preferred_nudge_time, "");
});

test("the migration seed converts a retired action token and keeps the recurring slot", function () {
  const rows = seedWeeklySchedule([
    { nudge_id: "ndg-1", user_id: "p1", prescription_id: "rx1", status: "approved", nudge_type: "reminder", pillar: "sleep", message_body: "Source" },
    { nudge_id: "schd_ndg-1_20260727_0", user_id: "p1", prescription_id: "rx1", status: "approved", scheduled_date: "2026-07-27", scheduled_time: "10:30", message_body: "Current" }
  ], "2026-07-28T00:00:00.000Z", [{ prescription_id: "rx1", target_behavior: "sleep_onset_consistency" }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].action_text, "Go to bed at a consistent time");
});
