"use strict";

const { behaviourKey, defaultEnvelope, decide, explicitInterpretation } = require("./adaptive-core");
const { httpError } = require("./http");
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
    const approved = await store.call("envelopeFor", userId, key);
    if (!approved) {
      await store.call("saveDraftEnvelope", Object.assign(defaultEnvelope(Object.assign({}, slot, {
        frequency_per_week: frequencyByPrescription.get(String(slot.prescription_id)) || 1
      })), { user_id: userId, behaviour_key: key, status: "draft", updated_at: new Date().toISOString() }));
    }
  }
  return queued;
}

async function processInteraction(event) {
  if (!event) return null;
  if (!event.behaviour_key) {
    const state = await store.call("globalAdaptationState", event.user_id);
    const envelope = { formats: ["video", "paper", "reading"], summary_lengths: ["short", "detailed"],
      tones: ["encouraging", "neutral_informational"], earliest_time: "00:00", latest_time: "23:59",
      frequency_min: 1, frequency_max: 7, action_alternatives: [] };
    const interpretation = event.event_type === "inbound_reply" ? await classifyReply(event.body, envelope) : undefined;
    const decision = decide({ event_type: event.event_type, body: event.body, state, envelope, assets: [], interpretation });
    return store.call("saveGlobalDecision", event, decision);
  }
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

async function validateMediaSelections(userId, slots, prescriptions) {
  const overrides = (slots || []).filter(slot => String(slot.media_selection_mode || "automatic") === "clinician_selected");
  if (!overrides.length) return;
  if (!store.configured()) throw httpError(503, "Adaptive media database is not configured");
  const prescriptionById = new Map((prescriptions || []).map(row => [String(row.prescription_id), row]));
  for (const slot of overrides) {
    const prescription = prescriptionById.get(String(slot.prescription_id)) || {};
    const key = behaviourKey(Object.assign({}, slot, { category: slot.category || prescription.category }));
    const envelope = await store.call("envelopeFor", userId, key);
    if (!envelope) throw httpError(409, "The selected media pool is not approved");
    const assets = await store.call("assetsFor", key, envelope.approved_asset_ids || []);
    if (!assets.some(asset => String(asset.asset_id) === String(slot.media_override_asset_id))) {
      throw httpError(400, "The selected media resource is not in this behaviour's approved pool");
    }
  }
}

module.exports = { queuePatientBehaviours, processInteraction, validateMediaSelections };
