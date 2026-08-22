"use strict";

// Two-stage nudge feedback: commitment ("Will you do this?") → delayed outcome
// check ("Were you able to complete it?").
//
// Coverage is split deliberately. The clinician-facing half runs through the real
// /api/schedule handler against the Sheets fixture, so header contracts and
// round-trip normalization are exercised exactly as production would. The
// delivery/feedback half extracts the jsCode out of the n8n workflow JSON and
// runs it in-process, because that code cannot require() this repo and would
// otherwise only be verified by hand in the n8n editor.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scheduleHandler = require("../api/schedule");
const followup = require("../api/_lib/followup");
const { planWork, expiryOperations, sentOperation } = require("../api/_lib/followup-scheduler");
const {
  parseInbound, resolveReply, applyReply, confirmationFor, barrierPromptOperation
} = require("../api/_lib/feedback-store");
const ReviewState = require("../review-state");
const { fixture, baseSeed } = require("./sheets-fixture");

const projectRoot = path.resolve(__dirname, "../..");
const readWorkflow = name => JSON.parse(fs.readFileSync(path.join(projectRoot, "workflows", name), "utf8"));
const delivery = readWorkflow("workflow_b_delivery_twilio.json");
const feedback = readWorkflow("workflow_c_feedback.json");
const scheduler = readWorkflow("workflow_f_followup.json");

function node(workflow, name) {
  const found = workflow.nodes.find(item => item.name === name);
  assert.ok(found, `Missing workflow node: ${name}`);
  return found;
}

function runCode(code, globals) {
  return Function(...Object.keys(globals), code)(...Object.values(globals));
}

// Evaluate an n8n column expression ("={{ … }}") against one item's json, so a
// mapped write is asserted as the value it actually produces rather than as the
// template string. A plain literal passes straight through.
function evaluate(expression, json) {
  const raw = String(expression == null ? "" : expression);
  if (!raw.startsWith("=")) return raw;
  const body = raw.slice(1).replace(/^\{\{|\}\}$/g, "").trim();
  return Function("$json", `return (${body});`)(json);
}

// ---- n8n harness ----------------------------------------------------------
// Minimal Luxon-alike. Only the members the workflow Code nodes actually touch
// are implemented, so an unnoticed new dependency fails loudly here rather than
// silently passing with a stub that does too much.
function luxonLike(ms) {
  return {
    toMillis: () => ms,
    toISO: () => new Date(ms).toISOString(),
    toISODate: () => new Date(ms).toISOString().slice(0, 10),
    setZone: () => luxonLike(ms),
    startOf: () => luxonLike(Date.parse(new Date(ms).toISOString().slice(0, 10) + "T00:00:00Z")),
    plus: ({ hours = 0, minutes = 0 }) => luxonLike(ms + hours * 3600000 + minutes * 60000),
    diff: (other, unit) => ({ [unit]: (ms - other.toMillis()) / (unit === "minutes" ? 60000 : 1) })
  };
}

const TWILIO_ENV = {
  TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
  TWILIO_AUTH_TOKEN: "secret",
  TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
  TWILIO_CONTENT_SID: "HX22222222222222222222222222222222",
  TWILIO_COMMITMENT_CONTENT_SID: "HX33333333333333333333333333333333",
  TWILIO_OUTCOME_CONTENT_SID: "HX44444444444444444444444444444444"
};

// Resolves a parsed inbound message against a schedule_state table. This used to
// extract Workflow C's "Classify Reply" jsCode; that logic now lives in
// api/_lib/feedback-store.js, so it is called directly — which is the point of
// the port: the 9 IF nodes and 12 column mappings that surrounded it are now
// reachable by assertions too.
const TEST_PHONE = "+61411111111";
function classify(parsed, rows) {
  const full = Object.assign({ from_phone: TEST_PHONE, incoming_wa_id: "SM_in_default", opt_out_type: "" }, parsed);
  const users = [{ user_id: full.user_id, phone: full.from_phone, user_status: full.user_status || "active" }];
  return resolveReply({ parsed: full, users, states: rows });
}

// Runs the follow-up scheduler against a whole world state. This used to extract
// Workflow F's "Classify Follow-up Work" jsCode; the logic now lives in a real
// module, so it is called directly. The `nudges` shape is kept as the old
// id-keyed object so every existing caller reads unchanged.
function planWorkFull({ states, users, nudges, now, env = {} }) {
  return planWork({
    states,
    users,
    nudges: Object.entries(nudges || {}).map(([nudge_id, value]) => Object.assign({ nudge_id }, value)),
    now,
    outcomeWindowHours: env.FOLLOWUP_OUTCOME_WINDOW_HOURS
  });
}

function schedulerWork(world) {
  // The old jsCode returned plain job objects; `state` is an implementation
  // detail of the module, so it is dropped to keep every existing assertion —
  // including the deepEqual ones — reading unchanged.
  return planWorkFull(world).map(job => {
    const copy = Object.assign({}, job);
    delete copy.state;
    return copy;
  });
}

// A minimal Sheets table around some rows, matching what loadClinicalData hands
// the store: headers plus rows carrying row_number.
function stateTableFor(rows) {
  return {
    headers: require("./sheets-fixture").HEADERS.schedule_state.slice(),
    rows: rows.map((row, index) => Object.assign({ row_number: index + 2 }, row))
  };
}

// The schedule_state row a resolution actually writes. Replaces reading an n8n
// column mapping: this is the merged row that reaches Sheets, so a field the
// store leaves alone shows its prior value rather than a blank — the property
// that makes the old "a blank mapping clears the column" bug impossible here.
const APPLY_NOW = "2026-08-05T14:00:00+10:00";
function writeFor(resolution, rows) {
  const out = applyReply({
    resolution,
    stateTable: stateTableFor(rows),
    userTable: { headers: ["user_id", "user_status"], rows: [] },
    now: APPLY_NOW
  });
  const op = out.operations.find(item => item.tab === "schedule_state");
  return op ? op.row : null;
}

// ---- Clinician-facing fixtures --------------------------------------------
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

