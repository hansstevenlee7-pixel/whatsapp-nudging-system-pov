"use strict";

const { behaviourKey, defaultEnvelope, decide, explicitInterpretation } = require("./adaptive-core");
const store = require("./adaptive-store");
const { classifyReply } = require("./reply-classifier");

async function queuePatientBehaviours(userId, slots, prescriptions) {
  if (!store.configured()) return [];
  const frequencyByPrescription = new Map((prescriptions || []).map(row => [String(row.prescription_id), Number(row.frequency_per_week) || 1]));
  const seen = new Set(); const queued = [];
  for (const slot of slots || []) {
    const key = behaviourKey(slot);
    if (seen.has(key)) continue;
    seen.add(key);
    const job = { behaviour_key: key, user_id: userId, prescription_id: String(slot.prescription_id || ""),
      action_text: slot.action_text, pillar: slot.pillar, category: slot.category, status: "pending", updated_at: new Date().toISOString() };
    queued.push(await store.call("queueSearch", job));
    await store.call("saveDraftEnvelope", Object.assign(defaultEnvelope(Object.assign({}, slot, {
      frequency_per_week: frequencyByPrescription.get(String(slot.prescription_id)) || 1
    })), { user_id: userId, behaviour_key: key, status: "draft", updated_at: new Date().toISOString() }));
  }
  return queued;
}

async function processInteraction(event) {
  if (!event || !event.behaviour_key) return null;
  const envelope = await store.call("envelopeFor", event.user_id, event.behaviour_key);
  if (!envelope) {
    const decision = { outcome: "outside_envelope", rule: "no_approved_envelope", reason: "No approved adaptive plan",
      interpretation: explicitInterpretation(event.body), previous_state: {}, next_state: {}, scores_before: {}, scores_after: {} };
    return store.call("saveDecision", event, decision);
  }
  const state = await store.call("adaptationState", event.user_id, event.behaviour_key);
  const assets = await store.call("assetsFor", event.behaviour_key, envelope.approved_asset_ids || []);
  const selectedAsset = event.asset_id ? assets.find(asset => asset.asset_id === event.asset_id) : null;
  const interpretation = event.event_type === "inbound_reply" ? await classifyReply(event.body, envelope) : undefined;
  const decision = decide({ event_type: event.event_type, body: event.body, asset_kind: selectedAsset && selectedAsset.media_kind,
    state, envelope, assets, interpretation });
  return store.call("saveDecision", event, decision);
}

module.exports = { queuePatientBehaviours, processInteraction };
