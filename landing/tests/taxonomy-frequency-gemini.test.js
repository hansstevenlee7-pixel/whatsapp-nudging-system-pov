"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { generateDataset } = require("../../scripts/taxonomy-frequency/generate");
const { summarizeTraining, requestBody, parseTable, initialize, GeminiBatch, replay } = require("../../scripts/taxonomy-frequency/gemini-run");

function fixture() {
  const data = generateDataset({ users: 300, weeks: 12 });
  const state = initialize(data), hidden = new Map(data.users.map(u => [u.synthetic_user_id, u]));
  const training = data.rows.filter(r => Number(r.synthetic_user_id.slice(4)) <= 240 && r.week <= 8);
  const body = requestBody(state.states, hidden, 9, data.seed, training);
  const contexts = JSON.parse(body.contents[0].parts[0].text).contexts;
  const decisions = contexts.map(c => ({ index: c.index, frequency: c.eligible_frequencies[0], reason: "test fixture" }));
  const response = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ decisions }) }] } }], modelVersion: "fixture" };
  return { data, state, body, contexts, decisions, response };
}
test("training summary counts exactly all source messages and interactions", () => {
  const data = generateDataset({ users: 40, weeks: 5 });
  const cells = summarizeTraining(data.rows);
  assert.equal(cells.reduce((s, c) => s + c[4], 0), data.rows.length);
  assert.equal(cells.reduce((s, c) => s + c[5], 0), data.rows.reduce((s, r) => s + r.interacted_within_24h, 0));
});
test("LLM input contains approved public taxonomy but no hidden response properties", () => {
  const { body, contexts } = fixture();
  assert.equal(contexts.length, 30);
  const serialized = JSON.stringify(body);
  for (const forbidden of ["hidden_type_affinity", "hidden_pillar_affinity", "preferred_frequency", "baseline_logit", "fatigue", "synthetic_user_id", "syn_"]) assert.ok(!serialized.includes(forbidden));
  assert.ok(contexts.every(c => c.approved_slots.length === 3 && c.eligible_frequencies.length));
});
test("batch parser rejects missing, duplicate and ineligible decisions", () => {
  const { response, contexts, decisions } = fixture();
  assert.deepEqual(parseTable(response, contexts), decisions);
  const wrap = ds => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ decisions: ds }) }] } }] });
  assert.throws(() => parseTable(wrap(decisions.slice(1)), contexts));
  assert.throws(() => parseTable(wrap([decisions[0], ...decisions.slice(0, -1)]), contexts));
  assert.throws(() => parseTable(wrap([{ ...decisions[0], frequency: 99 }, ...decisions.slice(1)]), contexts));
});
test("a cached weekly model call yields a complete simulated week and resumes", async t => {
  const { data, response } = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "taxonomy-gemini-test-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  let calls = 0;
  const fake = { choose: async body => {
    calls++;
    const contexts = JSON.parse(body.contents[0].parts[0].text).contexts;
    return { table: parseTable(response, contexts), metadata: { fallback: false }, cache_key: "fixture" };
  } };
  const result = await replay(data, fake, out);
  assert.equal(calls, 4); assert.equal(result.decisions.length, 120); assert.equal(result.complete, true);
  assert.equal(result.decisions.filter(d => !d.context.eligible_frequencies.includes(d.applied_frequency)).length, 0);
  assert.deepEqual(await replay(data, fake, out), result);
  assert.equal(calls, 4);
});
test("free-tier gate prevents any live API request", async t => {
  const { body } = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "taxonomy-gemini-test-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  let calls = 0;
  const client = new GeminiBatch({ out, fetchImpl: async () => { calls++; } });
  await assert.rejects(client.choose(body), /free_tier_not_confirmed/);
  assert.equal(calls, 0);
});
test("quota pause never fabricates decisions, and successful batches are cached", async t => {
  const { body, response } = fixture();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "taxonomy-gemini-test-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "AIza" + "a".repeat(35);
  t.after(() => { if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous; });
  let calls = 0;
  const limited = new GeminiBatch({ out, confirmedFreeTier: true, intervalMs: 0,
    fetchImpl: async () => { calls++; return { ok: false, status: 429,
      json: async () => ({ error: { status: "RESOURCE_EXHAUSTED" } }) }; } });
  await assert.rejects(limited.choose(body), /gemini_quota_exhausted/);
  assert.equal(calls, 1);
  assert.ok(!fs.existsSync(path.join(out, "gemini", "cache")));
  const succeeding = new GeminiBatch({ out, confirmedFreeTier: true, intervalMs: 0,
    fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => response }; } });
  assert.equal((await succeeding.choose(body)).table.length, 30);
  assert.equal((await succeeding.choose(body)).cache_hit, true);
  assert.equal(calls, 2);
});