function slot(overrides = {}) {
  return Object.assign({
    schedule_slot_id: "slot-wed", source_nudge_id: "source-wed", prescription_id: "rx-1",
    day: "wednesday", time: "09:00", nudge_type: "reminder", pillar: "sleep",
    action_text: "Be in bed by 10pm", tone_variant: "encouraging",
    message_body: "Wind down tonight", message_body_alt: "", template_name: "health_plan_reminder"
  }, overrides);
}

function responseRecorder() {
  return { statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = value || ""; } };
}

async function save(slots, range = { start_date: "2099-08-01", end_date: "2099-08-31" }) {
  const req = { method: "PUT", headers: { authorization: "Bearer token" }, body: Object.assign({ user_id: "patient-1", slots }, range) };
  const res = responseRecorder();
  await scheduleHandler(req, res);
  return res;
}

// =====================================================================
// 1. Follow-up controls save and reload correctly
// =====================================================================
test("follow-up controls persist to the canonical slot, its dated nudges, and reload", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());

  const res = await save([slot({ followup_enabled: true, followup_delay_hours: 4 })]);
  assert.equal(res.statusCode, 200);

  const saved = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-wed");
  assert.equal(saved.followup_enabled, "TRUE");
  assert.equal(saved.followup_delay_hours, "4");

  // Copied to every dated delivery, so Workflow B reads the delivery row rather
  // than re-deriving a plan that may have changed since.
  const dated = store.tables.nudges.rows.filter(row => row.schedule_slot_id === "slot-wed");
  assert.ok(dated.length > 0);
  assert.ok(dated.every(row => row.followup_enabled === "TRUE" && row.followup_delay_hours === "4"));

  // Reload → edit: the response is what the Monitor reseeds the week from.
  const reloaded = JSON.parse(res.body).weekly_schedule.find(row => row.schedule_slot_id === "slot-wed");
  assert.equal(reloaded.followup_enabled, "TRUE");
  assert.equal(reloaded.followup_delay_hours, "4");
  assert.equal(ReviewState.isFollowupEnabled(reloaded.followup_enabled), true);
});

// =====================================================================
// 2. Disabled follow-up requires no delay
// =====================================================================
test("a disabled follow-up needs no delay and stores a blank one", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());

  const res = await save([slot({ followup_enabled: false })]);
  assert.equal(res.statusCode, 200);
  const saved = store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-wed");
  assert.equal(saved.followup_enabled, "FALSE");
  assert.equal(saved.followup_delay_hours, "");

  // A stale delay left behind while the switch is off would read as a live
  // setting to the next clinician, so it is forced blank rather than preserved.
  const stale = await save([slot({ followup_enabled: false, followup_delay_hours: 12 })]);
  assert.equal(stale.statusCode, 200);
  assert.equal(store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-wed").followup_delay_hours, "");
});

// =====================================================================
// 3. Enabled follow-up rejects missing / fractional / zero / negative / >72
// =====================================================================
test("an enabled follow-up rejects every invalid delay, on the server and in the client mirror", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());

  const invalid = [undefined, "", "2.5", 2.5, 0, -1, "-4", 73, 100, "abc", " "];
  for (const hours of invalid) {
    const res = await save([slot({ followup_enabled: true, followup_delay_hours: hours })]);
    assert.equal(res.statusCode, 400, `expected 400 for followup_delay_hours=${JSON.stringify(hours)}`);
    assert.match(JSON.parse(res.body).error, /followup_delay_hours/);
    assert.equal(
      ReviewState.validateFollowup({ enabled: true, hours, nudgeType: "reminder" }).ok, false,
      `client mirror should also reject ${JSON.stringify(hours)}`
    );
  }
  assert.equal(store.tables.weekly_schedule.rows.length, 0, "no invalid slot may reach the sheet");

  // The boundaries themselves are valid.
  for (const hours of [1, 72, "1", "72"]) {
    assert.equal(ReviewState.validateFollowup({ enabled: true, hours, nudgeType: "reminder" }).ok, true);
  }
  assert.equal((await save([slot({ followup_enabled: true, followup_delay_hours: 72 })])).statusCode, 200);
});

// =====================================================================
// 16. Non-actionable informational messages never request a commitment
// =====================================================================
test("an informational nudge type cannot carry a commitment or a follow-up", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());

  for (const nudgeType of ["affirmation", "reflection"]) {
    const res = await save([slot({ nudge_type: nudgeType, followup_enabled: true, followup_delay_hours: 4 })]);
    assert.equal(res.statusCode, 400);
    assert.match(JSON.parse(res.body).error, /actionable nudge/);
    assert.equal(ReviewState.validateFollowup({ enabled: true, hours: 4, nudgeType }).ok, false);
  }
  // The same nudge types remain schedulable single-stage.
  const ok = await save([slot({ nudge_type: "affirmation", followup_enabled: false })]);
  assert.equal(ok.statusCode, 200);
  assert.equal(store.tables.weekly_schedule.rows.find(row => row.schedule_slot_id === "slot-wed").followup_enabled, "FALSE");

  // And Workflow B refuses to send a commitment template for one even if a row
  // somehow carries the flag, because the sheet is editable by hand.
  const due = runCode(node(delivery, "Prepare Due Nudges").parameters.jsCode, {
    items: [{ json: {
      nudge_id: "schd_x_20990805", status: "approved", user_id: "patient-1",
      scheduled_date: "2099-08-05", scheduled_time: "09:00", message_body: "Nice work",
      nudge_type: "affirmation", followup_enabled: "TRUE", followup_delay_hours: "4"
    } }],
    $: () => ({ first: () => ({ json: { users: [{ user_id: "patient-1", user_status: "active", phone: "+61411111111", name: "Ada" }] } }) }),
    $now: luxonLike(Date.parse("2099-08-05T09:02:00Z"))
  });
  assert.equal(due.length, 1);
  assert.equal(due[0].json.two_stage, false, "an affirmation must never go out as a commitment question");
});

