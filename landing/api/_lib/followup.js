"use strict";

// Two-stage nudge feedback: commitment ("Will you do this?") then, after a
// clinician-set delay, an outcome check ("Were you able to complete it?").
//
// Why two stages at all: a single Done/Not yet prompt sent at nudge time measures
// intention, not behaviour, because the patient has not had the chance to act yet.
// Splitting the exchange separates intention (commitment_response) from execution
// (outcome_response), which is exactly the COM-B "opportunity/capability" gap the
// thesis is about. Compressing them back into one field would destroy that
// distinction, so nothing here ever writes one from the other.
//
// This module is the single source of truth for the server and the browser. The
// n8n workflows re-implement the same rules inside their Code nodes because they
// cannot require() from this repo; tests extract that jsCode and run it against
// the same cases, so the two implementations are checked independently rather
// than assumed to agree.
const { httpError } = require("./http");

const FOLLOWUP_MIN_HOURS = 1;
const FOLLOWUP_MAX_HOURS = 72;
// Offered as one-tap choices in the Monitor; any whole number in range is still
// accepted, so these are convenience only and carry no special meaning.
const FOLLOWUP_PRESET_HOURS = [1, 2, 4, 8, 12, 24];
// How long stage 2 stays open before the silence is recorded as NO_FEEDBACK.
const FOLLOWUP_OUTCOME_WINDOW_HOURS = 24;

// Only a nudge that asks the patient to *do* something can be committed to.
// "Will you do this?" under an affirmation ("Great work this week") or a
// reflection ("What changed?") is a category error, so the clinician control is
// refused there rather than silently producing a nonsensical exchange.
const ACTIONABLE_NUDGE_TYPES = new Set(["reminder", "challenge"]);

const COMMITMENT_RESPONSES = new Set(["YES", "NO", "NO_FEEDBACK"]);
const OUTCOME_RESPONSES = new Set(["DONE", "NOT_YET", "NO_FEEDBACK"]);

const HOUR_MS = 3600000;
const WHOLE_NUMBER_RE = /^\d+$/;

function text(value) {
  return String(value == null ? "" : value).trim();
}

// Sheets round-trips this as the literal string "TRUE"/"FALSE", the browser sends
// a real boolean, and a hand-edited cell may hold "yes" or 1. All three mean the
// same thing to a clinician, so all three are accepted on the way in; only the
// canonical TRUE/FALSE is ever written back out.
function isFollowupEnabled(value) {
  const clean = text(value).toLowerCase();
  return clean === "true" || clean === "yes" || clean === "1" || clean === "on";
}

function isActionableNudgeType(value) {
  return ACTIONABLE_NUDGE_TYPES.has(text(value));
}

// Returns the two config fields exactly as they should be written, or throws a
// 400 the Monitor can show verbatim. Delay is only meaningful when the switch is
// on, so it is required there and forced blank otherwise — a stale "4" left
// behind on a disabled slot would be a trap for the next reader.
function assertFollowup(slot, label, nudgeType) {
  if (!isFollowupEnabled(slot && slot.followup_enabled)) {
    return { followup_enabled: "FALSE", followup_delay_hours: "" };
  }
  if (!isActionableNudgeType(nudgeType)) {
    throw httpError(400, `${label}: an outcome follow-up can only be set on an actionable nudge (${[...ACTIONABLE_NUDGE_TYPES].sort().join(" or ")})`);
  }
  const raw = text(slot.followup_delay_hours);
  if (!raw) throw httpError(400, `${label}.followup_delay_hours is required when the outcome follow-up is on`);
  // Rejects "2.5", "-1", "1e2" and " " in one test. A bare 0 passes the shape
  // check and is caught by the range below, so its message names the real problem.
  if (!WHOLE_NUMBER_RE.test(raw)) {
    throw httpError(400, `${label}.followup_delay_hours must be a whole number of hours`);
  }
  const hours = Number(raw);
  if (hours < FOLLOWUP_MIN_HOURS || hours > FOLLOWUP_MAX_HOURS) {
    throw httpError(400, `${label}.followup_delay_hours must be between ${FOLLOWUP_MIN_HOURS} and ${FOLLOWUP_MAX_HOURS} hours`);
  }
  return { followup_enabled: "TRUE", followup_delay_hours: String(hours) };
}

// ---- Timestamps ----------------------------------------------------------
// Everything the two-stage flow compares is an *instant*, so it is stored as ISO
// 8601 with an explicit offset and always compared through Date.parse. Melbourne
// shifts between +10:00 and +11:00, so string-comparing these would silently
// mis-order a pair that straddles a DST change — the one trap worth spelling out.
function melbourneOffset(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Melbourne", timeZoneName: "longOffset"
  }).formatToParts(date);
  const name = (parts.find(part => part.type === "timeZoneName") || {}).value || "GMT+10:00";
  return name.replace(/^GMT/, "") || "+00:00";
}

function melbourneTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}:${value.second}${melbourneOffset(date)}`;
}

function instant(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : null;
}

// The initial message's real delivery time when Twilio has reported one, and its
// accepted-for-send time otherwise. delivered_at stays blank until delivery-status
// callbacks land (build order step 3), so today this always resolves to sent_at.
function followupAnchor(state) {
  return text(state && state.delivered_at) || text(state && state.sent_at);
}

// due = anchor + delay. Computed once, at delivery, not when the patient answers:
// that is what makes a late YES immediately eligible instead of restarting the
// clock and asking about an action the patient has already had time to finish.
function followupDueAt(anchorIso, hours) {
  const anchorMs = instant(anchorIso);
  const raw = text(hours);
  if (anchorMs == null || !WHOLE_NUMBER_RE.test(raw)) return "";
  const value = Number(raw);
  if (value < FOLLOWUP_MIN_HOURS || value > FOLLOWUP_MAX_HOURS) return "";
  return melbourneTimestamp(new Date(anchorMs + value * HOUR_MS));
}

// ---- Scheduler predicates ------------------------------------------------
// Every guard here is independent, so STOP breaking any one of them is enough to
// stop a delivery even if another is somehow stale.
function followupEligible(state, nowIso) {
  const now = instant(nowIso);
  const due = instant(state && state.followup_due_at);
  if (now == null || due == null) return false;
  if (text(state.status) !== "awaiting_followup") return false;
  if (text(state.commitment_response) !== "YES") return false;
  // The claim check. A second scheduler execution overlapping the first finds
  // these populated and skips, so the outcome check is sent exactly once.
  if (text(state.followup_sent_at) || text(state.followup_wa_id)) return false;
  if (text(state.outcome_response)) return false;
  return due <= now;
}

// Stage 1 expiry deliberately reuses followup_due_at rather than a second window:
// if the patient has not committed by the time the outcome check would have gone
// out, there is nothing left to check on.
function commitmentExpired(state, nowIso) {
  const now = instant(nowIso);
  const due = instant(state && state.followup_due_at);
  if (now == null || due == null) return false;
  if (text(state.status) !== "awaiting_commitment") return false;
  if (text(state.commitment_response)) return false;
  return due <= now;
}

function outcomeExpired(state, nowIso, windowHours = FOLLOWUP_OUTCOME_WINDOW_HOURS) {
  const now = instant(nowIso);
  const sent = instant(state && state.followup_sent_at);
  if (now == null || sent == null) return false;
  if (text(state.status) !== "awaiting_followup") return false;
  if (text(state.outcome_response)) return false;
  return sent + Number(windowHours) * HOUR_MS <= now;
}

// ---- Inbound reply mapping -----------------------------------------------
// Twilio gives a stable ButtonPayload, the visible ButtonText, or free text the
// patient typed. All three land here so the accessibility fallback (typing "yes")
// behaves identically to tapping the button.
function normalizeReply(value) {
  return text(value).toUpperCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const COMMITMENT_MAP = {
  "YES": "YES", "Y": "YES", "YEP": "YES", "YEAH": "YES", "OK": "YES", "OKAY": "YES",
  "I WILL": "YES", "YES I WILL": "YES", "COMMIT": "YES",
  "NO": "NO", "N": "NO", "NOPE": "NO", "CANT": "NO", "CAN'T": "NO", "NOT TODAY": "NO", "NO I WONT": "NO"
};

const OUTCOME_MAP = {
  "DONE": "DONE", "COMPLETED": "DONE", "YES": "DONE", "Y": "DONE", "FINISHED": "DONE",
  "NOT YET": "NOT_YET", "NOTYET": "NOT_YET", "NO": "NOT_YET", "N": "NOT_YET",
  "NOT STARTED": "NOT_YET", "NONE": "NOT_YET", "SKIP": "NOT_YET"
};

function commitmentFromReply(value) {
  return COMMITMENT_MAP[normalizeReply(value)] || null;
}

function outcomeFromReply(value) {
  return OUTCOME_MAP[normalizeReply(value)] || null;
}

module.exports = {
  FOLLOWUP_MIN_HOURS, FOLLOWUP_MAX_HOURS, FOLLOWUP_PRESET_HOURS, FOLLOWUP_OUTCOME_WINDOW_HOURS,
  ACTIONABLE_NUDGE_TYPES, COMMITMENT_RESPONSES, OUTCOME_RESPONSES,
  isFollowupEnabled, isActionableNudgeType, assertFollowup,
  melbourneTimestamp, followupAnchor, followupDueAt,
  followupEligible, commitmentExpired, outcomeExpired,
  normalizeReply, commitmentFromReply, outcomeFromReply
};
