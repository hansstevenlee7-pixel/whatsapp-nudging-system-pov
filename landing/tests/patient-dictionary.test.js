"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { behaviourKey, defaultEnvelope, decide } = require("../api/_lib/adaptive-core");
const { buildPatientDictionary, stateExportRows, timelineExportRows } = require("../api/_lib/patient-dictionary");
const { exportPatientDictionary } = require("../api/_lib/patient-dictionary-export");
const { fixture: sheetFixture } = require("./sheets-fixture");

const sleep = { action_text: "Be in bed by 10pm", pillar: "sleep", category: "establish" };
const nutrition = { action_text: "Eat vegetables", pillar: "nutrition", category: "increase" };
const sleepKey = behaviourKey(sleep);
const nutritionKey = behaviourKey(nutrition);

function fixture() {
  const slots = [
    Object.assign({ schedule_slot_id: "sleep-mon", day: "monday", scheduled_time: "09:00", status: "active", media_selection_mode: "automatic" }, sleep),
    Object.assign({ schedule_slot_id: "sleep-wed", day: "wednesday", scheduled_time: "09:00", status: "active", media_selection_mode: "automatic" }, sleep),
    Object.assign({ schedule_slot_id: "sleep-fri", day: "friday", scheduled_time: "09:00", status: "active", media_selection_mode: "clinician_selected", media_override_asset_id: "paper-1" }, sleep),
    Object.assign({ schedule_slot_id: "nutrition-sun", day: "sunday", scheduled_time: "10:00", status: "active", media_selection_mode: "automatic" }, nutrition)
  ];
  return {
    patient: { user_id: "p1", name: "Ada", user_status: "active", weekly_schedule: slots,
      schedule_nudges: [
        { nudge_id: "n1", schedule_slot_id: "sleep-mon", scheduled_date: "2026-08-10", scheduled_time: "09:00", status: "read", media_asset_id: "video-1" },
        { nudge_id: "n2", schedule_slot_id: "sleep-wed", scheduled_date: "2026-08-12", scheduled_time: "09:00", status: "delivered", media_asset_id: "paper-1" },
        { nudge_id: "n3", schedule_slot_id: "sleep-fri", scheduled_date: "2026-08-14", scheduled_time: "09:00", status: "delivered", media_asset_id: "paper-1" },
        { nudge_id: "n4", schedule_slot_id: "nutrition-sun", scheduled_date: "2026-08-16", scheduled_time: "10:00", status: "sent", media_asset_id: "video-2" }
      ],
      schedule_state: [
        { nudge_id: "n1", user_id: "p1", status: "read", sent_at: "2026-08-10T09:00:00Z", delivered_at: "2026-08-10T09:00:30Z", read_at: "2026-08-10T10:30:00Z", wa_message_id: "SM1" },
        { nudge_id: "n2", user_id: "p1", status: "delivered", sent_at: "2026-08-12T09:00:00Z", delivered_at: "2026-08-12T09:01:00Z", wa_message_id: "SM2" },
        { nudge_id: "n3", user_id: "p1", status: "delivered", sent_at: "2026-08-14T09:00:00Z", delivered_at: "2026-08-14T09:01:00Z", wa_message_id: "SM3" },
        { nudge_id: "n4", user_id: "p1", status: "sent", sent_at: "2026-08-16T10:00:00Z", wa_message_id: "SM4" }
      ],
      delivery_events: [
        { event_id: "d1", event_at: "2026-08-10T09:00:30Z", nudge_id: "n1", status: "delivered" },
        { event_id: "d2", event_at: "2026-08-10T10:30:00Z", nudge_id: "n1", status: "read" }
      ], interaction_events: [] },
    adaptive: {
      global_state: { user_id: "p1", preferred_format: "video", preferred_frequency: 3, state_version: 1 },
      states: [{ user_id: "p1", behaviour_key: sleepKey, preferred_format: "paper", preferred_frequency: 2, state_version: 2, updated_at: "2026-08-13T00:00:00Z" }],
      assets: [
        { asset_id: "video-1", media_kind: "video", title: "Sleep video", source_url: "https://example.test/video" },
        { asset_id: "paper-1", media_kind: "paper", title: "Sleep paper", source_url: "https://example.test/paper" },
        { asset_id: "video-2", media_kind: "video", title: "Food video", source_url: "https://example.test/food" }
      ],
      events: [
        { interaction_id: "i1", event_at: "2026-08-10T11:00:00Z", event_type: "link_visit", user_id: "p1", behaviour_key: sleepKey, nudge_id: "n1", asset_id: "video-1" },
        { interaction_id: "i2", event_at: "2026-08-13T12:00:00Z", event_type: "inbound_reply", user_id: "p1", behaviour_key: sleepKey, nudge_id: "n2", body: "I prefer papers" }
      ],
      decisions: [{ decision_id: "dec-1", decided_at: "2026-08-13T12:05:00Z", effective_at: "2026-08-13T12:05:00Z", user_id: "p1", behaviour_key: sleepKey,
        signal_type: "inbound_reply", decision_source: "patient", scope: "behaviour", rule_applied: "explicit_request", outcome: "applied", reason: "explicit request fitted approved envelope",
        previous_state: { preferred_format: "video", preferred_frequency: 3 }, next_state: { preferred_format: "paper", preferred_frequency: 2 }, changed_fields: ["preferred_format", "preferred_frequency"], state_version: 2 }]
    }
  };
}