// =====================================================================
// Workflow B: template selection and due-time anchoring
// =====================================================================
test("Workflow B sends the commitment template and anchors the due time to the send timestamp", function () {
  const nudge = {
    nudge_id: "schd_wed_20990805", status: "approved", user_id: "patient-1",
    scheduled_date: "2099-08-05", scheduled_time: "09:00", message_body: "Wind down tonight",
    nudge_type: "reminder", followup_enabled: "TRUE", followup_delay_hours: "4", tone_variant: "encouraging"
  };
  const sendMs = Date.parse("2099-08-05T09:02:00Z");
  const prepared = runCode(node(delivery, "Prepare Due Nudges").parameters.jsCode, {
    items: [{ json: nudge }],
    $: () => ({ first: () => ({ json: { users: [{ user_id: "patient-1", user_status: "active", phone: "+61411111111", name: "Ada" }] } }) }),
    $now: luxonLike(sendMs)
  });
  assert.equal(prepared[0].json.two_stage, true);

  const built = runCode(node(delivery, "Build Twilio Requests").parameters.jsCode, {
    items: prepared, $env: TWILIO_ENV, Buffer
  });
  const form = new URLSearchParams(built[0].json.twilio_form);
  assert.equal(form.get("ContentSid"), TWILIO_ENV.TWILIO_COMMITMENT_CONTENT_SID, "two-stage must use the Yes/No template");
  assert.equal(built[0].json.twilio_mode, "commitment");

  const merged = runCode(node(delivery, "Merge Twilio Response").parameters.jsCode, {
    items: [{ json: { sid: "SM_out_1", status: "queued" } }],
    $: () => ({ all: () => built }),
    $now: luxonLike(sendMs)
  })[0].json;
  assert.equal(merged.state_status, "awaiting_commitment");
  assert.equal(Date.parse(merged.followup_due_at), sendMs + 4 * 3600000);
});

test("each Content SID is required only by the nudges that actually use it", function () {
  const user = { users: [{ user_id: "patient-1", user_status: "active", phone: "+61411111111", name: "Ada" }] };
  const base = {
    nudge_id: "schd_wed_20990805", status: "approved", user_id: "patient-1",
    scheduled_date: "2099-08-05", scheduled_time: "09:00", message_body: "Wind down tonight.", nudge_type: "reminder"
  };
  const at = luxonLike(Date.parse("2099-08-05T09:02:00Z"));
  const prepare = nudge => runCode(node(delivery, "Prepare Due Nudges").parameters.jsCode, {
    items: [{ json: nudge }], $: () => ({ first: () => ({ json: user }) }), $now: at
  });
  const build = (items, env) => runCode(node(delivery, "Build Twilio Requests").parameters.jsCode, { items, $env: env, Buffer });

  const twoStage = prepare(Object.assign({}, base, { followup_enabled: "TRUE", followup_delay_hours: "4" }));
  const singleStage = prepare(Object.assign({}, base, { followup_enabled: "FALSE" }));
  const without = key => Object.fromEntries(Object.entries(TWILIO_ENV).filter(([name]) => name !== key));

  // An all-two-stage batch never touches the single-stage template, so a missing
  // TWILIO_CONTENT_SID must not take those deliveries down.
  assert.equal(build(twoStage, without("TWILIO_CONTENT_SID")).length, 1);
  // ...and the reverse.
  assert.equal(build(singleStage, without("TWILIO_COMMITMENT_CONTENT_SID")).length, 1);

  // Each is still mandatory for the batch that does use it.
  assert.throws(() => build(twoStage, without("TWILIO_COMMITMENT_CONTENT_SID")), /TWILIO_COMMITMENT_CONTENT_SID/);
  assert.throws(() => build(singleStage, without("TWILIO_CONTENT_SID")), /TWILIO_CONTENT_SID/);
  // A mixed batch needs both.
  assert.throws(() => build(twoStage.concat(singleStage), without("TWILIO_CONTENT_SID")), /TWILIO_CONTENT_SID/);
  assert.throws(() => build(twoStage.concat(singleStage), without("TWILIO_COMMITMENT_CONTENT_SID")), /TWILIO_COMMITMENT_CONTENT_SID/);
  // Account-level credentials stay unconditional.
  assert.throws(() => build(twoStage, without("TWILIO_ACCOUNT_SID")), /account credentials/);
  assert.throws(() => build(twoStage, without("TWILIO_WHATSAPP_FROM")), /TWILIO_WHATSAPP_FROM/);
});

test("Workflow B leaves a single-stage nudge on the original template and status", function () {
  const prepared = runCode(node(delivery, "Prepare Due Nudges").parameters.jsCode, {
    items: [{ json: {
      nudge_id: "schd_wed_20990805", status: "approved", user_id: "patient-1",
      scheduled_date: "2099-08-05", scheduled_time: "09:00", message_body: "Wind down tonight",
      nudge_type: "reminder", followup_enabled: "FALSE", followup_delay_hours: ""
    } }],
    $: () => ({ first: () => ({ json: { users: [{ user_id: "patient-1", user_status: "active", phone: "+61411111111", name: "Ada" }] } }) }),
    $now: luxonLike(Date.parse("2099-08-05T09:02:00Z"))
  });
  const built = runCode(node(delivery, "Build Twilio Requests").parameters.jsCode, { items: prepared, $env: TWILIO_ENV, Buffer });
  assert.equal(new URLSearchParams(built[0].json.twilio_form).get("ContentSid"), TWILIO_ENV.TWILIO_CONTENT_SID);
  const merged = runCode(node(delivery, "Merge Twilio Response").parameters.jsCode, {
    items: [{ json: { sid: "SM_out_1" } }], $: () => ({ all: () => built }), $now: luxonLike(Date.parse("2099-08-05T09:02:00Z"))
  })[0].json;
  assert.equal(merged.state_status, "sent");
  assert.equal(merged.followup_due_at, "");
});

