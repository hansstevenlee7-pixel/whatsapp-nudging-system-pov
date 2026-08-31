"use strict";

const crypto = require("node:crypto");
const { request } = require("./supabase");

let testAdapter = null;
function configured() { return Boolean(testAdapter || (process.env.ADAPTIVE_MEDIA_ENABLED === "true" && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)); }
async function call(name, ...args) {
  if (testAdapter && testAdapter[name]) return testAdapter[name](...args);
  return operations[name](...args);
}
function q(value) { return encodeURIComponent(String(value)); }
function rows(value) { return Array.isArray(value) ? value : []; }
function stateVersion(state) { return Math.max(0, Number(state && state.state_version) || 0); }
function changedFields(previous, next) {
  const keys = ["preferred_format", "preferred_summary_length", "preferred_tone", "preferred_time", "preferred_frequency", "preferred_action", "last_asset_id"];
  return keys.filter(key => JSON.stringify(previous && previous[key] == null ? null : previous && previous[key]) !== JSON.stringify(next && next[key] == null ? null : next && next[key]));
}
function decisionSource(eventType, fallback = "system") {
  if (eventType === "inbound_reply" || eventType === "link_visit") return "patient";
  return fallback;
}
function decisionPayload(input, decision, extra = {}) {
  const previous = decision.previous_state || {};
  const next = decision.next_state || {};
  const selected = decision.selected_asset || null;
  const version = Number(decision.state_version) || stateVersion(previous) + 1;
  return Object.assign({
    user_id: input.user_id,
    behaviour_key: input.behaviour_key || null,
    interaction_id: input.interaction_id || null,
    nudge_id: input.nudge_id || null,
    signal_type: input.signal_type || input.event_type || "scheduled_selection",
    scope: input.scope || "behaviour",
    decision_source: input.decision_source || decisionSource(input.event_type || input.signal_type),
    effective_at: input.effective_at || new Date().toISOString(),
    state_version: version,
    interpretation: decision.interpretation || {},
    scores_before: decision.scores_before || {}, scores_after: decision.scores_after || {},
    rule_applied: decision.rule || "no_change", previous_state: previous, next_state: next,
    changed_fields: decision.changed_fields || changedFields(previous, next),
    frequency_before: Number.isFinite(Number(previous.preferred_frequency)) ? Number(previous.preferred_frequency) : null,
    frequency_after: Number.isFinite(Number(next.preferred_frequency)) ? Number(next.preferred_frequency) : null,
    media_mode_before: previous.media_selection_mode || null, media_mode_after: next.media_selection_mode || null,
    media_kind_before: previous.preferred_format || null, media_kind_after: next.preferred_format || selected && selected.media_kind || null,
    selected_asset_id: selected && selected.asset_id || null,
    outcome: decision.outcome, reason: decision.reason,
    fulfilled_at: decision.outcome === "applied" ? new Date().toISOString() : null
  }, extra);
}

