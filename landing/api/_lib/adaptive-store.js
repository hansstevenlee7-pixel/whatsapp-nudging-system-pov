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
    const keys = new Set(envelopes.map(item => item.behaviour_key));
    const candidates = rows(await request("/rest/v1/media_candidates?select=*&order=ranking_score.desc", {}, true))
      .filter(item => keys.has(item.behaviour_key));
    const assets = rows(await request(`/rest/v1/media_assets?status=eq.approved&select=*&order=created_at.asc`, {}, true));
    const decisions = rows(await request(`/rest/v1/adaptation_decisions?user_id=eq.${q(userId)}&select=*&order=decided_at.desc&limit=100`, {}, true));
    const events = rows(await request(`/rest/v1/interaction_events?user_id=eq.${q(userId)}&select=*&order=event_at.desc&limit=100`, {}, true));
    return { envelopes, candidates, assets: assets.filter(asset => keys.has(asset.behaviour_key)), decisions, events };
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
  async adaptationState(userId, behaviourKey) {
    return rows(await request(`/rest/v1/user_adaptation_state?user_id=eq.${q(userId)}&behaviour_key=eq.${q(behaviourKey)}&select=*`, {}, true))[0] || {};
  },
  async saveDecision(event, decision) {
    const nextState = Object.assign({}, decision.next_state, { user_id: event.user_id, behaviour_key: event.behaviour_key, updated_at: new Date().toISOString() });
    await request("/rest/v1/user_adaptation_state?on_conflict=user_id,behaviour_key", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(nextState)
    }, true);
    const row = rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({
        user_id: event.user_id, behaviour_key: event.behaviour_key, interaction_id: event.interaction_id,
        signal_type: event.event_type, interpretation: decision.interpretation, scores_before: decision.scores_before,
        scores_after: decision.scores_after, rule_applied: decision.rule, previous_state: decision.previous_state,
        next_state: decision.next_state, selected_asset_id: decision.selected_asset && decision.selected_asset.asset_id || null,
        outcome: decision.outcome, reason: decision.reason, fulfilled_at: decision.outcome === "applied" ? new Date().toISOString() : null
      })
    }, true))[0];
    await request(`/rest/v1/interaction_events?interaction_id=eq.${q(event.interaction_id)}`, {
      method: "PATCH", body: JSON.stringify({ processed_at: new Date().toISOString() })
    }, true);
    return row;
  },
  async saveSelectionDecision(input, decision) {
    const nextState = Object.assign({}, decision.next_state, { user_id: input.user_id, behaviour_key: input.behaviour_key, updated_at: new Date().toISOString() });
    await request("/rest/v1/user_adaptation_state?on_conflict=user_id,behaviour_key", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify(nextState)
    }, true);
    return rows(await request("/rest/v1/adaptation_decisions", {
      method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({
        user_id: input.user_id, behaviour_key: input.behaviour_key, interaction_id: null, signal_type: "scheduled_selection",
        interpretation: decision.interpretation || {}, scores_before: decision.scores_before || {}, scores_after: decision.scores_after || {},
        rule_applied: decision.rule, previous_state: decision.previous_state || {}, next_state: decision.next_state || {},
        selected_asset_id: decision.selected_asset && decision.selected_asset.asset_id || null, outcome: decision.outcome, reason: decision.reason,
        fulfilled_at: null
      })
    }, true))[0];
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