// =====================================================================
// 4 + 6. Yes schedules exactly one follow-up; No schedules none
// =====================================================================
test("Yes arms exactly one linked follow-up and No arms none", function () {
  const row = {
    user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_commitment",
    wa_message_id: "SM_out_1", sent_at: "2026-08-05T09:00:00+10:00",
    followup_enabled: "TRUE", followup_delay_hours: "4", followup_due_at: "2026-08-05T13:00:00+10:00"
  };

  const yes = classify({ user_id: "usr_1", reply_value: "YES", incoming_wa_id: "SM_in_1", context_wa_id: "SM_out_1" }, [row]);
  assert.equal(yes.reply_type, "commit_yes");
  assert.equal(yes.commitment_response, "YES");
  assert.equal(yes.nudge_id, "ndg_1", "the follow-up is linked to the nudge that was answered");
  assert.equal(yes.outcome_response, null, "stage 2 must stay untouched by a stage-1 answer");

  const yesUpdate = writeFor(yes, [row]);
  assert.equal(yesUpdate.status, "awaiting_followup");
  assert.equal(yesUpdate.commitment_response, "YES");
  assert.equal(yesUpdate.followup_due_at, "2026-08-05T13:00:00+10:00",
    "the due time is set once at delivery — recomputing it here would restart the clock on a late Yes");

  const no = classify({ user_id: "usr_1", reply_value: "NO", incoming_wa_id: "SM_in_2", context_wa_id: "SM_out_1" }, [row]);
  assert.equal(no.reply_type, "commit_no");
  assert.equal(no.commitment_response, "NO");
  const noUpdate = writeFor(no, [row]);
  assert.equal(noUpdate.status, "declined");
  assert.equal(noUpdate.followup_due_at, "", "a decline must clear the due time so no scheduler pass can pick it up");

  // A declined row is invisible to the scheduler.
  assert.equal(followup.followupEligible({
    status: "declined", commitment_response: "NO", followup_due_at: "", followup_sent_at: ""
  }, "2026-08-06T09:00:00+10:00"), false);
});

// =====================================================================
// 5. Duplicate Yes is idempotent
// =====================================================================
test("a duplicate Yes never arms a second follow-up, by SID replay or by second tap", function () {
  const answered = {
    user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_followup",
    wa_message_id: "SM_out_1", sent_at: "2026-08-05T09:00:00+10:00",
    followup_due_at: "2026-08-05T13:00:00+10:00",
    commitment_response: "YES", commitment_responded_at: "2026-08-05T09:05:00+10:00",
    response_wa_id: "SM_in_1"
  };

  // Twilio retries the same webhook: identical MessageSid.
  const replay = classify({ user_id: "usr_1", reply_value: "YES", incoming_wa_id: "SM_in_1", context_wa_id: "SM_out_1" }, [answered]);
  assert.equal(replay.reply_type, "duplicate");

  // The patient taps Yes a second time: a genuinely new MessageSid.
  const second = classify({ user_id: "usr_1", reply_value: "YES", incoming_wa_id: "SM_in_9", context_wa_id: "SM_out_1" }, [answered]);
  assert.equal(second.reply_type, "commitment_repeat");
  const repeatUpdate = writeFor(second, [answered]);
  // A repeat may only refresh idempotency. Comparing the whole written row
  // against the prior one proves it: everything except the inbound SID and the
  // touch timestamp is unchanged, so no second follow-up can be armed.
  // row_number is fixture bookkeeping; rowData() drops it because it is not a
  // header, so it never reaches the sheet.
  const changed = Object.keys(repeatUpdate)
    .filter(key => key !== "row_number")
    .filter(key => String(repeatUpdate[key] || "") !== String(answered[key] || ""));
  assert.deepEqual(changed.sort(), ["last_updated", "response_wa_id"],
    "a repeat may only refresh idempotency — touching status or the due time would arm a second follow-up");
  assert.equal(repeatUpdate.followup_due_at, "2026-08-05T13:00:00+10:00");
  assert.equal(repeatUpdate.status, "awaiting_followup");
});

// =====================================================================
// 7 + 8. Not before due; a late Yes is immediately eligible
// =====================================================================
test("a follow-up waits for its due time, and a late Yes makes it immediately eligible", function () {
  const armed = {
    user_id: "usr_1", nudge_id: "ndg_1", status: "awaiting_followup", commitment_response: "YES",
    followup_due_at: "2026-08-05T13:00:00+10:00", followup_sent_at: "", followup_wa_id: ""
  };
  assert.equal(followup.followupEligible(armed, "2026-08-05T12:59:00+10:00"), false, "not before due");
  assert.equal(followup.followupEligible(armed, "2026-08-05T13:00:00+10:00"), true, "eligible exactly at due");

  // Late Yes: the patient answered at 18:00, four hours after the 13:00 due time.
  // Because the due time was anchored at delivery, the row is already eligible on
  // the very next scheduler tick rather than waiting another full delay.
  assert.equal(followup.followupEligible(armed, "2026-08-05T18:00:01+10:00"), true);

  // Same rule inside Workflow F itself.
  const world = {
    users: [{ user_id: "usr_1", user_status: "active", phone: "+61411111111", name: "Ada" }],
    nudges: { ndg_1: { action_text: "Be in bed by 10pm" } },
    states: [Object.assign({ schedule_id: "sch_1", user_id: "usr_1" }, armed)]
  };
  assert.deepEqual(schedulerWork(Object.assign({ now: "2026-08-05T12:30:00+10:00" }, world)), []);
  const due = schedulerWork(Object.assign({ now: "2026-08-05T18:00:00+10:00" }, world));
  assert.equal(due.length, 1);
  assert.equal(due[0].job, "send");
  assert.equal(due[0].nudge_id, "ndg_1");
  assert.equal(due[0].action_text, "Be in bed by 10pm");
  assert.equal(due[0].parent_nudge_id, "ndg_1", "the follow-up is a feedback event on its parent, not a new nudge");
});

