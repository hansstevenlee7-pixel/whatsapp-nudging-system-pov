"use strict";

// Gold labels for FIDELITY_PROTOCOL.md (v1), written before any live call.
// Synthetic prescription texts; author-assigned labels, not a clinician's.
// frequency = reminders per week (the number of drafts the prompt asks for).
// alt lists declared acceptable alternatives for genuinely ambiguous items.

const g = (pillar, category, frequency, weeks, alt = {}) => ({ pillar, category, frequency, weeks, alt });

const FIDELITY_CASES = [
  { id: "F01", text: "Walk 30 minutes after dinner, twice a week, for 6 weeks.",
    gold: [g("physical_activity", "increase", 2, 6, { category: ["establish"] })] },
  { id: "F02", text: "Be in bed by 10:30 pm on weeknights; three reminders a week for 8 weeks.",
    gold: [g("sleep", "establish", 3, 8)] },
  { id: "F03", text: "Cut down on alcohol to no more than two drinks on any day. Weekly reminder, 12 weeks.",
    gold: [g("substance_use", "reduce", 1, 12)] },
  { id: "F04", text: "Stop smoking completely. Remind me three times a week for 10 weeks.",
    gold: [g("substance_use", "avoid", 3, 10)] },
  { id: "F05", text: "Eat two serves of vegetables at lunch; reminders twice a week for 6 weeks.",
    gold: [g("nutrition", "increase", 2, 6, { category: ["establish"] })] },
  // Deliberately ambiguous: three sessions is the behaviour, one reminder is the frequency.
  { id: "F06", text: "Keep up your three gym sessions a week; one reminder a week for 8 weeks.",
    gold: [g("physical_activity", "maintain", 1, 8, { frequency: [3] })] },
  { id: "F07", text: "Ten minutes of slow breathing every evening to manage stress; remind me twice a week for 4 weeks.",
    gold: [g("stress_management", "establish", 2, 4, { category: ["increase"] })] },
  { id: "F08", text: "Call or meet a friend at least once a week to feel less isolated. Weekly reminder for 8 weeks.",
    gold: [g("social_connection", "increase", 1, 8, { category: ["establish"] })] },
  { id: "F09", text: "Avoid sugary soft drinks entirely. Two reminders a week, 6 weeks.",
    gold: [g("nutrition", "avoid", 2, 6, { category: ["reduce"] })] },
  { id: "F10", text: "Reduce screen time after 9 pm and keep a regular wake-up time of 7 am. Two reminders a week for each, 8 weeks.",
    gold: [g("sleep", "reduce", 2, 8, { category: ["avoid"] }), g("sleep", "establish", 2, 8, { category: ["maintain"] })] },
  { id: "F11", text: "Walk 20 minutes three times a week, and cut back on takeaway meals to once a week with two reminders a week for the takeaway goal; 6 weeks.",
    gold: [g("physical_activity", "increase", 3, 6, { category: ["establish"] }), g("nutrition", "reduce", 2, 6)] },
  { id: "F12", text: "Maintain your current 7 to 8 hours of sleep. One reminder a week, 12 weeks.",
    gold: [g("sleep", "maintain", 1, 12)] }
];

module.exports = { FIDELITY_CASES, REPETITIONS: 3, ATTEMPT_CAP: 45, MIN_INTERVAL_MS: 7000 };
