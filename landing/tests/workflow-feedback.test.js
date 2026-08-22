const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const readJson = relative => JSON.parse(fs.readFileSync(path.join(projectRoot, relative), "utf8"));
const delivery = readJson("workflows/workflow_b_delivery_twilio.json");

// Workflow C's reply logic moved into api/_lib/feedback-store.js. These tests
// follow it there: the workflow JSON stays in the repo as recoverable history,
// but asserting against it would protect code that no longer runs.
const {
  parseInbound, resolveReply, applyReply
} = require("../api/_lib/feedback-store");
const { HEADERS } = require("./sheets-fixture");

function node(workflow, name) {
  const result = workflow.nodes.find(item => item.name === name);
  assert.ok(result, `Missing workflow node: ${name}`);
  return result;
}

function runCode(code, globals) {
  const names = Object.keys(globals);
  const values = Object.values(globals);
  return Function(...names, code)(...values);
}

function classify(resolved, rows) {
  const full = Object.assign({ from_phone: "+61412345678", incoming_wa_id: "SM_in_default", opt_out_type: "" }, resolved);
  const users = [{ user_id: full.user_id, phone: full.from_phone, user_status: full.user_status || "active" }];
  return resolveReply({ parsed: full, users, states: rows });
}

// The schedule_state row a resolution actually writes.
function writeFor(resolution, rows) {
  const stateTable = {
    headers: HEADERS.schedule_state.slice(),
    rows: rows.map((row, index) => Object.assign({ row_number: index + 2 }, row))
  };
  const out = applyReply({
    resolution, stateTable,
    userTable: { headers: ["user_id", "user_status"], rows: [] },
    now: "2026-08-05T14:00:00+10:00"
  });
  const op = out.operations.find(item => item.tab === "schedule_state");
  return op ? op.row : null;
}

test("delivery uses the quick-reply Content SID and two safe variables", () => {
  const code = node(delivery, "Build Twilio Requests").parameters.jsCode;
  const result = runCode(code, {
    items: [{ json: { recipient_phone: "+61412345678", recipient_name: "Alex", message_body: "Take a ten-minute walk." } }],
    $env: {
      TWILIO_ACCOUNT_SID: "AC11111111111111111111111111111111",
      TWILIO_AUTH_TOKEN: "secret",
      TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
      TWILIO_CONTENT_SID: "HX22222222222222222222222222222222"
    },
    Buffer
  })[0].json;

  const form = new URLSearchParams(result.twilio_form);
  assert.equal(result.twilio_mode, "quick_reply");
  assert.equal(form.get("ContentSid"), "HX22222222222222222222222222222222");
  assert.equal(form.get("To"), "whatsapp:+61412345678");
  assert.deepEqual(JSON.parse(form.get("ContentVariables")), {
    1: "Alex",
    2: "Take a ten-minute walk."
  });
  assert.equal(form.has("Body"), false);
});

test("Twilio parser prefers stable ButtonPayload over visible text and Body", () => {
  const result = parseInbound({
    From: "whatsapp:+61412345678",
    To: "whatsapp:+14155238886",
    Body: "In progress",
    ButtonText: "In progress",
    ButtonPayload: "IN_PROGRESS",
    MessageSid: "SM11111111111111111111111111111111",
    OriginalRepliedMessageSid: "SM22222222222222222222222222222222"
  });

  assert.equal(result.from_phone, "+61412345678");
  assert.equal(result.reply_value, "IN_PROGRESS");
  assert.equal(result.context_wa_id, "SM22222222222222222222222222222222");
});

test("button response correlates through OriginalRepliedMessageSid", () => {
  const result = classify({
    user_id: "usr_1",
    reply_value: "IN_PROGRESS",
    incoming_wa_id: "SM_in_1",
    context_wa_id: "SM_out_1"
  }, [{
    user_id: "usr_1",
    nudge_id: "ndg_1",
    schedule_id: "sch_1",
    status: "sent",
    wa_message_id: "SM_out_1"
  }]);

  assert.equal(result.reply_type, "in_progress");
  assert.equal(result.canonical_response, "IN_PROGRESS");
  assert.equal(result.nudge_id, "ndg_1");
});

