"use strict";

const { fixture } = require("../landing/tests/sheets-fixture");
const { allPatients } = require("../landing/api/_lib/clinical-data");
const { behaviourKey } = require("../landing/api/_lib/adaptive-core");
const { evaluateAdaptive, policyRows } = require("../landing/api/_lib/frequency-shadow");
const { applyAdaptiveSchedule } = require("../landing/api/_lib/schedule-store");

const NOW = "2026-08-27T00:00:00.000Z";
const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };
const key = behaviourKey(behaviour);

function slot(id, day) {
  return Object.assign({ schedule_slot_id: id, user_id: "patient-1", source_nudge_id: "source-1", prescription_id: "rx-1",
    day, scheduled_time: "09:00", nudge_type: "reminder", tone_variant: "encouraging", message_body: "Take a short walk",
    message_body_alt: "", template_name: "health_plan_reminder", status: "active", start_date: "2026-08-24", end_date: "2026-09-20",
    media_selection_mode: "automatic" }, behaviour);
}

function delivered(index) {
  return Object.assign({ nudge_id: `past-${index}`, schedule_slot_id: index === 1 ? "slot-mon" : "slot-thu",
    prescription_id: "rx-1", user_id: "patient-1", status: "delivered", scheduled_date: `2026-08-${19 + index}`,
    scheduled_time: "09:00", sent_at: `2026-08-${19 + index}T00:00:00Z`, wa_message_id: `SM-past-${index}`,
    message_body: "Take a short walk" }, behaviour);
}

async function main() {
  const fx = fixture({
    user: [{ user_id: "patient-1", name: "Synthetic participant", phone: "+61400000000", email: "synthetic@example.test", user_status: "active", doctor_id: "doc-1" }],
    questionnaire: [{ questionnaire_id: "q-1", user_id: "patient-1", opt_in_whatsapp: true }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-08-01",
      pillar: "physical_activity", category: "increase", frequency_per_week: 2, duration_weeks: 8, status: "active", prescription_raw_text: "Walk more" }],
    weekly_schedule: [slot("slot-mon", "monday"), slot("slot-thu", "thursday")],
    nudges: [Object.assign({ nudge_id: "source-1", prescription_id: "rx-1", user_id: "patient-1", status: "approved",
      scheduled_date: "2026-08-01", scheduled_time: "09:00", message_body: "Take a short walk" }, behaviour), delivered(1), delivered(2)],
    schedule_state: [1, 2].map(index => ({ schedule_id: `state-${index}`, nudge_id: `past-${index}`, user_id: "patient-1",
      status: "delivered", sent_at: `2026-08-${19 + index}T00:00:00Z`, delivered_at: `2026-08-${19 + index}T00:01:00Z`,
      wa_message_id: `SM-past-${index}`, last_updated: `2026-08-${19 + index}T00:01:00Z` }))
  });

  try {
    const patient = (await allPatients()).find(item => item.user_id === "patient-1");
    const envelope = Object.assign({ behaviour_key: key, status: "approved", automatic_schedule_apply: true,
      frequency_min: 1, frequency_max: 3, earliest_time: "09:00", latest_time: "09:00", formats: ["video", "paper", "reading"] }, behaviour);
    const evaluation = evaluateAdaptive({ patient, adaptive: { envelopes: [envelope], events: [], decisions: [], states: [], assets: [], historical_assets: [] },
      envelope, behaviour_key: key, now: NOW, mode: "apply" });
    if (evaluation.status !== "evaluated") throw new Error(`Expected an evaluated result, got ${evaluation.status}`);

    const before = {
      recurring_slots: patient.weekly_schedule.filter(row => row.status === "active").map(row => ({ id: row.schedule_slot_id, day: row.day, time: row.scheduled_time })),
      closed_deliveries: evaluation.recent_outcomes
    };
    const sentStateBefore = fx.tables.schedule_state.rows.filter(row => row.nudge_id === "past-1" || row.nudge_id === "past-2").map(row => ({
      nudge_id: row.nudge_id, status: row.status, sent_at: row.sent_at, delivered_at: row.delivered_at, wa_message_id: row.wa_message_id
    }));
    const schedule = await applyAdaptiveSchedule({ user_id: "patient-1", behaviour_key: key,
      target_frequency: evaluation.recommended_frequency, target_time: evaluation.time_recommendation.recommended_time, now: NOW });
    const after = (await allPatients()).find(item => item.user_id === "patient-1");
    const sentIds = new Set(["past-1", "past-2"]);
    const allDatedRows = (after.schedule_nudges || []).concat(after.nudges || []);
    const sentHistory = allDatedRows.filter(row => sentIds.has(row.nudge_id)).map(row => ({
      nudge_id: row.nudge_id, status: row.status, scheduled_time: row.scheduled_time, sent_at: row.sent_at, wa_message_id: row.wa_message_id || null
    }));
    const sentStateAfter = fx.tables.schedule_state.rows.filter(row => row.nudge_id === "past-1" || row.nudge_id === "past-2").map(row => ({
      nudge_id: row.nudge_id, status: row.status, sent_at: row.sent_at, delivered_at: row.delivered_at, wa_message_id: row.wa_message_id
    }));
    const audit = policyRows({ user_id: "patient-1", result: evaluation, mode: "apply", schedule_applied: schedule.applied, now: NOW });
    console.log(JSON.stringify({
      experiment_id: "modelled-schedule-change-2026-09-09",
      evidence_level: "verified-local-synthetic",
      model_id: evaluation.model_id,
      behaviour_key: key,
      evaluation_time: NOW,
      before,
      model: { features: evaluation.features, candidate_scores: evaluation.candidate_scores, model_recommended_frequency: evaluation.model_recommended_frequency },
      policy: { current_frequency: evaluation.current_frequency, recommended_frequency: evaluation.recommended_frequency, direction: evaluation.direction,
        reason: evaluation.policy_reason, time: evaluation.time_recommendation, media: evaluation.media_recommendation },
      schedule_application: { applied: schedule.applied, reason: schedule.reason, active_slots: after.weekly_schedule.filter(row => row.status === "active").map(row => ({ id: row.schedule_slot_id, day: row.day, time: row.scheduled_time })) },
      sent_history: { nudge_rows: sentHistory, schedule_state_before: sentStateBefore, schedule_state_after: sentStateAfter,
        schedule_state_unchanged: JSON.stringify(sentStateBefore) === JSON.stringify(sentStateAfter) },
      audit_rows: audit.map(row => ({ signal_type: row.signal_type, outcome: row.outcome, frequency_before: row.frequency_before,
        frequency_after: row.frequency_after, rule_applied: row.rule_applied, reason: row.reason })),
      limitations: ["synthetic rows only", "no live Sheet or WhatsApp write", "no adherence or clinical outcome claim"]
    }, null, 2));
  } finally {
    fx.restore();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
