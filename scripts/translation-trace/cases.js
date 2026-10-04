"use strict";

// Cases declared in PROTOCOL.md (v1). Every LLM response here is an authored
// synthetic fixture standing in for Gemini; none is live model output.
//
// Clock: Monday 5 October 2026, 08:00 in Melbourne, so week1_dates run from
// 2026-10-05 (Monday) to 2026-10-11 (Sunday).

const INTAKE_AT = "2026-10-04T21:00:00.000Z";
const WEEK1 = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];

function draft(ref, pillar, date, time, action, overrides = {}) {
  return Object.assign({ prescription_ref: ref, pillar, nudge_type: "reminder", action_text: action, scheduled_date: date, scheduled_time: time,
    tone_variant: "encouraging", message_body: `Reminder: ${action.charAt(0).toLowerCase()}${action.slice(1)}.`,
    message_body_alt: `Today's step: ${action.charAt(0).toLowerCase()}${action.slice(1)}.`, template_name: "health_plan_reminder" }, overrides);
}
const rx = (ref, pillar, category, frequency, weeks) => ({ ref, pillar, category, frequency_per_week: frequency, duration_weeks: weeks });

const WALK = "Walk for 30 minutes after dinner";
function walking(overrides = {}) {
  return { prescriptions: [rx("p1", "physical_activity", "increase", 2, 6)],
    nudges: [draft("p1", "physical_activity", WEEK1[1], "18:00", WALK), draft("p1", "physical_activity", WEEK1[4], "18:00", WALK)], ...overrides };
}
function twoSamePillar() {
  return { prescriptions: [rx("p1", "physical_activity", "increase", 1, 6), rx("p2", "physical_activity", "maintain", 1, 6)],
    nudges: [draft("p1", "physical_activity", WEEK1[1], "18:00", "Walk for 20 minutes"),
      draft("p2", "physical_activity", WEEK1[3], "18:00", "Do one strength session at home")] };
}
const mutate = (base, fn) => { const copy = JSON.parse(JSON.stringify(base)); fn(copy); return copy; };

const WALK_TEXT = "Walk 30 minutes after dinner, twice a week, for 6 weeks.";
const PART_A = [
  { id: "A01", cls: "control", text: WALK_TEXT, expected: "ACCEPT", llm: walking() },
  { id: "A02", cls: "control", text: "Walk 30 minutes after dinner twice a week, and be in bed by 10:30 pm once a week, for 6 weeks.", expected: "ACCEPT",
    llm: { prescriptions: [rx("p1", "physical_activity", "increase", 2, 6), rx("p2", "sleep", "establish", 1, 6)],
      nudges: [...walking().nudges, draft("p2", "sleep", WEEK1[2], "21:00", "Be in bed by 10:30 pm")] } },
  { id: "A03", cls: "parse", text: WALK_TEXT, expected: "REJECT", raw: "I could not read the prescription clearly." },
  { id: "A04", cls: "parse", text: WALK_TEXT, expected: "REJECT", raw: "```json\n" + JSON.stringify(walking()) + "\n```" },
  { id: "A05", cls: "parse", text: WALK_TEXT, expected: "REJECT", raw: JSON.stringify(walking()).slice(0, 180) },
  { id: "A06", cls: "shape", text: WALK_TEXT, expected: "REJECT", llm: walking({ nudges: [] }) },
  { id: "A07", cls: "taxonomy", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.prescriptions[0].pillar = "exercise"; v.nudges.forEach(n => { n.pillar = "exercise"; }); }) },
  { id: "A08", cls: "taxonomy", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.prescriptions[0].category = "improve"; }) },
  { id: "A09", cls: "taxonomy", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[1].pillar = "sleep"; }) },
  { id: "A10", cls: "drift", text: WALK_TEXT, expected: "NORMALISE", normalised_category: "increase", llm: mutate(walking(), v => { v.prescriptions[0].category = " Increase "; }) },
  { id: "A11", cls: "drift", text: WALK_TEXT, expected: "NORMALISE", normalised_category: "increase", llm: mutate(walking(), v => { v.prescriptions[0].category = "daily_steps_10000"; }) },
  { id: "A12", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { delete v.nudges[0].action_text; }) },
  { id: "A13", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[0].action_text = "W".repeat(1025); }) },
  { id: "A14", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[0].nudge_type = "nag"; }) },
  { id: "A15", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[0].scheduled_time = "25:00"; }) },
  { id: "A16", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[0].scheduled_date = "05/10/2026"; }) },
  { id: "A17", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.prescriptions[0].frequency_per_week = 0; }) },
  { id: "A18", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.prescriptions[0].duration_weeks = 60; }) },
  { id: "A19", cls: "bounds", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { delete v.nudges[0].message_body; }) },
  { id: "A20", cls: "referential", text: "Walk 20 minutes once a week and do one home strength session once a week, for 6 weeks.", expected: "REJECT",
    llm: mutate(twoSamePillar(), v => { v.nudges[1].prescription_ref = "p9"; }) },
  { id: "A21", cls: "referential", text: "Walk 20 minutes once a week and do one home strength session once a week, for 6 weeks.", expected: "REJECT",
    llm: mutate(twoSamePillar(), v => { delete v.nudges[1].prescription_ref; }) },
  { id: "A22", cls: "referential", text: "Walk 30 minutes after dinner twice a week, and be in bed by 10:30 pm once a week, for 6 weeks.", expected: "REJECT",
    llm: { prescriptions: [rx("p1", "physical_activity", "increase", 2, 6), rx("p2", "sleep", "establish", 1, 6)], nudges: walking().nudges } },
  { id: "A23", cls: "schedule", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[1].scheduled_date = "2026-10-14"; }) },
  { id: "A24", cls: "schedule", text: WALK_TEXT, expected: "REJECT", llm: mutate(walking(), v => { v.nudges[1].scheduled_date = v.nudges[0].scheduled_date; }) },
  { id: "A25", cls: "schedule", text: "Walk 30 minutes after dinner, three times a week, for 6 weeks.", expected: "REJECT",
    llm: mutate(walking(), v => { v.prescriptions[0].frequency_per_week = 3; }) },
  { id: "A26", cls: "semantic", text: WALK_TEXT, expected: "ACCEPT", llm: mutate(walking(), v => { v.prescriptions[0].category = "reduce"; }) },
  { id: "A27", cls: "semantic", text: WALK_TEXT, expected: "ACCEPT",
    llm: mutate(walking(), v => { v.nudges.forEach(n => Object.assign(n, draft("p1", "physical_activity", n.scheduled_date, n.scheduled_time, "Drink eight glasses of water"))); }) },
  { id: "A28", cls: "semantic", text: WALK_TEXT, expected: "ACCEPT",
    llm: { prescriptions: [rx("p1", "physical_activity", "increase", 2, 6), rx("p2", "nutrition", "reduce", 1, 6)],
      nudges: [...walking().nudges, draft("p2", "nutrition", WEEK1[3], "12:00", "Swap one sugary drink for water")] } }
];