test("dictionary derives frequency, media, timestamps, latency, and scoped fallback", () => {
  const data = fixture();
  const dictionary = buildPatientDictionary(Object.assign({}, data, { now: "2026-08-10T08:00:00Z", from: "2026-08-10", to: "2026-08-16" }));
  assert.equal(dictionary.summary.planned_frequency, 4);
  assert.equal(dictionary.summary.delivered_frequency, 3);
  assert.equal(dictionary.summary.observed_frequency, 2);
  assert.equal(dictionary.summary.media_preference, "mixed");
  const sleepEntry = dictionary.behaviour_states.find(item => item.behaviour_key === sleepKey);
  const nutritionEntry = dictionary.behaviour_states.find(item => item.behaviour_key === nutritionKey);
  assert.equal(sleepEntry.media.preference, "paper");
  assert.equal(nutritionEntry.media.preference, "video");
  assert.equal(sleepEntry.frequency.requested_frequency, 2);
  const readOccurrence = sleepEntry.occurrences.find(item => item.nudge_id === "n1");
  assert.equal(readOccurrence.read_status, "read");
  assert.equal(readOccurrence.send_to_read_hours, 1.5);
  assert.equal(dictionary.behaviour_states.find(item => item.behaviour_key === nutritionKey).latest_occurrence.read_status, "unknown");
  assert.equal(dictionary.timeline.find(item => item.id === "dec-1").new_state.preferred_frequency, 2);
  assert.equal(stateExportRows(dictionary).length, 3);
  assert.ok(timelineExportRows(dictionary).some(row => row.event_id === "dec-1"));
});

test("adaptive decisions can change media and frequency only within the approved envelope", () => {
  const envelope = Object.assign(defaultEnvelope(Object.assign({}, sleep, { scheduled_time: "09:00", frequency_per_week: 3 })), { frequency_min: 2, frequency_max: 3 });
  const decision = decide({ event_type: "inbound_reply", body: "Please send shorter videos less often", envelope,
    assets: [{ asset_id: "video-1", media_kind: "video" }], state: { preferred_frequency: 3 } });
  assert.equal(decision.outcome, "applied");
  assert.equal(decision.next_state.preferred_format, "video");
  assert.equal(decision.next_state.preferred_summary_length, "short");
  assert.equal(decision.next_state.preferred_frequency, 2);
  const outside = decide({ event_type: "inbound_reply", body: "less often", envelope, assets: [], state: { preferred_frequency: 2 } });
  assert.equal(outside.outcome, "outside_envelope");
});

test("dictionary exports keep current state up to date and timeline rows append idempotently", async function (t) {
  const store = sheetFixture();
  t.after(() => store.restore());
  const dictionary = { patient: { user_id: "p1" }, global_state: { preferred_format: "video", state_version: 1, updated_at: "2026-08-10T00:00:00Z" },
    behaviour_states: [], generated_at: "2026-08-10T00:00:00Z", timeline: [{ id: "event-1", at: "2026-08-10T00:00:00Z", event_type: "adaptation_decision", source: "patient", scope: "global", signal: "inbound_reply", outcome: "applied", reason: "request accepted" }] };
  await exportPatientDictionary(dictionary);
  await exportPatientDictionary(dictionary);
  assert.equal(store.tables.patient_adaptation_state.rows.length, 1);
  assert.equal(store.tables.patient_adaptation_timeline.rows.length, 1);
  assert.equal(store.tables.patient_adaptation_timeline.rows[0].event_id, "event-1");
});
