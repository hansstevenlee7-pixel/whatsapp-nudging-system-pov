"use strict";

const core = require("../landing/api/_lib/adaptive-core");

const behaviour = {
  action_text: "Walk for 20 minutes",
  pillar: "physical_activity",
  category: "increase"
};

const assets = [
  { asset_id: "demo-video-1", media_kind: "video", title: "A short walking video" },
  { asset_id: "demo-video-2", media_kind: "video", title: "An alternative walking video" },
  { asset_id: "demo-paper-1", media_kind: "paper", title: "Walking and health research summary" },
  { asset_id: "demo-reading-1", media_kind: "reading", title: "Plain-language walking guide" }
];

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function generateFixture() {
  const envelope = Object.assign(core.defaultEnvelope(Object.assign({}, behaviour, {
    scheduled_time: "09:00", frequency_per_week: 3
  })), {
    status: "approved",
    earliest_time: "08:00",
    latest_time: "20:00",
    frequency_min: 2,
    frequency_max: 4
  });

  let state = { preferred_frequency: 3, format_scores: {}, asset_history: [] };
  const decisions = [];
  const run = event => {
    const decision = core.decide(Object.assign({ envelope, assets, state }, event));
    decisions.push(Object.assign({
      event_id: `demo-event-${String(decisions.length + 1).padStart(2, "0")}`,
      synthetic: true
    }, clone(event), clone(decision)));
    state = clone(decision.next_state);
  };

  run({ event_type: "delivery_status", status: "read", sent_at: "2026-08-17T09:00:00+10:00",
    read_at: "2026-08-17T09:42:00+10:00" });
  run({ event_type: "inbound_reply", body: "I prefer videos" });
  run({ event_type: "inbound_reply", body: "Please make it shorter" });
  run({ event_type: "inbound_reply", body: "Send it at 6:30pm" });
  run({ event_type: "link_visit", asset_id: "demo-video-1", asset_kind: "video" });
  run({ event_type: "scheduled_selection", observation: "no observable interaction in the window" });
  run({ event_type: "inbound_reply", body: "Send it at 11pm" });
  run({ event_type: "inbound_reply", body: "Send messages more often" });
  run({ event_type: "inbound_reply", body: "Send messages more often" });

  return {
    fixture_id: "adaptive-ui-demo-v1",
    synthetic: true,
    outcome_boundary: "Signals represent exposure, interaction, and request fulfilment only; they are not adherence or clinical outcomes.",
    behaviour,
    envelope,
    assets,
    decisions,
    final_state: state
  };
}

if (require.main === module) process.stdout.write(`${JSON.stringify(generateFixture(), null, 2)}\n`);

module.exports = { generateFixture };
