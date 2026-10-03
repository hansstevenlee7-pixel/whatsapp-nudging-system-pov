"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");
const { sha, eligible, publicContext } = require("./core");

const PROMPT = `You are a bounded weekly communication-frequency policy in a synthetic research experiment.
For EACH listed context, select an eligible frequency of 1, 2, or 3 messages per week to maximise ordinary interactions per delivered message.
Ordinary interaction means a tracked-link visit or ordinary reply within 24 hours, NOT adherence or health benefit.
The contexts enumerate ALL possible four-message history states, not an actual user population or its distribution.
Evaluate every context independently. You receive only observed data. Do not invent user preferences or assume that silence implies a preference.
Use current context and historical evidence; lower frequency breaks a true tie. Never choose outside eligible_frequencies.
The training_cells table contains exact counts, not recommendations. Columns are:
[current_frequency, recent_interaction_rate, noninteraction_streak, has_previous_interaction, candidate_frequency, delivered_count, interaction_count].
History features use the last four observed message outcomes. current_frequency is the preceding week's assigned frequency;
candidate_frequency is the frequency assigned for the row's week. History can change between messages within a week.
The candidate-times-rate and candidate-times-streak interactions can be derived from these columns.
Rows with the same feature values are combined without loss of counts. Absence of a cell is not a zero response probability.
All training cells precede the current decision week. No hidden user characteristics or future responses are available.
Return only JSON with a decisions array containing each context_index exactly once, its integer frequency, and a brief evidence-based reason (at most 20 words).`;

function policyContexts() {
  const contexts = new Map();
  for (const frequency of [1, 2, 3]) for (let bits = 0; bits < 16; bits++) {
    const context = publicContext(frequency, [0, 1, 2, 3].map(i => (bits >> i) & 1));
    if (eligible(context).length > 1) contexts.set(JSON.stringify(context), context);
  }
  return [...contexts.values()].map((context, context_index) => ({ context_index, ...context, eligible_frequencies: eligible(context) }));
}
const CONTEXTS = policyContexts();
function contextIndex(context) {
  const index = CONTEXTS.findIndex(c => Object.keys(context).every(k => c[k] === context[k]));
  if (index < 0) throw new Error("Context is outside the exhaustive four-message state space");
  return index;
}

function loadKey(root) {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  for (const name of [".env.local", "landing/.env.local", "n8n.env"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const key = parseEnv(fs.readFileSync(file, "utf8")).GEMINI_API_KEY;
    if (key && /^AIza[\w-]{30,}$/.test(key)) return key;
  }
  return null;
}
function requestBody(context, cells) {
  return {
    systemInstruction: { parts: [{ text: PROMPT }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ contexts: CONTEXTS, training_cells: cells }) }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: {
        decisions: { type: "array", minItems: CONTEXTS.length, maxItems: CONTEXTS.length, items: {
          type: "object", properties: { context_index: { type: "integer" },
            frequency: { type: "integer", enum: [1, 2, 3] }, reason: { type: "string" } },
          required: ["context_index", "frequency", "reason"], additionalProperties: false } }
      }, required: ["decisions"], additionalProperties: false } }
  };
}
function parseTable(body) {
  const candidate = body.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new Error("incomplete_or_blocked_output");
  const raw = (candidate.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("invalid_json"); }
  if (!parsed || Object.keys(parsed).join(",") !== "decisions" || !Array.isArray(parsed.decisions) || parsed.decisions.length !== CONTEXTS.length) throw new Error("invalid_table");
  const seen = new Set();
  for (const choice of parsed.decisions) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice) ||
        Object.keys(choice).sort().join(",") !== "context_index,frequency,reason" ||
        !Number.isInteger(choice.context_index) || !CONTEXTS[choice.context_index] || seen.has(choice.context_index) ||
        !Number.isInteger(choice.frequency) || !CONTEXTS[choice.context_index].eligible_frequencies.includes(choice.frequency) ||
        typeof choice.reason !== "string" || !choice.reason.trim() || choice.reason.length > 1000) throw new Error("invalid_choice");
    seen.add(choice.context_index);
  }
  return parsed.decisions.sort((a, b) => a.context_index - b.context_index);
}
function parseChoice(body, context) { return parseTable(body)[contextIndex(context)]; }
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(file + ".tmp", file);
}
class Paused extends Error { constructor(reason) { super(reason); this.name = "ExperimentPaused"; } }