// Part B. `review` describes what the clinician does before approving:
// edits to individual drafts (by index), drafts left out, and prescription
// corrections made through the prescription API.
const PART_B = [
  { id: "B1", text: "Sleep: be in bed by 10:30 pm, 3 nights a week, for 8 weeks.",
    llm: { prescriptions: [rx("p1", "sleep", "establish", 3, 8)],
      nudges: [0, 2, 4].map(i => draft("p1", "sleep", WEEK1[i], "09:00", "Be in bed by 10:30 pm")) },
    review: {}, reply: "Send fewer messages" },
  { id: "B2", text: WALK_TEXT, llm: mutate(walking(), v => v.nudges.forEach((n, i) => { n.scheduled_date = WEEK1[i ? 3 : 0]; n.scheduled_time = "09:00"; })),
    review: { edits: { 0: { action_text: "Walk for 30 minutes after dinner, outdoors if it is dry" }, 1: { time: "19:00", action_text: "Walk for 30 minutes after dinner, outdoors if it is dry" } } },
    reply: "Thanks, done!" },
  { id: "B3", text: "Cut sugary drinks (two reminders a week) and do 10 minutes of slow breathing once a week, for 8 weeks.",
    llm: { prescriptions: [rx("p1", "nutrition", "reduce", 2, 8), rx("p2", "stress_management", "establish", 1, 8)],
      nudges: [draft("p1", "nutrition", WEEK1[0], "09:00", "Swap one sugary drink for water"), draft("p1", "nutrition", WEEK1[3], "09:00", "Swap one sugary drink for water"),
        draft("p2", "stress_management", WEEK1[2], "20:00", "Do 10 minutes of slow breathing")] },
    review: {}, reply: "Send fewer messages" },
  { id: "B4", text: "Increase walking to 30 minutes a day; two reminders a week; 6 weeks.",
    llm: mutate(walking(), v => { v.prescriptions[0].category = "reduce"; v.nudges.forEach((n, i) => { n.scheduled_date = WEEK1[i ? 3 : 0]; n.scheduled_time = "09:00"; }); }),
    review: { prescription_corrections: { p1: { category: "increase" } } }, reply: "Send fewer messages" },
  { id: "B5", text: "Sleep: no screens after 9:30 pm and be in bed by 10:30 pm, twice a week, for 8 weeks.",
    llm: { prescriptions: [rx("p1", "sleep", "establish", 2, 8)],
      nudges: [draft("p1", "sleep", WEEK1[0], "09:00", "No screens after 9:30 pm"), draft("p1", "sleep", WEEK1[3], "09:00", "Be in bed by 10:30 pm")] },
    review: {}, reply: "Send fewer messages" },
  { id: "B6", text: "Walk 20 minutes, 3 times a week, for 6 weeks.",
    llm: { prescriptions: [rx("p1", "physical_activity", "increase", 3, 6)],
      nudges: [0, 2, 4].map(i => draft("p1", "physical_activity", WEEK1[i], "09:00", "Walk for 20 minutes")) },
    review: { leave_out: [2] }, reply: "Send more messages" }
];

module.exports = { INTAKE_AT, WEEK1, PART_A, PART_B };