test("typed response without reply context uses the newest outstanding nudge", () => {
  const result = classify({
    user_id: "usr_1",
    reply_value: "not yet",
    incoming_wa_id: "SM_in_2",
    context_wa_id: null
  }, [
    { user_id: "usr_1", nudge_id: "older", schedule_id: "sch_old", status: "sent", wa_message_id: "SM_old", sent_at: "2026-07-28T01:00:00Z" },
    { user_id: "usr_1", nudge_id: "newer", schedule_id: "sch_new", status: "sent", wa_message_id: "SM_new", sent_at: "2026-07-28T02:00:00Z" },
    { user_id: "usr_2", nudge_id: "other", schedule_id: "sch_other", status: "sent", wa_message_id: "SM_other", sent_at: "2026-07-28T03:00:00Z" }
  ]);

  assert.equal(result.reply_type, "not_yet");
  assert.equal(result.canonical_response, "NOT_YET");
  assert.equal(result.nudge_id, "newer");
});

test("legacy aliases, barrier replies, STOP, and duplicate webhooks are deterministic", () => {
  const row = {
    user_id: "usr_1",
    nudge_id: "ndg_1",
    schedule_id: "sch_1",
    status: "not_yet",
    wa_message_id: "SM_out_1",
    barrier_followup_wa_id: "SM_barrier_1",
    sent_at: "2026-07-28T02:00:00Z"
  };

  assert.equal(classify({ user_id: "usr_1", reply_value: "NONE", incoming_wa_id: "SM_a", context_wa_id: null }, [row]).canonical_response, "NOT_YET");
  assert.equal(classify({ user_id: "usr_1", reply_value: "3", reply_body: "3", incoming_wa_id: "SM_b", context_wa_id: null }, [row]).reply_type, "barrier");
  assert.equal(classify({ user_id: "usr_1", reply_value: "STOP", incoming_wa_id: "SM_c", context_wa_id: null }, [row]).reply_type, "stop");
  assert.equal(classify({ user_id: "usr_1", reply_value: "DONE", incoming_wa_id: "SM_seen", context_wa_id: null }, [{ ...row, response_wa_id: "SM_seen" }]).reply_type, "duplicate");
});

test("state updates guard counters against repeated equivalent responses", () => {
  // Asserted as produced values now, not as template strings: a re-answer that
  // says the same thing must not inflate the adherence counters the evaluation
  // chapter reports.
  const base = {
    user_id: "usr_1", nudge_id: "ndg_1", schedule_id: "sch_1", status: "sent",
    wa_message_id: "SM_out_1", sent_at: "2026-08-05T09:00:00+10:00",
    done_count: 3, skip_count: 2, current_streak: 4, consecutive_skips: 1
  };

  const freshDone = writeFor(classify({ user_id: "usr_1", reply_value: "DONE", incoming_wa_id: "SM_a", context_wa_id: "SM_out_1" }, [base]), [base]);
  assert.equal(freshDone.done_count, 4);
  assert.equal(freshDone.current_streak, 5);
  assert.equal(freshDone.consecutive_skips, 0);
  assert.equal(freshDone.response_wa_id, "SM_a");

  const repeatRow = Object.assign({}, base, { response: "DONE" });
  const repeatDone = writeFor(classify({ user_id: "usr_1", reply_value: "DONE", incoming_wa_id: "SM_b", context_wa_id: "SM_out_1" }, [repeatRow]), [repeatRow]);
  assert.equal(repeatDone.done_count, 3, "saying DONE twice counts once");
  assert.equal(repeatDone.current_streak, 4);

  const skipRow = Object.assign({}, base, { response: "NOT_YET" });
  const repeatSkip = writeFor(classify({ user_id: "usr_1", reply_value: "NOT YET", incoming_wa_id: "SM_c", context_wa_id: "SM_out_1" }, [skipRow]), [skipRow]);
  assert.equal(repeatSkip.skip_count, 2, "saying NOT_YET twice counts once");
  assert.equal(repeatSkip.consecutive_skips, 1);
  assert.equal(repeatSkip.current_streak, 0);
});

test("schema copies stay equal and expose the new response contract", () => {
  const rootSchema = readJson("lifestyle_nudging_schema.json");
  const landingSchema = readJson("landing/lifestyle_nudging_schema.json");
  assert.deepEqual(landingSchema, rootSchema);
  assert.ok(rootSchema.$defs.user_response.enum.includes("IN_PROGRESS"));
  assert.ok(rootSchema.$defs.user_response.enum.includes("NOT_YET"));
  assert.ok(rootSchema.$defs.nudge_status.enum.includes("in_progress"));
  assert.ok(rootSchema.$defs.nudge_status.enum.includes("not_yet"));
  assert.ok(rootSchema.properties.schedule_state.items.properties.response_wa_id);
});