// =====================================================================
// 9. Duplicate scheduler executions do not duplicate sends
// =====================================================================
test("a second scheduler execution finds the row claimed and sends nothing", function () {
  const base = {
    schedule_id: "sch_1", user_id: "usr_1", nudge_id: "ndg_1", status: "awaiting_followup",
    commitment_response: "YES", followup_due_at: "2026-08-05T13:00:00+10:00"
  };
  const world = {
    users: [{ user_id: "usr_1", user_status: "active", phone: "+61411111111", name: "Ada" }],
    nudges: { ndg_1: { action_text: "Be in bed by 10pm" } },
    now: "2026-08-05T13:05:00+10:00"
  };

  const first = schedulerWork(Object.assign({ states: [Object.assign({ followup_sent_at: "", followup_wa_id: "" }, base)] }, world));
  assert.equal(first.filter(item => item.job === "send").length, 1);

  // Exactly the state the first pass leaves behind.
  const claimed = Object.assign({ followup_sent_at: "2026-08-05T13:05:00+10:00", followup_wa_id: "SM_fu_1" }, base);
  assert.equal(schedulerWork(Object.assign({ states: [claimed] }, world)).filter(item => item.job === "send").length, 0);
  assert.equal(followup.followupEligible(claimed, world.now), false);

  // A half-written claim (SID recorded, timestamp lost) is still a claim.
  const halfClaimed = Object.assign({ followup_sent_at: "", followup_wa_id: "SM_fu_1" }, base);
  assert.equal(schedulerWork(Object.assign({ states: [halfClaimed] }, world)).filter(item => item.job === "send").length, 0);

  // The claim itself: sending records both halves, so the very next tick sees the
  // row as taken. Written only after Twilio accepts, so a failed send leaves the
  // row eligible rather than silently swallowing the check.
  const job = planWorkFull(Object.assign({ states: [Object.assign({}, base)] }, world))[0];
  const claimOp = sentOperation({ job, stateTable: stateTableFor([base]), messageSid: "SM_fu_9", now: "2026-08-05T13:05:00+10:00" });
  assert.equal(claimOp.tab, "schedule_state");
  assert.equal(claimOp.row.followup_sent_at, "2026-08-05T13:05:00+10:00");
  assert.equal(claimOp.row.followup_wa_id, "SM_fu_9");
});

