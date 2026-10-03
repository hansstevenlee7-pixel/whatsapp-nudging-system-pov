"use strict";

// Separate taxonomy-context LLM arm. It never touches the original frequency
// comparison or clinical delivery path. Resumable at the completed-week boundary.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { generateDataset, datasetHash, scheduledSlot, historyFeatures, probability, VERSION } = require("./generate");
const { stableUniform } = require("../generate-frequency-dataset");
const { eligible, applySafety } = require("../frequency-comparison/core");
const { loadKey, writeJSON } = require("../frequency-comparison/gemini");
const { OUT, ROOT, SEEDS } = require("./local-run");

const MODEL = "gemini-2.5-flash";
const PROMPT = `You are a frequency-selection policy for a synthetic research experiment.
For each independent context, choose 1, 2, or 3 clinician-approved messages per week from eligible_frequencies.
The first N prewritten slots would be sent if you choose frequency N. You may not alter their action, pillar, category, nudge type or tone.
Aim for ordinary clicks or replies per delivered message. An interaction is not adherence or health improvement.
The table is observed synthetic training evidence: [frequency, approved_action_text, nudge_type, tone_variant, delivered_count, interaction_count].
Behaviour labels, recent contexts and planned slots are observable. The simulator's hidden response tendencies and future outcomes are unavailable.
Treat the 30 cases independently. Never infer a preference from silence. Choose only an eligible frequency.
Return one JSON decision per index, with an integer frequency and reason of at most 15 words.`;
const sha = v => crypto.createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
function number(id) { return Number(id.slice(4)); }
function historyContext(state) {
  const last = state.events.slice(-4);
  return { current_frequency: state.current,
    recent_interaction_rate: last.reduce((s, e) => s + e.interacted_within_24h, 0) / last.length,
    recent_events: last.map(e => ({ pillar: e.pillar, category: e.category, nudge_type: e.nudge_type,
      tone_variant: e.tone_variant, interacted_within_24h: e.interacted_within_24h })) };
}
function summarizeTraining(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.candidate_frequency, row.action_text, row.nudge_type, row.tone_variant]);
    if (!grouped.has(key)) grouped.set(key, [...JSON.parse(key), 0, 0]);
    const record = grouped.get(key); record[4]++; record[5] += row.interacted_within_24h;
  }
  return [...grouped.values()].sort((a, b) => JSON.stringify(a.slice(0, 4)).localeCompare(JSON.stringify(b.slice(0, 4))));
}
function requestBody(states, hidden, week, seed, training) {
  const contexts = states.map((state, index) => {
    const user = hidden.get(state.id);
    const context = historyContext(state);
    return { index, current_frequency: context.current_frequency,
      recent_interaction_rate: context.recent_interaction_rate, recent_events: context.recent_events,
      eligible_frequencies: eligible(context),
      approved_slots: [1, 2, 3].map(i => scheduledSlot(user, week, i, seed)) };
  });
  const schema = { type: "object", properties: { decisions: { type: "array", minItems: states.length,
    maxItems: states.length, items: { type: "object", properties: {
      index: { type: "integer" }, frequency: { type: "integer", enum: [1, 2, 3] }, reason: { type: "string" }
    }, required: ["index", "frequency", "reason"], additionalProperties: false } } },
  required: ["decisions"], additionalProperties: false };
  return { systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({
      meaning: "one batch of independent weekly decisions; no current-week outcome yet",
      behaviour_labels: [...new Set(training.map(r => r.action_text))],
      training_table: summarizeTraining(training), contexts
    }) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json", responseJsonSchema: schema } };
}
function parseTable(response, contexts) {
  const candidate = response.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new Error("incomplete_or_blocked_output");
  const raw = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("invalid_json"); }
  if (!parsed || Object.keys(parsed).join(",") !== "decisions" || !Array.isArray(parsed.decisions) || parsed.decisions.length !== contexts.length) throw new Error("invalid_table");
  const seen = new Set();
  for (const d of parsed.decisions) {
    if (!d || Object.keys(d).sort().join(",") !== "frequency,index,reason" ||
        !Number.isInteger(d.index) || !contexts[d.index] || seen.has(d.index) ||
        !Number.isInteger(d.frequency) || !contexts[d.index].eligible_frequencies.includes(d.frequency) ||
        typeof d.reason !== "string" || !d.reason.trim() || d.reason.length > 600) throw new Error("invalid_decision");
    seen.add(d.index);
  }
  return parsed.decisions.sort((a, b) => a.index - b.index);
}
class Paused extends Error { constructor(reason) { super(reason); this.name = "ExperimentPaused"; } }
class GeminiBatch {
  constructor({ out = OUT, fetchImpl = fetch, intervalMs = 13000, confirmedFreeTier = false, maxCalls = 25 }) {
    Object.assign(this, { out, fetchImpl, intervalMs, confirmedFreeTier, maxCalls });
    this.calls = 0; this.lastCall = 0;
  }
  async choose(body) {
    const input = JSON.parse(body.contents[0].parts[0].text);
    const contexts = input.contexts;
    const key = sha({ model: MODEL, body });
    const file = path.join(this.out, "gemini", "cache", key + ".json");
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved.cache_key !== key || sha(saved.request) !== sha(body)) throw new Error("LLM cache mismatch");
      return { table: saved.table, metadata: saved.metadata, cache_key: key, cache_hit: true };
    }
    if (!this.confirmedFreeTier) throw new Paused("free_tier_not_confirmed");
    const credential = loadKey(ROOT);
    if (!credential) throw new Paused("gemini_key_missing");
    const attempts = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.calls >= this.maxCalls) throw new Paused("session_call_cap");
      const delay = Math.max(0, this.lastCall + this.intervalMs - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      this.lastCall = Date.now(); this.calls++;
      const started = Date.now();
      let response, result;
      try {
        response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": credential },
          body: JSON.stringify(body), signal: AbortSignal.timeout(60000)
        });
        result = await response.json();
      } catch (error) {
        attempts.push({ status: "transport_error", error_name: error.name, latency_ms: Date.now() - started });
        if (attempt < 2) continue;
        writeJSON(path.join(this.out, "gemini", "errors", key + ".json"), { cache_key: key, attempts });
        throw new Paused("gemini_transport_unavailable");
      }
      attempts.push({ status: response.status, latency_ms: Date.now() - started,
        usage: result.usageMetadata || null, model_version: result.modelVersion || null });
      if (!response.ok) {
        const error = { http_status: response.status, status: result.error?.status,
          message: String(result.error?.message || "").replaceAll(credential, "[REDACTED]"),
          quota: (result.error?.details || []).filter(d => String(d["@type"]).includes("QuotaFailure")) };
        writeJSON(path.join(this.out, "gemini", "errors", key + ".json"), { cache_key: key, error, attempts });
        if (response.status === 429) throw new Paused("gemini_quota_exhausted");
        if ([400, 401, 403, 404].includes(response.status)) throw new Paused(`gemini_http_${response.status}`);
        if (attempt < 2) continue;
        throw new Paused("gemini_service_unavailable");
      }
      let table;
      try { table = parseTable(result, contexts); } catch (error) {
        attempts[attempt].validation_error = error.message;
        if (attempt < 2) continue;
      }
      const fallback = !table;
      if (!table) table = contexts.map(c => ({ index: c.index, frequency: c.current_frequency, reason: "invalid_table_hold" }));
      const metadata = { model_version: result.modelVersion || MODEL, fallback, attempts };
      writeJSON(file, { cache_key: key, request: body, response: result, table, metadata });
      return { table, metadata, cache_key: key, cache_hit: false };
    }
    throw new Error("Unreachable LLM state");
  }
}
function initialize(data) {
  const states = data.users.filter(u => number(u.synthetic_user_id) >= 271).map(user => {
    const past = data.rows.filter(r => r.synthetic_user_id === user.synthetic_user_id && r.week <= 8);
    return { id: user.synthetic_user_id, current: past.at(-1).candidate_frequency, events: past };
  });
  return { seed: data.seed, version: VERSION, next_week: 9, complete: false, states, decisions: [], feedback: [], weeks: [] };
}
async function replay(data, client, out = OUT) {
  const file = path.join(out, "gemini", "checkpoints", `${data.seed}.json`);
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : initialize(data);
  if (state.seed !== data.seed || state.version !== VERSION) throw new Error("Gemini checkpoint mismatch");
  const hidden = new Map(data.users.map(u => [u.synthetic_user_id, u]));
  const initial = data.rows.filter(r => number(r.synthetic_user_id) <= 240 && r.week <= 8);
  while (!state.complete) {
    const week = state.next_week;
    const body = requestBody(state.states, hidden, week, data.seed, [...initial, ...state.feedback]);
    const response = await client.choose(body);
    const contexts = JSON.parse(body.contents[0].parts[0].text).contexts;
    const pending = response.table.map((d, index) => {
      const c = contexts[index], applied = applySafety(d.frequency, c);
      return { seed: data.seed, week, synthetic_user_id: state.states[index].id,
        context: c, proposed_frequency: d.frequency, applied_frequency: applied.frequency,
        reason: d.reason, fallback: response.metadata.fallback, cache_key: response.cache_key,
        safety_rejected: applied.rejected };
    });
    // Whole weekly batch fixed before any of its outcomes is generated.
    for (const decision of pending) {
      const user = hidden.get(decision.synthetic_user_id);
      const person = state.states.find(s => s.id === decision.synthetic_user_id);
      const prior = person.current, outcomes = [];
      for (let message = 1; message <= decision.applied_frequency; message++) {
        const slot = scheduledSlot(user, week, message, data.seed);
        const history = historyFeatures(person.events, slot);
        const y = Number(stableUniform(data.seed, person.id, week, message, "taxonomy-policy-response-v2") <
          probability(user, decision.applied_frequency, slot, history));
        const row = { synthetic_user_id: person.id, week, ...slot,
          current_frequency: prior, candidate_frequency: decision.applied_frequency,
          ...history, interacted_within_24h: y };
        person.events.push(row); state.feedback.push(row); outcomes.push(y);
      }
      person.current = decision.applied_frequency; decision.observed_outcomes = outcomes;
    }
    state.decisions.push(...pending);
    const weekRows = state.feedback.filter(r => r.week === week);
    state.weeks.push({ week, delivered_messages: weekRows.length,
      ordinary_interactions: weekRows.reduce((s, r) => s + r.interacted_within_24h, 0) });
    state.next_week++; state.complete = state.next_week > 12;
    writeJSON(file, state);
    console.log(JSON.stringify({ policy: "gemini", seed: data.seed, week, messages: weekRows.length }));
  }
  return state;
}
function refresh(out = OUT, pause = null) {
  const dir = path.join(out, "gemini", "checkpoints");
  const states = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
  const local = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
  const complete = states.filter(s => s.complete);
  const rows = complete.map(s => {
    const messages = s.feedback.length, interactions = s.feedback.reduce((sum, r) => sum + r.interacted_within_24h, 0);
    return { seed: s.seed, delivered_messages: messages, ordinary_interactions: interactions,
      interactions_per_message: interactions / messages,
      constraint_violations: s.decisions.filter(d => !d.context.eligible_frequencies.includes(d.applied_frequency)).length,
      fallback_decisions: s.decisions.filter(d => d.fallback).length };
  });
  const comparison = rows.map(row => {
    const baseline = local.per_seed.find(r => r.policy === "greedy_logistic" && r.seed === row.seed);
    return { seed: row.seed, gemini_minus_logistic: row.interactions_per_message - baseline.interactions_per_message,
      gemini_messages_minus_logistic: row.delivered_messages - baseline.delivered_messages };
  });
  const result = { complete: complete.length === SEEDS.length, completed_seeds: complete.length,
    requested_seeds: SEEDS.length, pause, gemini_per_seed: rows,
    matched_logistic_comparison: comparison,
    note: "Gemini receives a compressed training contingency table, while the fitted LR and bandit use all row-level features. This limits direct algorithmic fairness claims. Do not compare across different simulator versions." };
  writeJSON(path.join(out, "gemini", "results.json"), result);
  return result;
}
async function main(argv = process.argv.slice(2)) {
  const legacy = path.join(ROOT, "output/frequency_comparison_2026-09-30/results.json");
  if (!argv.includes("--skip-legacy-check")) {
    const prior = JSON.parse(fs.readFileSync(legacy, "utf8"));
    if (!prior.complete) { console.log("Waiting for the existing approved Gemini comparison to finish first."); return; }
  }
  const file = path.join(OUT, "gemini", "manifest.json");
  const sources = ["scripts/taxonomy-frequency/generate.js", "scripts/taxonomy-frequency/model.js",
    "scripts/taxonomy-frequency/local-run.js", "scripts/taxonomy-frequency/gemini-run.js", "lifestyle_nudging_schema.json"];
  const hashes = Object.fromEntries(sources.map(p => [p, sha(fs.readFileSync(path.join(ROOT, p), "utf8"))]));
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (JSON.stringify(saved.source_sha256) !== JSON.stringify(hashes) || saved.prompt_sha256 !== sha(PROMPT)) throw new Error("Gemini experiment source or prompt changed; use a new output directory");
  } else writeJSON(file, { version: VERSION, model: MODEL, source_sha256: hashes,
    prompt_sha256: sha(PROMPT), requested_seeds: SEEDS, known_limitations: ["training contingency summary, not all original rows", "fixed temperature does not guarantee stable outputs across model updates"] });
  const client = new GeminiBatch({ confirmedFreeTier: argv.includes("--free-tier-confirmed") });
  let pause = null;
  try {
    for (const seed of SEEDS) {
      const data = generateDataset({ seed });
      const expected = JSON.parse(fs.readFileSync(path.join(OUT, "manifest.json"), "utf8")).dataset_sha256[seed];
      if (datasetHash(data.rows) !== expected) throw new Error("Taxonomy dataset hash changed");
      await replay(data, client);
    }
  } catch (error) {
    if (!(error instanceof Paused)) throw error;
    pause = error.message;
    console.log(JSON.stringify({ paused: pause }));
  } finally { refresh(OUT, pause); }
  if (pause) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { MODEL, PROMPT, summarizeTraining, requestBody, parseTable,
  GeminiBatch, initialize, replay, refresh, main };
