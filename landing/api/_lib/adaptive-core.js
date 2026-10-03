"use strict";

const crypto = require("node:crypto");
const { PILLARS, CATEGORIES, assertAction } = require("./taxonomy");
const { httpError } = require("./http");

const FORMATS = new Set(["video", "paper", "reading"]);
const SUMMARY_LENGTHS = new Set(["short", "detailed"]);
const TONES = new Set(["encouraging", "neutral_informational"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PILLAR_TERMS = {
  nutrition: "nutrition healthy eating diet",
  physical_activity: "physical activity exercise movement",
  sleep: "sleep sleep hygiene",
  stress_management: "stress management relaxation mindfulness",
  substance_use: "substance use smoking alcohol cessation",
  social_connection: "social connection loneliness relationships"
};
const CATEGORY_TERMS = {
  increase: "increase improve more",
  reduce: "reduce lower less",
  maintain: "maintain sustain ongoing",
  avoid: "avoid prevention prevent",
  establish: "establish routine habit"
};

function clean(value) { return String(value == null ? "" : value).trim(); }
function unique(values) { return Array.from(new Set(values)); }

function behaviour(input) {
  const actionText = assertAction(input && input.action_text, "action_text");
  const pillar = clean(input && input.pillar);
  const category = clean(input && input.category);
  if (!PILLARS.has(pillar)) throw httpError(400, "pillar is invalid");
  if (!CATEGORIES.has(category)) throw httpError(400, "category is invalid");
  return { action_text: actionText, pillar, category };
}

function behaviourKey(input) {
  const value = behaviour(input);
  return crypto.createHash("sha256").update([value.action_text.toLowerCase(), value.pillar, value.category].join("|"))
    .digest("hex").slice(0, 32);
}

function querySet(input) {
  const value = behaviour(input);
  const anchor = PILLAR_TERMS[value.pillar];
  const actionTerms = unique(value.action_text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(token => token.length > 2));
  const categoryTerms = CATEGORY_TERMS[value.category] || value.category;
  const broadAction = actionTerms.join(" OR ");
  return {
    behaviour_key: behaviourKey(value),
    video: `\"${value.action_text}\" ${anchor} patient education ${value.category}`,
    video_fallback: `(${broadAction}) ${anchor} patient education (${categoryTerms})`,
    paper: `\"${value.action_text}\" AND (${anchor.split(" ").join(" OR ")})`,
    paper_fallback: `(${broadAction}) AND (${anchor.split(" ").join(" OR ")}) AND (${categoryTerms.split(" ").join(" OR ")})`,
    terms: unique([value.action_text.toLowerCase(), value.pillar.replace(/_/g, " "), value.category])
  };
}

function tokenOverlap(candidate, terms) {
  const haystack = `${clean(candidate.title)} ${clean(candidate.description)} ${clean(candidate.abstract)}`.toLowerCase();
  const tokens = unique(terms.flatMap(term => term.split(/[^a-z0-9]+/)).filter(token => token.length > 2));
  return tokens.length ? tokens.filter(token => haystack.includes(token)).length / tokens.length : 0;
}

function rankCandidate(candidate, context) {
  const reasons = [];
  let score = Math.round(tokenOverlap(candidate, context.terms) * 50);
  if (candidate.trusted) { score += 25; reasons.push("trusted_source"); }
  if (candidate.open_access) { score += 12; reasons.push("open_access"); }
  if (candidate.patient_suitable) { score += 8; reasons.push("patient_suitable"); }
  if (candidate.published_at && Date.parse(candidate.published_at) > Date.now() - 10 * 365.25 * 86400000) {
    score += 5; reasons.push("recent_ten_years");
  }
  reasons.push(`taxonomy_overlap_${Math.round(tokenOverlap(candidate, context.terms) * 100)}`);
  return Object.assign({}, candidate, { ranking_score: score, ranking_reasons: reasons });
}

function selectPool(candidates) {
  const sorted = candidates.slice().sort((a, b) => Number(b.ranking_score) - Number(a.ranking_score));
  const video = sorted.find(item => item.media_kind === "video");
  const paper = sorted.find(item => item.media_kind === "paper" && item.open_access);
  const reading = sorted.find(item => item.media_kind === "reading" || (item.media_kind === "paper" && item !== paper));
  return [video, paper, reading].filter(Boolean);
}

function validateSummary(value) {
  const summary = value && typeof value === "object" ? value : {};
  const wordCount = text => clean(text).split(/\s+/).filter(Boolean).length;
  if (!clean(summary.source_title) || !/^https:\/\//.test(clean(summary.original_url))) throw httpError(422, "summary source is invalid");
  if (wordCount(summary.short_summary) > 60) throw httpError(422, "short summary exceeds 60 words");
  if (wordCount(summary.detailed_summary) > 120) throw httpError(422, "detailed summary exceeds 120 words");
  return {
    short_summary: clean(summary.short_summary), detailed_summary: clean(summary.detailed_summary),
    limitations: clean(summary.limitations), source_title: clean(summary.source_title), original_url: clean(summary.original_url)
  };
}

function defaultEnvelope(input) {
  const value = behaviour(input);
  const time = TIME_RE.test(clean(input.scheduled_time)) ? clean(input.scheduled_time) : "09:00";
  const frequency = Math.max(1, Math.min(7, Number(input.frequency_per_week) || 1));
  return {
    action_text: value.action_text, pillar: value.pillar, category: value.category,
    formats: ["video", "paper", "reading"], summary_lengths: ["short", "detailed"],
    tones: ["encouraging", "neutral_informational"], earliest_time: time, latest_time: time,
    frequency_min: frequency, frequency_max: frequency, action_alternatives: [value.action_text]
  };
}

function validateEnvelope(input) {
  const base = defaultEnvelope(input);
  const formats = unique((input.formats || base.formats).map(clean));
  const lengths = unique((input.summary_lengths || base.summary_lengths).map(clean));
  const tones = unique((input.tones || base.tones).map(clean));
  if (!formats.length || formats.some(value => !FORMATS.has(value))) throw httpError(400, "formats are invalid");
  if (!lengths.length || lengths.some(value => !SUMMARY_LENGTHS.has(value))) throw httpError(400, "summary_lengths are invalid");
  if (!tones.length || tones.some(value => !TONES.has(value))) throw httpError(400, "tones are invalid");
  const earliest = clean(input.earliest_time || base.earliest_time);
  const latest = clean(input.latest_time || base.latest_time);
  if (!TIME_RE.test(earliest) || !TIME_RE.test(latest) || earliest > latest) throw httpError(400, "allowed time window is invalid");
  const min = Number(input.frequency_min == null ? base.frequency_min : input.frequency_min);
  const max = Number(input.frequency_max == null ? base.frequency_max : input.frequency_max);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 7 || min > max) throw httpError(400, "frequency range is invalid");
  const actions = unique((input.action_alternatives || base.action_alternatives).map(value => assertAction(value, "action alternative")));
  return Object.assign(base, input, { formats, summary_lengths: lengths, tones, earliest_time: earliest, latest_time: latest,
    frequency_min: min, frequency_max: max, action_alternatives: actions });
}

function explicitInterpretation(body) {
  const value = clean(body).toLowerCase();
  const result = { explicit: false, format: null, summary_length: null, tone: null, time: null, frequency_delta: 0, action: null };
  if (/\b(don'?t|do not|no|hate|dislike)\b.{0,20}\b(read|reading|paper|papers|article)\b/.test(value)) {
    result.explicit = true; result.format = "video";
  } else if (/\b(don'?t|do not|no|hate|dislike)\b.{0,20}\b(video|videos|watch|youtube)\b/.test(value)) {
    result.explicit = true; result.format = "paper";
  } else if (/\b(prefer|send|want|like|more)\b.{0,30}\b(video|videos|watch|youtube)\b|\b(video|videos)\b.{0,20}\b(please|instead)\b/.test(value)) {
    result.explicit = true; result.format = "video";
  } else if (/\b(prefer|send|want|like|more)\b.{0,30}\b(paper|papers|research|article|reading)\b|\b(paper|papers|reading)\b.{0,20}\b(please|instead)\b/.test(value)) {
    result.explicit = true; result.format = "paper";
  }
  if (/\b(short|shorter|brief|less text|summar(?:y|ise|ize))\b/.test(value)) { result.explicit = true; result.summary_length = "short"; }
  if (/\b(detailed|detail|longer|full paper)\b/.test(value)) { result.explicit = true; result.summary_length = "detailed"; }
  const time = value.match(/\b(?:at|around|after)\s+([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm)?\b/);
  if (time) {
    let hour = Number(time[1]); const minute = time[2] || "00";
    if (time[3] === "pm" && hour < 12) hour += 12;
    if (time[3] === "am" && hour === 12) hour = 0;
    result.explicit = true; result.time = `${String(hour).padStart(2, "0")}:${minute}`;
  }
  if (affirmedPhrase(value, /\b(less often|fewer|too many)\b/g)) { result.explicit = true; result.frequency_delta = -1; }
  if (affirmedPhrase(value, /\b(more often|more messages)\b/g)) { result.explicit = true; result.frequency_delta = 1; }
  return result;
}

// A frequency phrase counts only when no negation precedes it in the same
// clause: "Do not send more often" and "no more messages" request no increase.
// Negated or ambiguous wording infers nothing (benchmark finding, 2 Oct 2026).
function affirmedPhrase(value, pattern) {
  for (const match of value.matchAll(pattern)) {
    const clause = value.slice(0, match.index).split(/[.;,!?]/).at(-1);
    if (!/\b(don'?t|do not|not|no|never)\b/.test(clause)) return true;
  }
  return false;
}

function insideEnvelope(change, envelope, current = {}) {
  if (change.format && !envelope.formats.includes(change.format)) return { allowed: false, reason: "format_outside_envelope" };
  if (change.summary_length && !envelope.summary_lengths.includes(change.summary_length)) return { allowed: false, reason: "summary_length_outside_envelope" };
  if (change.tone && !envelope.tones.includes(change.tone)) return { allowed: false, reason: "tone_outside_envelope" };
  if (change.time && (change.time < envelope.earliest_time || change.time > envelope.latest_time)) return { allowed: false, reason: "time_outside_envelope" };
  const frequency = Number(current.preferred_frequency || envelope.frequency_min) + Number(change.frequency_delta || 0);
  if (change.frequency_delta && (frequency < envelope.frequency_min || frequency > envelope.frequency_max)) return { allowed: false, reason: "frequency_outside_envelope" };
  if (change.action && !envelope.action_alternatives.includes(change.action)) return { allowed: false, reason: "action_outside_envelope" };
  return { allowed: true, frequency };
}

function decide(input) {
  const state = Object.assign({ format_scores: {}, asset_history: [] }, input.state || {});
  const envelope = validateEnvelope(input.envelope);
  const interpretation = input.interpretation || explicitInterpretation(input.body);
  if (input.event_type === "delivery_status") {
    return { outcome: "no_change", rule: "exposure_only", reason: "delivery and read states are evidence of exposure only",
      interpretation, previous_state: state, next_state: state, selected_asset: null,
      scores_before: state.format_scores, scores_after: state.format_scores };
  }
  const check = insideEnvelope(interpretation, envelope, state);
  if (!check.allowed) return { outcome: "outside_envelope", rule: "explicit_request_guarded", reason: check.reason,
    interpretation, previous_state: state, next_state: state, scores_before: state.format_scores, scores_after: state.format_scores };
  const next = Object.assign({}, state);
  if (interpretation.format) next.preferred_format = interpretation.format;
  if (interpretation.summary_length) next.preferred_summary_length = interpretation.summary_length;
  if (interpretation.tone) next.preferred_tone = interpretation.tone;
  if (interpretation.time) next.preferred_time = interpretation.time;
  if (interpretation.frequency_delta) next.preferred_frequency = check.frequency;
  if (interpretation.action) next.preferred_action = interpretation.action;
  const scores = Object.assign({}, state.format_scores);
  if (input.event_type === "link_visit" && input.asset_kind) scores[input.asset_kind] = Number(scores[input.asset_kind] || 0) + 1;
  next.format_scores = scores;
  const assets = (input.assets || []).filter(asset => envelope.formats.includes(asset.media_kind));
  const scoredFormat = Object.entries(scores).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  const preferred = interpretation.format || next.preferred_format || (scoredFormat && Number(scoredFormat[1]) > 0 ? scoredFormat[0] : null);
  const eligible = preferred ? assets.filter(asset => asset.media_kind === preferred) : assets;
  const history = (state.asset_history || []).map(String);
  const selected = eligible.slice().sort((left, right) => {
    const leftIndex = history.lastIndexOf(String(left.asset_id));
    const rightIndex = history.lastIndexOf(String(right.asset_id));
    return leftIndex - rightIndex;
  })[0] || assets[0] || null;
  if (selected) {
    next.last_asset_id = selected.asset_id;
    next.asset_history = (state.asset_history || []).concat(selected.asset_id).slice(-20);
  }
  const changed = JSON.stringify(next) !== JSON.stringify(state);
  return { outcome: changed ? "applied" : "no_change", rule: interpretation.explicit ? "explicit_request" : "least_recently_used_rotation",
    reason: interpretation.explicit ? "explicit request fitted approved envelope" : "no explicit preference; rotated approved media",
    interpretation, previous_state: state, next_state: next, selected_asset: selected,
    scores_before: state.format_scores, scores_after: scores };
}

module.exports = { FORMATS, SUMMARY_LENGTHS, TONES, PILLAR_TERMS, CATEGORY_TERMS, behaviour, behaviourKey, querySet,
  rankCandidate, selectPool, validateSummary, defaultEnvelope, validateEnvelope, explicitInterpretation, insideEnvelope, decide };
