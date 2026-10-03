"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const core = require("../../scripts/frequency-comparison/core");
const { generateDataset, datasetHash } = require("../../scripts/generate-frequency-dataset");
const { fit } = require("../../scripts/train-frequency-model");
const { GeminiPolicy, Paused, parseChoice, requestBody, CONTEXTS, contextIndex } = require("../../scripts/frequency-comparison/gemini");
const { reproduce, trainRows, initialise, executePolicy, DATA_HASH } = require("../../scripts/frequency-comparison/run");
const { pairedBootstrap, summarizeState } = require("../../scripts/frequency-comparison/report");

const generated = generateDataset();
const rows = trainRows(generated), cells = core.aggregate(rows), scaling = core.scalingFromTraining(rows);
const context = core.publicContext(2, [0, 1, 0, 0]);
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frequency-test-")); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const apiResponse = frequency => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({
  decisions: CONTEXTS.map(c => ({ context_index: c.context_index,
    frequency: c.context_index === contextIndex(context) ? frequency : c.eligible_frequencies[0], reason: "test fixture" }))
}) }] } }], modelVersion: "test-only" });

test("frozen dataset and every original replay arm reproduce", () => {
  assert.equal(datasetHash(generated.rows), DATA_HASH);
  assert.equal(reproduce().matched, true);
});
test("aggregated LR is equivalent to the existing row-wise optimiser", () => {
  const actual = core.fitLR(cells, scaling), expected = fit(rows);
  [expected.intercept, ...expected.coefficients].forEach((value, i) => assert.ok(Math.abs(value - actual.beta[i]) < 1e-11));
  assert.equal(cells.reduce((s, c) => s + c[5], 0), rows.length);
  assert.equal(cells.reduce((s, c) => s + c[6], 0), rows.reduce((s, r) => s + r.interacted_within_24h, 0));
});
test("public feature boundary excludes hidden simulator and future information", () => {
  const polluted = rows.map(r => ({ ...r, preferred_frequency: 3, baseline_logit: 99, fatigue: 99, future_outcome: 1 }));
  assert.deepEqual(core.aggregate(polluted), cells);
  const prompt = JSON.stringify(requestBody(context, cells));
  for (const forbidden of ["preferred_frequency", "baseline_logit", "fatigue", "syn_", "future_outcome"]) assert.ok(!prompt.includes(forbidden));
  assert.deepEqual(Object.keys(context), ["current_frequency", "recent_interaction_rate", "noninteraction_streak", "has_previous_interaction"]);
});
test("frequency bounds enforce no increase from silence and at most one step", () => {
  for (const current of [1, 2, 3]) for (const outcomes of [[], [0, 0, 0, 0], [0, 1, 0, 0]]) {
    const ctx = core.publicContext(current, outcomes);
    for (const choice of [-1, 0, 1, 2, 3, 4, 1.5, "2", NaN, null]) {
      const safe = core.applySafety(choice, ctx);
      assert.ok(core.eligible(ctx).includes(safe.frequency));
      if (!outcomes.includes(1)) assert.ok(safe.frequency <= current);
    }
  }
});
test("full posterior converges and Cholesky solves its precision system", () => {
  const model = core.fitBandit(cells, scaling);
  const terms = core.posteriorTerms(model.beta, core.trainingMatrix(cells, scaling));
  assert.ok(Math.max(...terms.grad.map(Math.abs)) < 1e-6);
  const rhs = [1, -2, 3, -4, 5, -6, 7, -8], solution = core.solveCholesky(model.precision_cholesky, rhs);
  terms.hessian.forEach((row, i) => assert.ok(Math.abs(core.dot(row, solution) - rhs[i]) < 1e-8));
  const a = core.selectModel(model, context, "same-seed");
  assert.deepEqual(a, core.selectModel(model, context, "same-seed"));
  assert.notDeepEqual(a.scores, core.selectModel(model, context, "different-seed").scores);
});
test("precision-factor sampling has the correct covariance orientation", () => {
  const h = [[4, 1.5], [1.5, 2]], l = core.cholesky(h);
  const columns = [[1, 0], [0, 1]].map(z => core.solveUpperFromLower(l, z));
  const inverse = [[1, 0], [0, 1]].map(z => core.solveCholesky(l, z));
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const covariance = columns.reduce((s, c) => s + c[i] * c[j], 0);
    assert.ok(Math.abs(covariance - inverse[j][i]) < 1e-12);
  }
});
test("checkpoint histories exclude evaluation outcomes and model fitting excludes held-out users", () => {
  assert.ok(rows.every(r => Number(r.synthetic_user_id.slice(4)) <= 240 && r.week <= 8));
  const state = initialise(generated, "gemini", "test");
  assert.equal(state.users.length, 30); assert.deepEqual(state.online_rows, []);
  for (const user of state.users) assert.deepEqual(user.outcomes,
    generated.rows.filter(r => r.synthetic_user_id === user.id && r.week <= 8).map(r => r.interacted_within_24h));
});
test("Gemini output validation rejects out-of-envelope, malformed, and incomplete outputs", () => {
  assert.equal(parseChoice(apiResponse(1), context).frequency, 1);
  assert.throws(() => parseChoice(apiResponse(4), context));
  assert.throws(() => parseChoice({ candidates: [{ finishReason: "MAX_TOKENS" }] }, context));
  assert.throws(() => parseChoice(apiResponse("2"), context));
});
test("Gemini exact-prompt cache avoids repeated network calls", async t => {
  const out = temp(t); let calls = 0;
  const policy = new GeminiPolicy({ root: out, out, freeTierConfirmed: true, intervalMs: 0,
    fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => apiResponse(1) }; } });
  fs.writeFileSync(path.join(out, "n8n.env"), "GEMINI_API_KEY=AIza" + "a".repeat(35));
  const first = await policy.choose(context, cells), second = await policy.choose(context, cells);
  assert.equal(calls, 1); assert.equal(first.cache_hit, false); assert.equal(second.cache_hit, true);
  const other = core.publicContext(3, [0, 0, 0, 0]);
  const third = await policy.choose(other, cells);
  assert.equal(calls, 1); assert.equal(third.cache_hit, true); assert.equal(third.proposed_frequency, 2);
});
test("free-tier confirmation blocks requests but forced actions require no API", async t => {
  const out = temp(t); let calls = 0;
  const policy = new GeminiPolicy({ root: out, out, fetchImpl: async () => { calls++; } });
  await assert.rejects(policy.choose(context, cells), /free_tier_billing_status_unconfirmed/);
  const choice = await policy.choose(core.publicContext(1, [0]), cells);
  assert.equal(choice.source, "forced_by_constraints"); assert.equal(calls, 0);
});
test("quota exhaustion pauses without a fabricated decision or cached fallback", async t => {
  const out = temp(t);
  fs.writeFileSync(path.join(out, "n8n.env"), "GEMINI_API_KEY=AIza" + "a".repeat(35));
  const policy = new GeminiPolicy({ root: out, out, freeTierConfirmed: true, intervalMs: 0,
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED" } }) }) });
  await assert.rejects(policy.choose(context, cells), /gemini_quota_exhausted/);
  assert.ok(!fs.existsSync(path.join(out, "llm-cache")));
});
test("three invalid model outputs produce an explicitly labelled hold fallback", async t => {
  const out = temp(t); let calls = 0;
  fs.writeFileSync(path.join(out, "n8n.env"), "GEMINI_API_KEY=AIza" + "a".repeat(35));
  const policy = new GeminiPolicy({ root: out, out, freeTierConfirmed: true, intervalMs: 0,
    fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => apiResponse(99) }; } });
  const result = await policy.choose(context, cells);
  assert.equal(calls, 3); assert.equal(result.fallback, true); assert.equal(result.proposed_frequency, context.current_frequency);
});
test("interrupted weekly decisions resume identically and reveal no same-week outcomes", async t => {
  const interrupted = temp(t), uninterrupted = temp(t); let calls = 0;
  const choose = async ctx => ({ proposed_frequency: core.eligible(ctx)[0], source: "test_fixture" });
  const shared = { generated, policy: "gemini", configHash: "test", onProgress: () => {} };
  await assert.rejects(executePolicy({ ...shared, out: interrupted, gemini: { choose: async ctx => {
    if (++calls === 6) throw new Paused("test interruption"); return choose(ctx);
  } } }), /test interruption/);
  const partial = JSON.parse(fs.readFileSync(path.join(interrupted, "checkpoints/5128-gemini.json"), "utf8"));
  assert.equal(partial.decisions.length, 5); assert.equal(partial.online_rows.length, 0); assert.equal(partial.weeks.length, 0);
  const resumed = await executePolicy({ ...shared, out: interrupted, gemini: { choose } });
  const fresh = await executePolicy({ ...shared, out: uninterrupted, gemini: { choose } });
  assert.deepEqual(resumed, fresh); assert.equal(resumed.decisions.length, 120);
  assert.equal(summarizeState(resumed).applied_constraint_violations, 0);
  for (let week = 9; week <= 12; week++) {
    const initialRows = trainRows(generated);
    const preceding = resumed.online_rows.filter(r => r.week < week);
    const expectedHash = core.sha(core.aggregate([...initialRows, ...preceding]));
    assert.ok(resumed.decisions.filter(d => d.week === week).every(d => d.cells_sha256 === expectedHash));
  }
  await assert.rejects(executePolicy({ ...shared, out: interrupted, configHash: "changed", gemini: { choose } }), /Checkpoint configuration mismatch/);
});
test("seed-paired bootstrap is reproducible and does not pretend one seed gives uncertainty", () => {
  assert.deepEqual(pairedBootstrap([0.1, -0.2, 0.05]), pairedBootstrap([0.1, -0.2, 0.05]));
  assert.equal(pairedBootstrap([0.1]).ci95, null);
  assert.deepEqual(pairedBootstrap([0, 0, 0]).ci95, [0, 0]);
});
