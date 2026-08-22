"use strict";

// The patient reply path, ported from Workflow C.
//
// Why this is JS and not 31 n8n nodes: the workflow held 242 lines of Code-node
// logic and 75 IF conditions and column mappings. Only the first was testable —
// the test suite extracted jsCode strings and ran them through Function(). The
// STOP bug that overwrote an answered YES lived in a column mapping, invisible
// to every test. Here it is one module with ordinary unit tests.
//
// One structural gain worth stating: every write below is a read-modify-write of
// the WHOLE row (Object.assign onto the existing row), so a field this module
// does not mention keeps its value. n8n's defineBelow mapping wrote every mapped
// column, which is why a blank expression there silently cleared stored data.
// That failure mode cannot occur in this shape.

const { operation } = require("./google-sheets");
const {
  melbourneTimestamp, commitmentFromReply, outcomeFromReply, normalizeReply
} = require("./followup");

const PHONE_RE = /^\+[1-9]\d{7,14}$/;

// Single-stage nudges keep the original three-way prompt. Stage 1 and stage 2
// vocabularies live in followup.js and are reached through commitmentFromReply /
// outcomeFromReply, so the reply vocabulary has exactly one definition.
const PROGRESS_MAP = {
  "DONE": "DONE", "COMPLETED": "DONE",
  "IN PROGRESS": "IN_PROGRESS", "STARTED": "IN_PROGRESS",
  "NOT YET": "NOT_YET", "NOT STARTED": "NOT_YET", "NONE": "NOT_YET", "SKIP": "NOT_YET"
};

// Fixed research enum. Numbers mirror the menu the barrier prompt sends.
const BARRIER_MAP = {
  "1": "stress", "stress": "stress",
  "2": "fatigue", "tired": "fatigue", "fatigue": "fatigue", "exhausted": "fatigue",
  "3": "time", "no time": "time", "busy": "time", "time": "time",
  "4": "goal_too_hard", "too hard": "goal_too_hard", "hard": "goal_too_hard", "difficult": "goal_too_hard",
  "5": "life_event", "life event": "life_event", "life": "life_event",
  "6": "environment", "environment": "environment", "environ": "environment",
  "7": "social", "social": "social",
  "8": "other", "other": "other"
};