const operations = {
  async queueSearch(job) {
    const existing = rows(await request(`/rest/v1/media_search_jobs?user_id=eq.${q(job.user_id)}&behaviour_key=eq.${q(job.behaviour_key)}&status=in.(pending,processing)&select=*`, {}, true))[0];
    if (existing) return existing;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const cached = rows(await request(`/rest/v1/media_search_jobs?user_id=eq.${q(job.user_id)}&behaviour_key=eq.${q(job.behaviour_key)}&status=eq.complete&completed_at=gte.${q(since)}&select=*&order=completed_at.desc&limit=1`, {}, true))[0];
    if (cached) return cached;
    return rows(await request("/rest/v1/media_search_jobs", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(job) }, true))[0];
  },
  async pendingSearch() {
    return rows(await request("/rest/v1/media_search_jobs?status=eq.pending&select=*&order=created_at.asc&limit=1", {}, true))[0] || null;
  },
  async updateSearch(jobId, changes) {
    return rows(await request(`/rest/v1/media_search_jobs?job_id=eq.${q(jobId)}`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(changes) }, true))[0];
  },
  async saveCandidates(candidates) {
    if (!candidates.length) return [];
    return request("/rest/v1/media_candidates?on_conflict=behaviour_key,source_url", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(candidates)
    }, true);
  },
  async candidates(behaviourKey) {
    return rows(await request(`/rest/v1/media_candidates?behaviour_key=eq.${q(behaviourKey)}&select=*&order=ranking_score.desc`, {}, true));
  },
  async saveDraftEnvelope(envelope) {
    return rows(await request("/rest/v1/adaptation_envelopes?on_conflict=user_id,behaviour_key", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(envelope)
    }, true))[0];
  },
  async approvePlan({ userId, behaviourKey, profileId, envelope, candidates }) {
    const assets = [];
    for (const candidate of candidates) {
      const payload = {
        candidate_id: candidate.candidate_id, behaviour_key: behaviourKey, media_kind: candidate.media_kind,
        title: candidate.title, source_name: candidate.source_name, source_url: candidate.source_url,
        short_summary: candidate.short_summary || "", detailed_summary: candidate.detailed_summary || "",
        limitations: candidate.limitations || "", status: "approved", approved_at: new Date().toISOString(), approved_by: profileId
      };
      const saved = rows(await request("/rest/v1/media_assets?on_conflict=behaviour_key,source_url", {
        method: "POST", headers: { prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(payload)
      }, true))[0];
      if (saved) assets.push(saved);
    }
    const approved = Object.assign({}, envelope, { user_id: userId, behaviour_key: behaviourKey, status: "approved",
      approved_asset_ids: assets.map(asset => asset.asset_id), approved_at: new Date().toISOString(), approved_by: profileId });
    const savedEnvelope = await operations.saveDraftEnvelope(approved);
    return { envelope: savedEnvelope, assets };
  },
  async plansForUser(userId) {
    const envelopes = rows(await request(`/rest/v1/adaptation_envelopes?user_id=eq.${q(userId)}&select=*&order=updated_at.desc`, {}, true));
    const jobs = rows(await request(`/rest/v1/media_search_jobs?user_id=eq.${q(userId)}&select=*&order=updated_at.desc&limit=50`, {}, true));
    const decisions = rows(await request(`/rest/v1/adaptation_decisions?user_id=eq.${q(userId)}&select=*&order=decided_at.desc&limit=100`, {}, true));
    const events = rows(await request(`/rest/v1/interaction_events?user_id=eq.${q(userId)}&select=*&order=event_at.desc&limit=100`, {}, true));
    const states = rows(await request(`/rest/v1/user_adaptation_state?user_id=eq.${q(userId)}&select=*&order=updated_at.desc`, {}, true));
    const globalState = rows(await request(`/rest/v1/patient_adaptation_state?user_id=eq.${q(userId)}&select=*`, {}, true))[0] || {};
    const keys = new Set(envelopes.map(item => item.behaviour_key));
    decisions.concat(states).forEach(item => { if (item.behaviour_key) keys.add(item.behaviour_key); });
    const candidates = rows(await request("/rest/v1/media_candidates?select=*&order=ranking_score.desc", {}, true))
      .filter(item => keys.has(item.behaviour_key));
    const allAssets = rows(await request(`/rest/v1/media_assets?select=*&order=created_at.asc`, {}, true));
    const historicalAssets = allAssets.filter(asset => keys.has(asset.behaviour_key));
    const visibleAssets = historicalAssets.filter(asset => asset.status === "approved");
    for (const asset of visibleAssets) {
      if (asset.storage_path) asset.preview_url = await operations.signedDownloadUrl(asset.storage_path, 900);
    }
    return { envelopes, candidates, assets: visibleAssets, historical_assets: historicalAssets, decisions, events, states, global_state: globalState, jobs };
  },
  async recordInteraction(event) {
    const saved = await request("/rest/v1/interaction_events?on_conflict=interaction_id", {
      method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(event)
    }, true);
    return { duplicate: !rows(saved).length, event: rows(saved)[0] || null };
  },
  async pendingInteraction() {
    return rows(await request("/rest/v1/interaction_events?processed_at=is.null&event_type=in.(inbound_reply,link_visit)&select=*&order=event_at.asc&limit=1", {}, true))[0] || null;
  },
  async envelopeFor(userId, behaviourKey) {
    return rows(await request(`/rest/v1/adaptation_envelopes?user_id=eq.${q(userId)}&behaviour_key=eq.${q(behaviourKey)}&status=eq.approved&select=*`, {}, true))[0] || null;
  },
  async assetsFor(behaviourKey, ids) {
    const all = rows(await request(`/rest/v1/media_assets?behaviour_key=eq.${q(behaviourKey)}&status=eq.approved&select=*`, {}, true));
    return ids && ids.length ? all.filter(asset => ids.includes(asset.asset_id)) : all;
  },
  async createSignedUpload(path) {
    const bucket = process.env.CLINICIAN_MEDIA_BUCKET || "clinician-media";
    const data = await request(`/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
      { method: "POST", body: "{}" }, true);
    if (!data || !data.url) throw new Error("Supabase did not return a signed upload URL");
    const url = new URL(String(data.url || ""), process.env.SUPABASE_URL);
    const token = url.searchParams.get("token");
    if (!token) throw new Error("Supabase did not return a signed upload token");
    return { bucket, path, token, signed_upload_url: url.toString() };
  },
  async objectInfo(path) {
    const bucket = process.env.CLINICIAN_MEDIA_BUCKET || "clinician-media";
    return request(`/storage/v1/object/info/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`, {}, true);
  },
  async signedDownloadUrl(path, expiresIn = 15552000) {
    const bucket = process.env.CLINICIAN_MEDIA_BUCKET || "clinician-media";
    const data = await request(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`,
      { method: "POST", body: JSON.stringify({ expiresIn }) }, true);
    if (!data || !data.signedURL) throw new Error("Supabase did not return a signed download URL");
    return new URL(String(data.signedURL || ""), process.env.SUPABASE_URL).toString();
  },
  async registerClinicianUpload(input) {
    const envelope = await operations.envelopeFor(input.user_id, input.behaviour_key);
    if (!envelope) throw new Error("The media pool must be approved before uploading a resource");
    const saved = rows(await request("/rest/v1/media_assets", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({
        behaviour_key: input.behaviour_key, media_kind: input.media_kind, title: input.title,
        source_name: "Clinician upload", source_url: `storage://${process.env.CLINICIAN_MEDIA_BUCKET || "clinician-media"}/${input.storage_path}`,
        short_summary: "Clinician-provided resource.", detailed_summary: "Clinician-provided resource.", limitations: "Uploaded by the treating clinician.",
        storage_path: input.storage_path, mime_type: input.mime_type, file_size: input.file_size,
        status: "approved", approved_at: new Date().toISOString(), approved_by: input.approved_by
      })
    }, true))[0];
    if (!saved) throw new Error("Uploaded media metadata was not saved");
    const ids = Array.from(new Set([...(envelope.approved_asset_ids || []), saved.asset_id]));
    await request(`/rest/v1/adaptation_envelopes?envelope_id=eq.${q(envelope.envelope_id)}`, {
      method: "PATCH", body: JSON.stringify({ approved_asset_ids: ids, updated_at: new Date().toISOString() })
    }, true);
    saved.preview_url = await operations.signedDownloadUrl(input.storage_path, 900);
    return saved;
  },
  async adaptationState(userId, behaviourKey) {
    return rows(await request(`/rest/v1/user_adaptation_state?user_id=eq.${q(userId)}&behaviour_key=eq.${q(behaviourKey)}&select=*`, {}, true))[0] || {};
  },
  async globalAdaptationState(userId) {
    return rows(await request(`/rest/v1/patient_adaptation_state?user_id=eq.${q(userId)}&select=*`, {}, true))[0] || {};
  },
  async saveDecision(event, decision) {
    const previous = decision.previous_state || {};
    const version = stateVersion(previous) + 1;
    const nextState = Object.assign({}, decision.next_state, { user_id: event.user_id, behaviour_key: event.behaviour_key,
      state_version: version, last_signal_at: event.event_at || new Date().toISOString(), updated_at: new Date().toISOString() });
    await request("/rest/v1/user_adaptation_state?on_conflict=user_id,behaviour_key", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(nextState)
    }, true);
    const row = rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(decisionPayload({ user_id: event.user_id,
        behaviour_key: event.behaviour_key, interaction_id: event.interaction_id, nudge_id: event.nudge_id, event_type: event.event_type,
        effective_at: event.event_at }, Object.assign({}, decision, { state_version: version })))
    }, true))[0];
    if (row && row.decision_id) await request(`/rest/v1/user_adaptation_state?user_id=eq.${q(event.user_id)}&behaviour_key=eq.${q(event.behaviour_key)}`, {
      method: "PATCH", body: JSON.stringify({ last_decision_id: row.decision_id })
    }, true);
    await request(`/rest/v1/interaction_events?interaction_id=eq.${q(event.interaction_id)}`, {
      method: "PATCH", body: JSON.stringify({ processed_at: new Date().toISOString() })
    }, true);
    return row;
  },
  async saveGlobalDecision(event, decision) {
    const previous = decision.previous_state || {};
    const version = stateVersion(previous) + 1;
    const nextState = Object.assign({}, decision.next_state, { user_id: event.user_id, state_version: version,
      last_signal_at: event.event_at || new Date().toISOString(), updated_at: new Date().toISOString() });
    await request("/rest/v1/patient_adaptation_state?on_conflict=user_id", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(nextState)
    }, true);
    const row = rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(decisionPayload({ user_id: event.user_id,
        interaction_id: event.interaction_id, event_type: event.event_type, scope: "global", decision_source: "patient",
        signal_type: event.event_type, effective_at: event.event_at }, Object.assign({}, decision, { state_version: version }), { behaviour_key: null }))
    }, true))[0];
    if (row && row.decision_id) await request(`/rest/v1/patient_adaptation_state?user_id=eq.${q(event.user_id)}`, {
      method: "PATCH", body: JSON.stringify({ last_decision_id: row.decision_id })
    }, true);
    await request(`/rest/v1/interaction_events?interaction_id=eq.${q(event.interaction_id)}`, {
      method: "PATCH", body: JSON.stringify({ processed_at: new Date().toISOString() })
    }, true);
    return row;
  },
  async saveSelectionDecision(input, decision) {
    const previous = decision.previous_state || {};
    const version = stateVersion(previous) + 1;
    const nextState = Object.assign({}, decision.next_state, { user_id: input.user_id, behaviour_key: input.behaviour_key,
      state_version: version, updated_at: new Date().toISOString() });
    await request("/rest/v1/user_adaptation_state?on_conflict=user_id,behaviour_key", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(nextState)
    }, true);
    return rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(decisionPayload({ user_id: input.user_id,
        behaviour_key: input.behaviour_key, nudge_id: input.nudge_id, signal_type: "scheduled_selection", decision_source: "system" },
        Object.assign({}, decision, { state_version: version })))
    }, true))[0];
  },
  async recordClinicianDecision(input) {
    const previous = input.previous_state || {};
    const next = input.next_state || {};
    const payload = decisionPayload({ user_id: input.user_id, behaviour_key: input.behaviour_key, nudge_id: input.nudge_id,
      signal_type: "clinician_schedule_change", decision_source: "clinician", scope: input.scope || "behaviour",
      effective_at: input.effective_at }, { previous_state: previous, next_state: next, changed_fields: input.changed_fields,
      interpretation: input.interpretation || {}, scores_before: {}, scores_after: {}, rule: "clinician_saved_schedule",
      outcome: "applied", reason: input.reason || "Clinician saved a schedule or media change" });
    return rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(payload)
    }, true))[0];
  },
  async saveShadowFrequencyDecisions(decisions) {
    if (!Array.isArray(decisions) || decisions.length !== 2) throw new Error("A shadow frequency evaluation requires recommendation and policy rows");
    return rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(decisions)
    }, true));
  },
  async savePolicyEvaluation(decisions, stateUpdate) {
    if (!Array.isArray(decisions) || decisions.length !== 2) throw new Error("An adaptive evaluation requires recommendation and policy rows");
    if (stateUpdate && stateUpdate.user_id && stateUpdate.behaviour_key) {
      await request("/rest/v1/user_adaptation_state?on_conflict=user_id,behaviour_key", {
        method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(stateUpdate)
      }, true);
    }
    return rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(decisions)
    }, true));
  },
  async createTrackedLink(input) {
    const token = crypto.randomBytes(24).toString("base64url");
    const expires = new Date(Date.now() + 180 * 86400000).toISOString();
    const saved = rows(await request("/rest/v1/tracked_links", { method: "POST", headers: { prefer: "return=representation" },
      body: JSON.stringify(Object.assign({ token, expires_at: expires }, input)) }, true))[0];
    return saved;
  },
  async visitLink(token, now) {
    const link = rows(await request(`/rest/v1/tracked_links?token=eq.${q(token)}&select=*`, {}, true))[0];
    if (!link || Date.parse(link.expires_at) <= Date.parse(now)) return null;
    const updated = rows(await request(`/rest/v1/tracked_links?token=eq.${q(token)}`, { method: "PATCH", headers: { prefer: "return=representation" },
      body: JSON.stringify({ visit_count: Number(link.visit_count || 0) + 1, first_visited_at: link.first_visited_at || now, last_visited_at: now }) }, true))[0];
    return updated;
  }
};

async function optional(name, ...args) {
  if (!configured()) return null;
  return call(name, ...args);
}

module.exports = { configured, optional, call, _setTestAdapter(value) { testAdapter = value; } };
