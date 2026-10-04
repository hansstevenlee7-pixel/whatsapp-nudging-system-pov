"use strict";
// Requirements-derived labels: no application imports and no observed outputs.
const none = { explicit: false, format: null, summary_length: null, tone: null, time: null, frequency_delta: 0, action: null };
const interpretation = change => ({ ...none, explicit: true, ...change });
const baseline = { time: "09:00", frequency: 2, format: "paper", summary: "detailed" };
const cases = [];
function add(id, category, body, expected, change, extra = {}) {
  cases.push({ id, category, requirement: "INSTRUCTIONS.md sections 1, 4, 8 and 9; bounded request fulfilment and future-unsent-only application",
    events: [{ body, expected: { ...baseline, ...expected }, interpretation: change ? interpretation(change) : none }], ...extra });
}
for (const [dimension, forms, expected, change] of [
  ["media", ["I prefer videos", "Could future resources be in video form?", "For future resources, use moving pictures rather than written articles."], { format: "video" }, { format: "video" }],
  ["summary", ["Please make it shorter", "Use a concise summary in future messages.", "Going forward, condense the explanation into a few words."], { summary: "short" }, { summary_length: "short" }],
  ["time", ["Send at 18:30", "Move the reminders to half past six in the evening.", "For future reminders, use eighteen thirty as the delivery time."], { time: "18:30" }, { time: "18:30" }],
  ["frequency", ["Send fewer messages", "Reduce the weekly message count by one.", "The current two reminders are excessive; one each week is enough."], { frequency: 1 }, { frequency_delta: -1 }]
]) forms.forEach((body, i) => add(`${dimension}-${i + 1}`, "supported", body, expected, change, { dimension, wording: ["direct", "paraphrase", "indirect"][i] }));
add("nochange-ambiguous", "no_change", "Something about these reminders is not right.", {}, null);
add("nochange-negated", "no_change", "Do not send more often; keep the current frequency.", {}, null);
add("nochange-unrelated", "no_change", "Thank you, I received the message.", {}, null);
add("nochange-missing", "no_change", null, {}, null, { missing_evidence: true });
add("boundary-time", "boundary", "Send at 23:30", {}, { time: "23:30" }, { rejection: true });
add("boundary-frequency", "boundary", "Send fewer messages", {}, { frequency_delta: -1 }, { envelope: { frequency_min: 2 }, rejection: true });
add("boundary-media", "boundary", "I prefer videos", {}, { format: "video" }, { unavailable_video: true, note: "Record request; only approved available assets may be prepared. Paper fallback is acceptable." });
add("boundary-override", "boundary", "I prefer videos", {}, { format: "video" }, { clinician_override: true, note: "Preference may be recorded, but clinician-selected paper must be delivered." });
add("operational-stop", "operational", "STOP", { blocked: true }, null, { stop: true });
add("operational-duplicate", "operational", "Send fewer messages", { frequency: 1 }, { frequency_delta: -1 }, { duplicate: true });
add("operational-history", "operational", "Send at 18:30", { time: "18:30" }, { time: "18:30" });
add("operational-sequence", "operational", "I prefer videos", { format: "video" }, { format: "video" });
cases.at(-1).events.push({ body: "I prefer papers", expected: { ...baseline }, interpretation: interpretation({ format: "paper" }) });
module.exports = { cases, baseline, none };