// =====================================================================
// 10 + 11 + 13. Done → DONE; Not yet → NOT_YET + barrier; correlation
// =====================================================================
test("Done and Not yet resolve through followup_wa_id to the right original nudge", function () {
  const rows = [
    { user_id: "usr_1", nudge_id: "other", schedule_id: "sch_other", status: "sent",
      wa_message_id: "SM_other", sent_at: "2026-08-05T20:00:00+10:00" },
    { user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_followup",
      wa_message_id: "SM_out_1", sent_at: "2026-08-05T09:00:00+10:00",
      commitment_response: "YES", followup_sent_at: "2026-08-05T13:00:00+10:00", followup_wa_id: "SM_fu_1" }
  ];

  // "other" is the newest message overall, so correlating on recency alone would
  // attribute the answer to the wrong nudge. The reply context decides.
  const done = classify({ user_id: "usr_1", reply_value: "Done", incoming_wa_id: "SM_in_1", context_wa_id: "SM_fu_1" }, rows);
  assert.equal(done.reply_type, "done");
  assert.equal(done.stage, "outcome");
  assert.equal(done.outcome_response, "DONE");
  assert.equal(done.canonical_response, "DONE");
  assert.equal(done.nudge_id, "ndg_1");

  const notYet = classify({ user_id: "usr_1", reply_value: "Not yet", incoming_wa_id: "SM_in_2", context_wa_id: "SM_fu_1" }, rows);
  assert.equal(notYet.reply_type, "not_yet");
  assert.equal(notYet.outcome_response, "NOT_YET");
  assert.equal(notYet.nudge_id, "ndg_1");

  // NOT_YET keeps routing into the existing barrier question, unchanged.
  const notYetUpdate = writeFor(notYet, rows);
  assert.equal(notYetUpdate.status, "not_yet");
  assert.equal(notYetUpdate.response, "NOT_YET");
  assert.equal(notYetUpdate.outcome_response, "NOT_YET");
  const barrierPrompt = confirmationFor(notYet);
  assert.match(barrierPrompt, /What got in the way\?/);
  assert.match(barrierPrompt, /1 = Stress/);

  // A stage-2 answer must not fabricate an outcome on a single-stage nudge: the
  // same reply against a plain `sent` row writes `response` and leaves
  // outcome_response alone.
  const singleStage = [{
    user_id: "usr_1", nudge_id: "ndg_9", schedule_id: "sch_9", status: "sent",
    wa_message_id: "SM_out_9", sent_at: "2026-08-05T09:00:00+10:00"
  }];
  const progressDone = classify({ user_id: "usr_1", reply_value: "Done", incoming_wa_id: "SM_in_7", context_wa_id: "SM_out_9" }, singleStage);
  assert.equal(progressDone.stage, "progress");
  const progressWrite = writeFor(progressDone, singleStage);
  assert.equal(progressWrite.response, "DONE");
  assert.equal(String(progressWrite.outcome_response || ""), "", "a single-stage nudge has no outcome stage to record");

  // And a genuine stage-2 Done does write it.
  assert.equal(writeFor(done, rows).outcome_response, "DONE");

  // Typed fallbacks behave identically to the buttons.
  assert.equal(classify({ user_id: "usr_1", reply_value: "done", incoming_wa_id: "SM_in_3", context_wa_id: "SM_fu_1" }, rows).outcome_response, "DONE");
  assert.equal(classify({ user_id: "usr_1", reply_value: "no", incoming_wa_id: "SM_in_4", context_wa_id: "SM_fu_1" }, rows).outcome_response, "NOT_YET");
  // The same token in stage 1 means the opposite, which is exactly why the stage
  // is resolved by correlation before the reply is mapped.
  assert.equal(classify({ user_id: "usr_1", reply_value: "no", incoming_wa_id: "SM_in_5", context_wa_id: "SM_out_1" },
    [{ user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_commitment", wa_message_id: "SM_out_1" }]).commitment_response, "NO");
});

// =====================================================================
// 12. Missing commitment and missing outcome both remain NO_FEEDBACK
// =====================================================================
test("an unanswered commitment or outcome window closes as NO_FEEDBACK, never NOT_YET", function () {
  const users = [{ user_id: "usr_1", user_status: "active", phone: "+61411111111", name: "Ada" }];
  const nudges = { ndg_1: { action_text: "Be in bed by 10pm" } };

  const staleCommitment = {
    schedule_id: "sch_1", user_id: "usr_1", nudge_id: "ndg_1", status: "awaiting_commitment",
    sent_at: "2026-08-05T09:00:00+10:00", followup_due_at: "2026-08-05T13:00:00+10:00", commitment_response: ""
  };
  assert.deepEqual(schedulerWork({ states: [staleCommitment], users, nudges, now: "2026-08-05T12:00:00+10:00" }), [],
    "still inside the window");
  const expiredCommitment = schedulerWork({ states: [staleCommitment], users, nudges, now: "2026-08-05T13:00:01+10:00" });
  assert.equal(expiredCommitment.length, 1);
  assert.equal(expiredCommitment[0].job, "expire_commitment");
  // Crucially, no outcome check is sent for a commitment that never arrived.
  assert.equal(expiredCommitment.filter(item => item.job === "send").length, 0);

  const staleOutcome = {
    schedule_id: "sch_1", user_id: "usr_1", nudge_id: "ndg_1", status: "awaiting_followup",
    commitment_response: "YES", followup_due_at: "2026-08-05T13:00:00+10:00",
    followup_sent_at: "2026-08-05T13:05:00+10:00", followup_wa_id: "SM_fu_1", outcome_response: ""
  };
  assert.deepEqual(schedulerWork({ states: [staleOutcome], users, nudges, now: "2026-08-06T10:00:00+10:00" }), [],
    "still inside the 24-hour outcome window");
  const expiredOutcome = schedulerWork({ states: [staleOutcome], users, nudges, now: "2026-08-06T14:00:00+10:00" });
  assert.equal(expiredOutcome.length, 1);
  assert.equal(expiredOutcome[0].job, "expire_outcome");

  // Both write NO_FEEDBACK, and neither writes NOT_YET anywhere.
  const commitmentJobs = planWorkFull({ states: [staleCommitment], users, nudges, now: "2026-08-06T14:00:00+10:00" });
  const outcomeJobs = planWorkFull({ states: [staleOutcome], users, nudges, now: "2026-08-06T14:00:00+10:00" });
  const commitmentWrite = expiryOperations({ jobs: commitmentJobs, stateTable: stateTableFor([staleCommitment]), now: "2026-08-06T14:00:00+10:00" })[0].row;
  const outcomeWrite = expiryOperations({ jobs: outcomeJobs, stateTable: stateTableFor([staleOutcome]), now: "2026-08-06T14:00:00+10:00" })[0].row;
  assert.equal(commitmentWrite.commitment_response, "NO_FEEDBACK");
  assert.equal(commitmentWrite.status, "no_feedback");
  assert.equal(commitmentWrite.followup_due_at, "");
  assert.equal(outcomeWrite.outcome_response, "NO_FEEDBACK");
  assert.equal(outcomeWrite.status, "no_feedback");
  // An expiring outcome window must leave the commitment that WAS given intact —
  // the same distinction the STOP cascade protects.
  assert.equal(outcomeWrite.commitment_response, "YES");
  for (const write of [commitmentWrite, outcomeWrite]) {
    assert.equal(JSON.stringify(write).includes("NOT_YET"), false, "silence must never be recorded as a self-reported NOT_YET");
  }
  // The configured window is honoured rather than hard-coded.
  assert.equal(schedulerWork({ states: [staleOutcome], users, nudges, now: "2026-08-05T15:00:00+10:00", env: { FOLLOWUP_OUTCOME_WINDOW_HOURS: "1" } })[0].job, "expire_outcome");
});

// =====================================================================
// 14. STOP cancels every pending follow-up and prevents later delivery
// =====================================================================
test("typed STOP cancels every open stage and blocks all later follow-up delivery", function () {
  const rows = [
    { user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_commitment", wa_message_id: "SM_1", sent_at: "2026-08-05T09:00:00+10:00" },
    { user_id: "usr_1", nudge_id: "ndg_2", schedule_id: "sch_2", status: "awaiting_followup", commitment_response: "YES", followup_due_at: "2026-08-05T13:00:00+10:00" },
    { user_id: "usr_1", nudge_id: "ndg_3", schedule_id: "sch_3", status: "done" },
    { user_id: "usr_2", nudge_id: "ndg_4", schedule_id: "sch_4", status: "awaiting_commitment" }
  ];

  const stop = classify({ user_id: "usr_1", reply_value: "STOP", incoming_wa_id: "SM_in_1", context_wa_id: null, opt_out_type: "" }, rows);
  assert.equal(stop.reply_type, "stop");
  assert.deepEqual(stop.cancel_rows.map(row => row.nudge_id).sort(), ["ndg_1", "ndg_2"],
    "every open stage is cancelled; a settled row and another patient's row are untouched");

  // The writes themselves, not a template string. What "unanswered" means depends
  // on the stage the STOP interrupted: an awaiting_commitment row never gave a
  // commitment, so NO_FEEDBACK belongs on commitment_response; an
  // awaiting_followup row ALREADY answered YES, and overwriting that would make a
  // cut-short YES indistinguishable from a commitment never given.
  const stateTable = stateTableFor(rows);
  const userTable = { headers: ["user_id", "user_status"], rows: [{ row_number: 2, user_id: "usr_1", user_status: "active" }] };
  const applied = applyReply({ resolution: stop, stateTable, userTable, now: "2026-08-05T14:00:00+10:00" });
  assert.equal(applied.applied, true);

  const written = id => applied.operations.find(op => op.tab === "schedule_state" && op.row.nudge_id === id).row;
  assert.equal(written("ndg_1").status, "opted_out");
  assert.equal(written("ndg_1").followup_due_at, "");
  assert.deepEqual(
    { commitment_response: written("ndg_1").commitment_response, outcome_response: written("ndg_1").outcome_response },
    { commitment_response: "NO_FEEDBACK", outcome_response: "" },
    "a commitment that was never given is NO_FEEDBACK");
  assert.deepEqual(
    { commitment_response: written("ndg_2").commitment_response, outcome_response: written("ndg_2").outcome_response },
    { commitment_response: "YES", outcome_response: "NO_FEEDBACK" },
    "an answered YES survives STOP; it is the outcome window that closed unanswered");

  // Untouched rows are never written at all, not merely written unchanged.
  assert.deepEqual(applied.operations.filter(op => op.tab === "schedule_state").map(op => op.row.nudge_id).sort(), ["ndg_1", "ndg_2"]);
  // And the patient is opted out, which is the second, independent stop.
  assert.equal(applied.operations.find(op => op.tab === "user").row.user_status, "opted_out");

  // The cancelled row is invisible to the scheduler, and so is the whole patient
  // once user_status flips — two independent stops, either one sufficient.
  const cancelled = { schedule_id: "sch_2", user_id: "usr_1", nudge_id: "ndg_2", status: "opted_out", commitment_response: "YES", followup_due_at: "" };
  const world = { users: [{ user_id: "usr_1", user_status: "opted_out", phone: "+61411111111", name: "Ada" }], nudges: { ndg_2: { action_text: "x" } }, now: "2026-08-06T09:00:00+10:00" };
  assert.deepEqual(schedulerWork(Object.assign({ states: [cancelled] }, world)), []);
  assert.deepEqual(schedulerWork(Object.assign({ states: [Object.assign({}, cancelled, { status: "awaiting_followup", followup_due_at: "2026-08-05T13:00:00+10:00" })] }, world)), [],
    "an opted-out patient is skipped even if a row was somehow left armed");

});

// =====================================================================
// 15. Twilio OptOutType=STOP persists without a second confirmation
// =====================================================================
test("Twilio Advanced Opt-Out is persisted locally with no duplicate confirmation", function () {
  const rows = [{ user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "awaiting_commitment", wa_message_id: "SM_1" }];

  const parsed = parseInbound({
    From: "whatsapp:+61411111111", To: "whatsapp:+14155238886", Body: "stop",
    MessageSid: "SM_in_1", OptOutType: "STOP"
  });
  assert.equal(parsed.opt_out_type, "STOP", "OptOutType must survive parsing");
  assert.equal(parsed.from_phone, "+61411111111", "the whatsapp: channel prefix is stripped");

  const result = classify(Object.assign({ user_id: "usr_1" }, parsed), rows);
  assert.equal(result.reply_type, "stop_optout");
  assert.deepEqual(result.cancel_rows.map(row => row.nudge_id), ["ndg_1"], "the opt-out is still persisted locally");

  // Twilio already replied to the patient; ours would be a second message.
  assert.equal(confirmationFor(result), null, "no duplicate confirmation for a Twilio-handled opt-out");

  // A typed STOP that Twilio did not handle still gets exactly one confirmation.
  const typed = classify({ user_id: "usr_1", reply_value: "STOP", incoming_wa_id: "SM_in_2", context_wa_id: null, opt_out_type: "" }, rows);
  assert.equal(typed.reply_type, "stop");
  assert.match(confirmationFor(typed), /opted out/i);

  // Both still opt the patient out locally — the difference is only the reply.
  for (const resolution of [result, typed]) {
    const out = applyReply({
      resolution,
      stateTable: stateTableFor(rows),
      userTable: { headers: ["user_id", "user_status"], rows: [{ row_number: 2, user_id: "usr_1", user_status: "active" }] },
      now: "2026-08-05T14:00:00+10:00"
    });
    assert.equal(out.operations.find(op => op.tab === "user").row.user_status, "opted_out");
  }
});

// =====================================================================
// 17. The existing single-stage contract is untouched
// =====================================================================
test("single-stage Done / In progress / Not yet and the barrier flow still behave exactly as before", function () {
  const legacy = [
    { user_id: "usr_1", nudge_id: "old", schedule_id: "sch_old", status: "sent", wa_message_id: "SM_old", sent_at: "2026-07-28T01:00:00Z" },
    { user_id: "usr_1", nudge_id: "new", schedule_id: "sch_new", status: "sent", wa_message_id: "SM_new", sent_at: "2026-07-28T02:00:00Z" }
  ];
  const typed = classify({ user_id: "usr_1", reply_value: "not yet", incoming_wa_id: "SM_in_1", context_wa_id: null }, legacy);
  assert.equal(typed.reply_type, "not_yet");
  assert.equal(typed.canonical_response, "NOT_YET");
  assert.equal(typed.nudge_id, "new", "no context still falls back to the newest outstanding nudge");
  assert.equal(typed.outcome_response, null, "a single-stage reply writes no outcome");

  assert.equal(classify({ user_id: "usr_1", reply_value: "IN_PROGRESS", incoming_wa_id: "SM_in_2", context_wa_id: "SM_new" }, legacy).reply_type, "in_progress");
  assert.equal(classify({ user_id: "usr_1", reply_value: "SKIP", incoming_wa_id: "SM_in_3", context_wa_id: "SM_new" }, legacy).canonical_response, "NOT_YET");

  const barrierRow = [{ user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "not_yet", wa_message_id: "SM_out_1", barrier_followup_wa_id: "SM_barrier_1", last_updated: "2026-07-28T02:00:00Z" }];
  assert.equal(classify({ user_id: "usr_1", reply_value: "3", reply_body: "3", incoming_wa_id: "SM_in_4", context_wa_id: null }, barrierRow).reply_type, "barrier");
  assert.equal(classify({ user_id: "usr_1", reply_value: "anything", incoming_wa_id: "SM_in_5", context_wa_id: "SM_barrier_1" }, barrierRow).reply_type, "barrier");
  assert.equal(classify({ user_id: "usr_1", reply_value: "DONE", incoming_wa_id: "SM_seen", context_wa_id: null }, [Object.assign({ response_wa_id: "SM_seen" }, barrierRow[0])]).reply_type, "duplicate");

  // An unrecognised reply with nothing open is still just "unknown".
  assert.equal(classify({ user_id: "usr_1", reply_value: "hello there", incoming_wa_id: "SM_in_6", context_wa_id: null }, []).reply_type, "unknown");
});

// =====================================================================
// Contract-level guards
// =====================================================================
test("approval never resets a row that has already entered the two-stage flow", async function (t) {
  installAuth(t);
  const store = fixture(baseSeed());
  t.after(() => store.restore());

  assert.equal((await save([slot({ followup_enabled: true, followup_delay_hours: 4 })])).statusCode, 200);
  const delivered = store.tables.nudges.rows.find(row => row.schedule_slot_id === "slot-wed");
  const state = store.tables.schedule_state.rows.find(row => row.nudge_id === delivered.nudge_id);
  Object.assign(state, {
    status: "awaiting_followup", commitment_response: "YES",
    commitment_responded_at: "2099-08-05T09:05:00+10:00", followup_due_at: "2099-08-05T13:00:00+10:00",
    sent_at: "2099-08-05T09:00:00+10:00", wa_message_id: "SM_out_1"
  });

  // Re-saving the same week must not rewind a live conversation.
  assert.equal((await save([slot({ followup_enabled: true, followup_delay_hours: 8 })])).statusCode, 200);
  const after = store.tables.schedule_state.rows.find(row => row.nudge_id === delivered.nudge_id);
  assert.equal(after.status, "awaiting_followup");
  assert.equal(after.commitment_response, "YES");
  assert.equal(after.followup_due_at, "2099-08-05T13:00:00+10:00",
    "an already-delivered message keeps the promise it made, even after the plan changes");
});

test("the schema, both copies, describe the full two-stage contract", function () {
  const root = JSON.parse(fs.readFileSync(path.join(projectRoot, "lifestyle_nudging_schema.json"), "utf8"));
  const landing = JSON.parse(fs.readFileSync(path.join(projectRoot, "landing/lifestyle_nudging_schema.json"), "utf8"));
  assert.deepEqual(landing, root);

  const state = root.properties.schedule_state.items.properties;
  for (const field of ["commitment_response", "commitment_responded_at", "followup_enabled", "followup_delay_hours",
    "followup_due_at", "followup_sent_at", "followup_wa_id", "outcome_response", "outcome_responded_at", "parent_nudge_id"]) {
    assert.ok(state[field], `schedule_state is missing ${field}`);
  }
  for (const tab of ["nudges", "weekly_schedule"]) {
    assert.ok(root.properties[tab].items.properties.followup_enabled, `${tab} is missing followup_enabled`);
    assert.ok(root.properties[tab].items.properties.followup_delay_hours, `${tab} is missing followup_delay_hours`);
  }
  for (const status of ["awaiting_commitment", "declined", "awaiting_followup", "done", "not_yet", "no_feedback", "opted_out"]) {
    assert.ok(root.$defs.nudge_status.enum.includes(status), `nudge_status is missing ${status}`);
  }
  assert.ok(root.$defs.commitment_response.enum.includes("YES"));
  assert.ok(root.$defs.commitment_response.enum.includes("NO"));
  assert.ok(root.$defs.outcome_response.enum.includes("DONE"));
  assert.ok(root.$defs.outcome_response.enum.includes("NOT_YET"));
  // Both stages must stay separable in the data, not merged into `response`.
  assert.notEqual(root.$defs.commitment_response, root.$defs.outcome_response);
  assert.ok(root.$defs.user_response.enum.includes("NO_FEEDBACK"));
});

test("the delayed check is a feedback event, never a clinician-approved nudge", function () {
  // The `nudges` tab is the record of what a clinician approved, and the outcome
  // check was never reviewed. Previously this was enforced by inspecting each
  // Sheets node; now the scheduler emits operations directly, so assert on those
  // — a stronger check, since it covers every path rather than every node.
  const states = [
    { schedule_id: "sch_1", nudge_id: "ndg_1", user_id: "usr_1", status: "awaiting_followup", commitment_response: "YES", followup_due_at: "2026-08-05T13:00:00+10:00", parent_nudge_id: "ndg_1", sent_at: "2026-08-05T09:00:00+10:00" },
    { schedule_id: "sch_2", nudge_id: "ndg_2", user_id: "usr_1", status: "awaiting_commitment", followup_due_at: "2026-08-05T10:00:00+10:00" }
  ];
  const world = {
    users: [{ user_id: "usr_1", user_status: "active", phone: "+61411111111", name: "Ada" }],
    nudges: { ndg_1: { action_text: "Walk" }, ndg_2: { action_text: "Walk" } },
    now: "2026-08-05T14:00:00+10:00"
  };
  const jobs = planWorkFull(world.users && Object.assign({ states }, world));
  const table = stateTableFor(states);
  const ops = expiryOperations({ jobs, stateTable: table, now: world.now })
    .concat(jobs.filter(j => j.job === "send").map(job => sentOperation({ job, stateTable: table, messageSid: "SM_x", now: world.now })));
  assert.ok(ops.length > 0);
  for (const op of ops) assert.equal(op.tab, "schedule_state", "the scheduler may only ever write schedule_state");

  // The whole prior row is carried forward, so the outcome check reuses its
  // parent rather than minting an id of its own.
  const sendOp = ops.find(op => op.row.followup_wa_id === "SM_x");
  assert.equal(sendOp.row.parent_nudge_id, "ndg_1");

  // Workflow F is now a two-node cron that calls the portal; it holds no
  // credentials and touches no spreadsheet at all.
  assert.equal(scheduler.active, false, "Workflow F ships inactive — activation is a deliberate deployment step");
  assert.equal(scheduler.nodes.filter(item => item.type === "n8n-nodes-base.googleSheets").length, 0,
    "the thin scheduler reaches Sheets only through the portal");
  assert.match(JSON.stringify(scheduler), /\/api\/followup-tick/);
});

test("melbourne timestamps are unambiguous and compared as instants", function () {
  const stamp = followup.melbourneTimestamp(new Date("2026-08-05T03:00:00Z"));
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, "an explicit offset, never a bare local time");
  assert.equal(Date.parse(stamp), Date.parse("2026-08-05T03:00:00Z"));

  // August is +10:00, January is +11:00. String comparison would order these
  // wrongly; Date.parse does not, which is why every predicate uses it.
  assert.match(followup.melbourneTimestamp(new Date("2026-08-05T03:00:00Z")), /\+10:00$/);
  assert.match(followup.melbourneTimestamp(new Date("2026-01-05T03:00:00Z")), /\+11:00$/);

  const due = followup.followupDueAt("2026-08-05T09:00:00+10:00", "4");
  assert.equal(Date.parse(due), Date.parse("2026-08-05T13:00:00+10:00"));
  assert.equal(followup.followupDueAt("2026-08-05T09:00:00+10:00", "2.5"), "");
  assert.equal(followup.followupDueAt("not-a-date", "4"), "");

  // delivered_at is preferred over sent_at once callbacks populate it.
  assert.equal(followup.followupAnchor({ sent_at: "2026-08-05T09:00:00+10:00" }), "2026-08-05T09:00:00+10:00");
  assert.equal(followup.followupAnchor({ sent_at: "2026-08-05T09:00:00+10:00", delivered_at: "2026-08-05T09:00:12+10:00" }), "2026-08-05T09:00:12+10:00");
});