const OPEN_STATUSES = ["awaiting_commitment", "awaiting_followup"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function stripChannel(value) {
  return text(value).replace(/^whatsapp:/i, "");
}

// Date.parse, never a string compare: Melbourne moves between +10:00 and +11:00
// and a naive sort would mis-order a pair that straddles the change.
function instant(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : 0;
}

function progressFromReply(value) {
  return PROGRESS_MAP[normalizeReply(value)] || null;
}

function barrierFromReply(value) {
  return BARRIER_MAP[text(value).toLowerCase()] || "other";
}

// ---- Parse ----------------------------------------------------------------

function parseInbound(fields, receivedAt) {
  const payload = fields || {};
  const replyBody = text(payload.Body);
  const buttonPayload = text(payload.ButtonPayload);
  const buttonText = text(payload.ButtonText);
  const replyValue = buttonPayload || buttonText || replyBody;
  const fromPhone = stripChannel(payload.From);
  const waMessageId = text(payload.MessageSid);
  return {
    from_phone: fromPhone,
    to_phone: stripChannel(payload.To),
    reply_body: replyBody,
    reply_value: replyValue,
    button_payload: buttonPayload,
    button_text: buttonText,
    incoming_wa_id: waMessageId,
    context_wa_id: text(payload.OriginalRepliedMessageSid) || null,
    // Present only when Twilio Advanced Opt-Out already handled the keyword. It
    // means the patient is opted out upstream and has already had Twilio's own
    // confirmation, so we must not send a second one.
    opt_out_type: text(payload.OptOutType).toUpperCase(),
    received_at: receivedAt || melbourneTimestamp(),
    valid: PHONE_RE.test(fromPhone) && Boolean(waMessageId)
  };
}

// ---- Resolve --------------------------------------------------------------

function baseResolution(parsed) {
  return Object.assign({}, parsed, {
    canonical_response: null, commitment_response: null, outcome_response: null,
    stage: null, nudge_id: null, schedule_id: null, user_id: text(parsed.user_id) || null,
    previous_response: "", followup_due_at: "", followup_delay_hours: "",
    cancel_rows: [], barrier_tag: null,
    done_count: 0, skip_count: 0, current_streak: 0, consecutive_skips: 0
  });
}

function withRow(parsed, row, stage) {
  return Object.assign(baseResolution(parsed), {
    stage,
    nudge_id: text(row.nudge_id),
    schedule_id: text(row.schedule_id),
    previous_response: text(row.response),
    followup_due_at: text(row.followup_due_at),
    followup_delay_hours: text(row.followup_delay_hours),
    done_count: parseInt(row.done_count, 10) || 0,
    skip_count: parseInt(row.skip_count, 10) || 0,
    current_streak: parseInt(row.current_streak, 10) || 0,
    consecutive_skips: parseInt(row.consecutive_skips, 10) || 0
  });
}

// What a reply to the *initial* message means depends on what that message
// asked, not on where the row has since moved. A two-stage nudge asked "Will you
// do this?", so a reply to it is a stage-1 answer even after the row has advanced
// to awaiting_followup — which is exactly what a second tap on Yes is.
function isTwoStage(row) {
  return ["true", "yes", "1", "on"].includes(text(row.followup_enabled).toLowerCase()) ||
    text(row.status) === "awaiting_commitment" ||
    Boolean(text(row.commitment_response));
}

function resolveReply({ parsed, users, states }) {
  const rows = Array.isArray(states) ? states : [];

  const user = (Array.isArray(users) ? users : [])
    .find(candidate => text(candidate.phone) === parsed.from_phone);
  if (!user) return Object.assign(baseResolution(parsed), { reply_type: "unknown_patient" });

  const identified = Object.assign({}, parsed, {
    user_id: text(user.user_id), user_status: text(user.user_status)
  });

  // Webhook retries replay the same MessageSid. Checked first so a retry can
  // never re-run a state transition, in either stage.
  if (rows.some(row => text(row.response_wa_id) === parsed.incoming_wa_id)) {
    return Object.assign(baseResolution(identified), { reply_type: "duplicate" });
  }

  const userRows = rows.filter(row => text(row.user_id) === identified.user_id);
  const value = normalizeReply(parsed.reply_value);

  // STOP is the mandatory ethics opt-out and outranks everything else. It cancels
  // every question still open, so no scheduler pass can deliver a follow-up after
  // the patient has asked to stop.
  if (value === "STOP" || parsed.opt_out_type === "STOP") {
    // Each cancelled row carries its stage and prior answers. An awaiting_followup
    // row ALREADY answered the commitment; overwriting that would make a YES cut
    // short by STOP indistinguishable from one never given.
    const cancel = userRows
      .filter(row => OPEN_STATUSES.includes(text(row.status)))
      .map(row => ({
        nudge_id: text(row.nudge_id),
        status: text(row.status),
        prior_commitment: text(row.commitment_response),
        prior_outcome: text(row.outcome_response)
      }))
      .filter(row => row.nudge_id);
    // Twilio Advanced Opt-Out has already replied; a second acknowledgement would
    // double-message someone who just asked to stop.
    const replyType = parsed.opt_out_type === "STOP" ? "stop_optout" : "stop";
    return Object.assign(baseResolution(identified), { reply_type: replyType, cancel_rows: cancel });
  }

  // An explicit WhatsApp reply names the message it answers, so context is matched
  // most-specific first: the outcome check, then the barrier prompt, then the
  // initial nudge.
  const ctx = parsed.context_wa_id;
  const ctxOutcome = ctx ? userRows.find(row => text(row.followup_wa_id) === ctx) : null;
  const ctxBarrier = ctx ? userRows.find(row => text(row.barrier_followup_wa_id) === ctx) : null;
  const ctxInitial = ctx ? userRows.find(row => text(row.wa_message_id) === ctx) : null;

  // Without context, the patient is answering whichever question was asked most
  // recently. `asked` is when that specific question went out, not the row's last
  // touch, so a stale barrier cannot outrank a fresh outcome check.
  const open = [];
  userRows.forEach(row => {
    const status = text(row.status);
    if (status === "awaiting_followup" && text(row.followup_sent_at) && !text(row.outcome_response)) {
      open.push({ row, stage: "outcome", asked: instant(row.followup_sent_at) });
    }
    if (status === "awaiting_commitment" && !text(row.commitment_response)) {
      open.push({ row, stage: "commitment", asked: instant(row.sent_at) });
    }
    if (["sent", "in_progress", "not_yet"].includes(status) && text(row.wa_message_id)) {
      open.push({ row, stage: "progress", asked: instant(row.sent_at) || instant(row.last_updated) });
    }
  });
  open.sort((a, b) => b.asked - a.asked);

  let target = null;
  if (ctxOutcome) target = { row: ctxOutcome, stage: "outcome" };
  else if (ctxBarrier) target = { row: ctxBarrier, stage: "barrier" };
  else if (ctxInitial) target = { row: ctxInitial, stage: isTwoStage(ctxInitial) ? "commitment" : "progress" };
  else target = open[0] || null;

  if (target && target.stage === "barrier") {
    return Object.assign(withRow(identified, target.row, "barrier"), {
      reply_type: "barrier", barrier_tag: barrierFromReply(parsed.reply_body || parsed.reply_value)
    });
  }

  if (target && target.stage === "commitment") {
    // Already answered: refresh idempotency only. Never re-derive followup_due_at,
    // or a second Yes would arm a second follow-up.
    if (text(target.row.commitment_response)) {
      return Object.assign(withRow(identified, target.row, "commitment"), {
        reply_type: "commitment_repeat", commitment_response: text(target.row.commitment_response)
      });
    }
    const commitment = commitmentFromReply(parsed.reply_value);
    if (commitment === "YES") {
      return Object.assign(withRow(identified, target.row, "commitment"), { reply_type: "commit_yes", commitment_response: "YES" });
    }
    if (commitment === "NO") {
      return Object.assign(withRow(identified, target.row, "commitment"), { reply_type: "commit_no", commitment_response: "NO" });
    }
  }

  if (target && target.stage === "outcome") {
    const outcome = outcomeFromReply(parsed.reply_value);
    if (outcome === "DONE") {
      return Object.assign(withRow(identified, target.row, "outcome"), { reply_type: "done", canonical_response: "DONE", outcome_response: "DONE" });
    }
    if (outcome === "NOT_YET") {
      return Object.assign(withRow(identified, target.row, "outcome"), { reply_type: "not_yet", canonical_response: "NOT_YET", outcome_response: "NOT_YET" });
    }
  }

  if (target && target.stage === "progress") {
    const progress = progressFromReply(parsed.reply_value);
    if (progress === "DONE") {
      return Object.assign(withRow(identified, target.row, "progress"), { reply_type: "done", canonical_response: "DONE" });
    }
    if (progress === "IN_PROGRESS") {
      return Object.assign(withRow(identified, target.row, "progress"), { reply_type: "in_progress", canonical_response: "IN_PROGRESS" });
    }
    if (progress === "NOT_YET") {
      return Object.assign(withRow(identified, target.row, "progress"), { reply_type: "not_yet", canonical_response: "NOT_YET" });
    }
  }

  // A barrier prompt is still outstanding and the reply matches nothing in the
  // current stage — that is the barrier answer.
  const pendingBarrier = userRows
    .filter(row => text(row.barrier_followup_wa_id))
    .sort((a, b) => instant(b.last_updated) - instant(a.last_updated))[0] || null;
  if (pendingBarrier) {
    return Object.assign(withRow(identified, pendingBarrier, "barrier"), {
      reply_type: "barrier", barrier_tag: barrierFromReply(parsed.reply_body || parsed.reply_value)
    });
  }

  return Object.assign(baseResolution(identified), { reply_type: "unknown" });
}

// ---- Apply ----------------------------------------------------------------

function applyReply({ resolution, stateTable, userTable, now }) {
  const stamp = now || melbourneTimestamp();
  const stateRows = (stateTable && stateTable.rows) || [];
  const findState = nudgeId => stateRows.find(row => text(row.nudge_id) === text(nudgeId));
  const operations = [];
  const type = resolution.reply_type;

  const writeState = (existing, changes) => {
    if (!existing) return false;
    const next = Object.assign({}, existing, changes, { last_updated: stamp });
    operations.push(operation("schedule_state", stateTable, next, existing));
    return true;
  };

  if (type === "duplicate") return { operations: [], applied: false, note: "duplicate" };
  if (type === "unknown_patient") return { operations: [], applied: false, note: "unknown_patient" };
  if (type === "unknown") return { operations: [], applied: false, note: "no_match" };

  if (type === "stop" || type === "stop_optout") {
    const userRows = (userTable && userTable.rows) || [];
    const user = userRows.find(row => text(row.user_id) === text(resolution.user_id));
    if (user) {
      operations.push(operation("user", userTable, Object.assign({}, user, { user_status: "opted_out" }), user));
    }
    // What counts as "unanswered" depends on the stage the STOP interrupted.
    (resolution.cancel_rows || []).forEach(entry => {
      const existing = findState(entry.nudge_id);
      const wasOutcomeStage = entry.status === "awaiting_followup";
      writeState(existing, {
        status: "opted_out",
        followup_due_at: "",
        commitment_response: wasOutcomeStage ? entry.prior_commitment : "NO_FEEDBACK",
        outcome_response: wasOutcomeStage ? "NO_FEEDBACK" : entry.prior_outcome
      });
    });
    return { operations, applied: operations.length > 0, note: operations.length ? "" : "no_open_rows" };
  }

  const existing = findState(resolution.nudge_id);
  if (!existing) return { operations: [], applied: false, note: "no_match" };
  const isOutcomeStage = resolution.stage === "outcome";

  if (type === "commit_yes" || type === "commit_no") {
    const yes = type === "commit_yes";
    writeState(existing, Object.assign({
      status: yes ? "awaiting_followup" : "declined",
      commitment_response: yes ? "YES" : "NO",
      commitment_responded_at: resolution.received_at,
      response_wa_id: resolution.incoming_wa_id,
      last_response_at: resolution.received_at
    // A Yes must NOT touch followup_due_at: it was anchored to delivery by
    // Workflow B, and re-deriving it here would restart the clock on a late Yes.
    // A No clears it, because nothing is left to check on.
    }, yes ? {} : { followup_due_at: "" }));
    return { operations, applied: true, note: "" };
  }

  if (type === "commitment_repeat") {
    writeState(existing, { response_wa_id: resolution.incoming_wa_id });
    return { operations, applied: true, note: "repeat" };
  }

  if (type === "done") {
    const repeat = resolution.previous_response === "DONE";
    writeState(existing, Object.assign({
      status: "done",
      // `response` is written for both stages on purpose: the Monitor and
      // Workflow D aggregate on it, so a two-stage completion must still appear
      // there. outcome_response is what distinguishes the stages.
      response: "DONE",
      response_wa_id: resolution.incoming_wa_id,
      responded_at: resolution.received_at,
      last_response_at: resolution.received_at,
      done_count: repeat ? resolution.done_count : resolution.done_count + 1,
      current_streak: repeat ? resolution.current_streak : resolution.current_streak + 1,
      consecutive_skips: 0
    }, isOutcomeStage ? { outcome_response: "DONE", outcome_responded_at: resolution.received_at } : {}));
    return { operations, applied: true, note: "" };
  }

  if (type === "in_progress") {
    writeState(existing, {
      status: "in_progress",
      response: "IN_PROGRESS",
      response_wa_id: resolution.incoming_wa_id,
      responded_at: resolution.received_at,
      last_response_at: resolution.received_at
    });
    return { operations, applied: true, note: "" };
  }

  if (type === "not_yet") {
    const repeat = ["NOT_YET", "SKIP"].includes(resolution.previous_response);
    writeState(existing, Object.assign({
      status: "not_yet",
      response: "NOT_YET",
      response_wa_id: resolution.incoming_wa_id,
      responded_at: resolution.received_at,
      last_response_at: resolution.received_at,
      skip_count: repeat ? resolution.skip_count : resolution.skip_count + 1,
      current_streak: 0,
      consecutive_skips: repeat ? resolution.consecutive_skips : resolution.consecutive_skips + 1
    }, isOutcomeStage ? { outcome_response: "NOT_YET", outcome_responded_at: resolution.received_at } : {}));
    return { operations, applied: true, note: "" };
  }

  if (type === "barrier") {
    writeState(existing, {
      barrier_tag: resolution.barrier_tag || "other",
      // The prompt has been answered, so it is no longer outstanding.
      barrier_followup_wa_id: "",
      response_wa_id: resolution.incoming_wa_id,
      last_response_at: resolution.received_at
    });
    return { operations, applied: true, note: "" };
  }

  return { operations: [], applied: false, note: "no_match" };
}

// Records the SID of the barrier question we just sent, so the patient's next
// message can be recognised as its answer.
function barrierPromptOperation({ resolution, stateTable, messageSid, now }) {
  if (resolution.reply_type !== "not_yet" || !text(messageSid)) return null;
  const existing = ((stateTable && stateTable.rows) || [])
    .find(row => text(row.nudge_id) === text(resolution.nudge_id));
  if (!existing) return null;
  return operation("schedule_state", stateTable, Object.assign({}, existing, {
    barrier_followup_wa_id: text(messageSid),
    last_updated: now || melbourneTimestamp()
  }), existing);
}

// ---- Confirm --------------------------------------------------------------

// Deterministic acknowledgements, sent inside the patient-opened 24-hour window.
// No LLM runs in the reply path — that is an architectural rule, not an omission.
function confirmationFor(resolution) {
  const hours = text(resolution.followup_delay_hours);
  const messages = {
    commit_yes: "Great — noted. I will check back" + (hours ? " in about " + hours + " hour(s)" : " later") + " to see how it went.",
    commit_no: "Thanks for letting me know. No check-in for this one.",
    commitment_repeat: "Thanks — already noted. I will still check back later.",
    done: "Thanks — your progress has been marked as Done.",
    in_progress: "Thanks — your progress has been marked as In progress. Tap Done when you complete it.",
    not_yet: "Thanks — your progress has been marked as Not yet. What got in the way?\n\n1 = Stress\n2 = Tired or fatigued\n3 = Not enough time\n4 = Goal too hard\n5 = Life event\n6 = Environment\n7 = Social\n8 = Other\n\nReply with a number or keyword.",
    barrier: "Thanks — your response has been recorded.",
    stop: "You have been opted out. You will not receive any more health-plan messages.",
    unknown: "Please tap one of the buttons on the latest check-in. You can also type STOP at any time."
  };
  // stop_optout, duplicate and unknown_patient are absent on purpose: Twilio has
  // already confirmed the first, and the other two must stay silent so a retry or
  // a wrong number never messages anyone.
  return messages[resolution.reply_type] || null;
}

module.exports = {
  PROGRESS_MAP, BARRIER_MAP, OPEN_STATUSES,
  parseInbound, resolveReply, applyReply, barrierPromptOperation, confirmationFor,
  progressFromReply, barrierFromReply, isTwoStage
};