class GeminiPolicy {
  constructor({ root, out, model = "gemini-2.5-flash", freeTierConfirmed = false, fetchImpl = fetch, waitImpl,
    intervalMs = 13000, maxCalls = 1200 }) {
    Object.assign(this, { root, out, model, freeTierConfirmed, fetchImpl, intervalMs, maxCalls });
    this.wait = waitImpl || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.lastCall = 0; this.calls = 0;
  }
  async choose(context, cells) {
    if (eligible(context).length === 1) return { proposed_frequency: eligible(context)[0], source: "forced_by_constraints", fallback: false };
    const body = requestBody(context, cells), cacheKey = sha({ model: this.model, body });
    const file = path.join(this.out, "llm-cache", cacheKey + ".json");
    if (fs.existsSync(file)) {
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      if (saved.cache_key !== cacheKey || saved.model !== this.model || sha(saved.request) !== sha(body)) throw new Error("LLM cache mismatch");
      const choice = saved.table[contextIndex(context)];
      return { ...saved.metadata, proposed_frequency: choice.frequency, reason: choice.reason, context_index: choice.context_index, cache_key: cacheKey, cache_hit: true };
    }
    if (!this.freeTierConfirmed) throw new Paused("free_tier_billing_status_unconfirmed");
    const key = loadKey(this.root);
    if (!key) throw new Paused("gemini_api_key_missing");
    const attempts = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.calls >= this.maxCalls) throw new Paused("session_api_call_cap");
      const delay = Math.max(0, this.lastCall + this.intervalMs - Date.now());
      if (delay) await this.wait(delay);
      this.lastCall = Date.now(); this.calls++;
      const started = Date.now();
      let response, result;
      try {
        response = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body), signal: AbortSignal.timeout(45000)
        });
        result = await response.json();
      } catch (error) {
        attempts.push({ status: "transport_error", error: error.name, latency_ms: Date.now() - started });
        if (attempt < 2) continue;
        // Transport outage is not a policy decision. Resume later with the same inputs.
        writeJSON(path.join(this.out, "llm-errors", cacheKey + ".json"), { cache_key: cacheKey, attempts });
        throw new Paused("gemini_transport_unavailable");
      }
      // Only store selected non-secret metadata from errors, never headers or credentials.
      attempts.push({ status: response.status, latency_ms: Date.now() - started,
        usage: result.usageMetadata || null, model_version: result.modelVersion || null });
      if (!response.ok) {
        if (response.status === 429 || [400, 401, 403, 404].includes(response.status)) {
          const error = { http_status: response.status, status: result.error?.status,
            message: String(result.error?.message || "").replaceAll(key, "[REDACTED]"),
            quota: (result.error?.details || []).filter(d => String(d["@type"]).includes("QuotaFailure")) };
          writeJSON(path.join(this.out, "llm-errors", cacheKey + ".json"), { cache_key: cacheKey, attempts, error });
          throw new Paused(response.status === 429 ? "gemini_quota_exhausted" : `gemini_http_${response.status}`);
        }
        if (attempt < 2) continue;
        writeJSON(path.join(this.out, "llm-errors", cacheKey + ".json"), { cache_key: cacheKey, attempts });
        throw new Paused("gemini_service_unavailable");
      }
      let table;
      try { table = parseTable(result); } catch (error) {
        attempts[attempt].validation_error = error.message;
        if (attempt < 2) continue;
      }
      const valid = Boolean(table);
      if (!table) table = CONTEXTS.map(c => ({ context_index: c.context_index, frequency: c.current_frequency, reason: "invalid_output_after_three_attempts_hold" }));
      const metadata = { source: "gemini", fallback: !valid,
        attempts, model_version: result.modelVersion || this.model };
      writeJSON(file, { cache_key: cacheKey, model: this.model, request: body, response: result, table, metadata });
      const choice = table[contextIndex(context)];
      return { ...metadata, proposed_frequency: choice.frequency, reason: choice.reason, context_index: choice.context_index, cache_key: cacheKey, cache_hit: false };
    }
    throw new Error("Unreachable Gemini state");
  }
}

module.exports = { PROMPT, CONTEXTS, contextIndex, requestBody, parseTable, parseChoice, loadKey, writeJSON, Paused, GeminiPolicy };
