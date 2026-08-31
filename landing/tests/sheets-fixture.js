"use strict";

const sheets = require("../api/_lib/google-sheets");

const HEADERS = {
  user: ["user_id", "name", "phone", "email", "user_status", "doctor_id"],
  questionnaire: ["questionnaire_id", "user_id", "preferred_nudge_time", "opt_in_whatsapp"],
  prescriptions: ["prescription_id", "user_id", "doctor_id", "issued_date", "pillar", "category", "target_behavior", "frequency_per_week", "duration_weeks", "prescription_raw_text", "status"],
  // `category` is last on both tabs on purpose: that is where the live migration
  // appends it, so the fixture proves the read path is order-independent.
  nudges: ["nudge_id", "prescription_id", "user_id", "nudge_type", "pillar", "action_text", "scheduled_date", "scheduled_time", "message_body", "message_body_alt", "tone_variant", "template_name", "status", "sent_at", "reviewed_at", "week_number", "schedule_slot_id", "category", "media_selection_mode", "media_override_asset_id", "media_asset_id", "adaptation_decision_id"],
  weekly_schedule: ["schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "action_text", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "created_at", "updated_at", "category", "media_selection_mode", "media_override_asset_id", "media_asset_id", "adaptation_decision_id"],
  schedule_state: ["schedule_id", "nudge_id", "user_id", "parent_nudge_id", "status", "sent_at", "delivered_at", "wa_message_id", "tone_sent", "last_updated", "read_at", "interacted_at", "last_inbound_message_sid", "delivery_attempt_id", "submission_started_at"],
  delivery_events: ["event_id", "event_at", "wa_message_id", "nudge_id", "user_id", "status", "error_code", "error_message", "channel_to", "raw_payload"],
  media_assignments: ["assignment_id", "assigned_at", "user_id", "nudge_id", "behaviour_key", "media_asset_id", "adaptation_decision_id", "media_kind", "selection_mode", "source_url", "tracked_url", "planned_frequency", "scheduled_at", "sent_at", "delivered_at", "read_at", "visited_at", "replied_at", "send_to_read_hours", "send_to_visit_hours", "send_to_reply_hours"],
  interaction_events: ["interaction_id", "event_at", "inbound_message_sid", "user_id", "from_phone", "reply_to_wa_message_id", "nudge_id", "body", "media_count", "correlation_method", "ack_status"],
  adaptation_decisions: ["decision_id", "decided_at", "user_id", "behaviour_key", "interaction_id", "signal_type", "rule_applied", "outcome", "reason", "selected_asset_id", "interpretation", "previous_state", "next_state", "scope", "decision_source", "effective_at", "state_version", "changed_fields", "frequency_before", "frequency_after", "media_mode_before", "media_mode_after", "media_kind_before", "media_kind_after", "nudge_id"],
  patient_adaptation_state: ["user_id", "scope", "behaviour_key", "state_version", "preferred_format", "preferred_frequency", "planned_frequency", "delivered_frequency", "observed_frequency", "last_change_at", "updated_at"],
  patient_adaptation_timeline: ["user_id", "event_id", "event_at", "event_type", "source", "scope", "behaviour_key", "signal", "rule_applied", "outcome", "reason", "previous_state", "new_state", "changed_fields", "selected_asset_id", "selected_media_kind", "nudge_id", "interaction_id"]
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture(seed = {}) {
  const tables = {};
  for (const [name, headers] of Object.entries(HEADERS)) {
    tables[name] = { headers: headers.slice(), rows: (seed[name] || []).map((row, index) => Object.assign({ row_number: index + 2 }, clone(row))) };
  }
  let failBatch = false;
  let ignoreBatch = false;
  const adapter = {
    async readTabs(names) {
      return Object.fromEntries(names.map(name => [name, clone(tables[name])]));
    },
    async ensureTabs(names) {
      for (const name of names) if (!tables[name]) tables[name] = { headers: [], rows: [] };
      return Object.fromEntries(names.map(name => [name, { sheetId: name }]));
    },
    async batchWrite(operations) {
      if (failBatch) throw new Error("simulated Sheets batch failure");
      if (ignoreBatch) return { replies: [] };
      const next = clone(tables);
      for (const operation of operations) {
        const table = next[operation.tab];
        if (operation.rowNumber) {
          const index = table.rows.findIndex(row => row.row_number === operation.rowNumber);
          if (index < 0) throw new Error(`row ${operation.rowNumber} missing from ${operation.tab}`);
          table.rows[index] = Object.assign({ row_number: operation.rowNumber }, clone(operation.row));
        } else {
          const rowNumber = table.rows.reduce((max, row) => Math.max(max, row.row_number), 1) + 1;
          table.rows.push(Object.assign({ row_number: rowNumber }, clone(operation.row)));
        }
      }
      Object.assign(tables, next);
      return { replies: operations.map(() => ({})) };
    }
  };
  sheets._setTestAdapter(adapter);
  return {
    tables,
    failNextBatch() { failBatch = true; },
    ignoreNextBatch() { ignoreBatch = true; },
    restore() { sheets._setTestAdapter(null); }
  };
}

function baseSeed() {
  return {
    user: [{ user_id: "patient-1", name: "Ada", phone: "+61411111111", email: "ada@example.test", user_status: "active", doctor_id: "doc-1" }],
    questionnaire: [{ questionnaire_id: "qn-1", user_id: "patient-1", preferred_nudge_time: "20:30", opt_in_whatsapp: true }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-07-01", pillar: "sleep", category: "establish", target_behavior: "", frequency_per_week: 3, duration_weeks: 8, prescription_raw_text: "Sleep earlier", status: "active" }],
    nudges: [
      { nudge_id: "source-wed", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-07-29", scheduled_time: "09:00", message_body: "Wednesday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" },
      { nudge_id: "source-fri", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-07-31", scheduled_time: "09:00", message_body: "Friday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" },
      { nudge_id: "source-sun", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-08-02", scheduled_time: "09:00", message_body: "Sunday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" }
    ]
  };
}

module.exports = { fixture, baseSeed, HEADERS };
