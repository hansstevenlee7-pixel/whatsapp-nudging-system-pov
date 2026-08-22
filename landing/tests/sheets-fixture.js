"use strict";

const sheets = require("../api/_lib/google-sheets");

const HEADERS = {
  user: ["user_id", "name", "phone", "email", "user_status", "doctor_id"],
  questionnaire: ["questionnaire_id", "user_id", "preferred_nudge_time"],
  prescriptions: ["prescription_id", "user_id", "doctor_id", "issued_date", "pillar", "category", "target_behavior", "frequency_per_week", "duration_weeks", "prescription_raw_text", "status"],
  // `category` is last on both tabs on purpose: that is where the live migration
  // appends it, so the fixture proves the read path is order-independent.
  nudges: ["nudge_id", "prescription_id", "user_id", "nudge_type", "pillar", "action_text", "scheduled_date", "scheduled_time", "message_body", "message_body_alt", "tone_variant", "template_name", "status", "sent_at", "reviewed_at", "week_number", "schedule_slot_id", "category"],
  weekly_schedule: ["schedule_slot_id", "user_id", "source_nudge_id", "prescription_id", "day", "scheduled_time", "nudge_type", "pillar", "action_text", "tone_variant", "message_body", "message_body_alt", "template_name", "status", "start_date", "end_date", "created_at", "updated_at", "category"],
  schedule_state: ["schedule_id", "nudge_id", "user_id", "parent_nudge_id", "status", "sent_at", "delivered_at", "wa_message_id", "tone_sent", "last_updated"],
  delivery_events: ["event_id", "event_at", "wa_message_id", "nudge_id", "user_id", "status", "error_code", "error_message", "channel_to", "raw_payload"]
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
    questionnaire: [{ questionnaire_id: "qn-1", user_id: "patient-1", preferred_nudge_time: "20:30" }],
    prescriptions: [{ prescription_id: "rx-1", user_id: "patient-1", doctor_id: "doc-1", issued_date: "2026-07-01", pillar: "sleep", category: "establish", target_behavior: "", frequency_per_week: 3, duration_weeks: 8, prescription_raw_text: "Sleep earlier", status: "active" }],
    nudges: [
      { nudge_id: "source-wed", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-07-29", scheduled_time: "09:00", message_body: "Wednesday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" },
      { nudge_id: "source-fri", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-07-31", scheduled_time: "09:00", message_body: "Friday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" },
      { nudge_id: "source-sun", prescription_id: "rx-1", user_id: "patient-1", nudge_type: "reminder", pillar: "sleep", action_text: "Be in bed by 10pm", scheduled_date: "2026-08-02", scheduled_time: "09:00", message_body: "Sunday", message_body_alt: "", tone_variant: "encouraging", template_name: "health_plan_reminder", status: "needs_review", sent_at: "", reviewed_at: "", week_number: 1, schedule_slot_id: "" }
    ]
  };
}

module.exports = { fixture, baseSeed, HEADERS };
