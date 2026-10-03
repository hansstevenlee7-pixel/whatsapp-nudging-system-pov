"use strict";

// Reconstruct saved trajectories and their statistical inputs independently of
// the runner's counters. Read-only except for its own audit result artifact.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { generateDataset, probability, stableUniform } = require("../generate-frequency-dataset");
const { recentHistory } = require("../../landing/api/_lib/frequency-model");
const { sha, publicContext, eligible, aggregate } = require("./core");
const { CONTEXTS, contextIndex, parseTable, writeJSON } = require("./gemini");

function audit(out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const root = path.resolve(__dirname, "../..");
  for (const [file, hash] of Object.entries(manifest.configuration.source_sha256)) {
    assert.equal(sha(fs.readFileSync(path.join(root, file), "utf8")), hash, `current source ${file}`);
    assert.equal(sha(fs.readFileSync(path.join(out, "source-snapshot", file), "utf8")), hash, `snapshot ${file}`);
  }
  const checks = [];
  const checkpointDir = path.join(out, "checkpoints");
  for (const file of fs.readdirSync(checkpointDir).filter(f => f.endsWith(".json"))) {
    const state = JSON.parse(fs.readFileSync(path.join(checkpointDir, file), "utf8"));
    assert.equal(state.config_sha256, manifest.config_sha256);
    const generated = generateDataset({ seed: state.seed });
    const training = generated.rows.filter(r => Number(r.synthetic_user_id.slice(4)) <= 240 && r.week <= 8);
    const hidden = new Map(generated.users.map(u => [u.synthetic_user_id, u]));
    const warm = generated.rows.filter(r => Number(r.synthetic_user_id.slice(4)) >= 271 && r.week <= 8);
    const users = new Map();
    for (const r of warm) {
      if (!users.has(r.synthetic_user_id)) users.set(r.synthetic_user_id, { outcomes: [], current: 2 });
      const user = users.get(r.synthetic_user_id);
      user.outcomes.push(r.interacted_within_24h); user.current = r.candidate_frequency;
    }
    const reconstructedRows = [];
    for (let week = 9; week < state.next_week; week++) {
      const ds = state.decisions.filter(d => d.week === week);
      assert.equal(ds.length, 30); assert.equal(new Set(ds.map(d => d.user_id)).size, 30);
      const cells = aggregate([...training, ...reconstructedRows]);
      const savedCells = JSON.parse(fs.readFileSync(path.join(out, "training-cells", `${state.seed}-${state.policy}-${week}.json`), "utf8"));
      assert.deepEqual(savedCells.cells, cells);
      let messages = 0, interactions = 0;
      for (const decision of ds) {
        const user = users.get(decision.user_id);
        assert.deepEqual(decision.context, publicContext(user.current, user.outcomes));
        assert.equal(decision.cells_sha256, sha(cells));
        assert.ok(eligible(decision.context).includes(decision.applied_frequency));
        if (decision.source === "gemini") {
          const cached = JSON.parse(fs.readFileSync(path.join(out, "llm-cache", decision.cache_key + ".json"), "utf8"));
          assert.equal(cached.cache_key, sha({ model: cached.model, body: cached.request }));
          const supplied = JSON.parse(cached.request.contents[0].parts[0].text);
          assert.deepEqual(supplied.training_cells, cells); assert.deepEqual(supplied.contexts, CONTEXTS);
          if (!cached.metadata.fallback) assert.deepEqual(parseTable(cached.response), cached.table);
          assert.equal(cached.table[contextIndex(decision.context)].frequency, decision.proposed_frequency);
        }
        const outcomes = [];
        for (let message = 1; message <= decision.applied_frequency; message++) {
          const history = recentHistory(user.outcomes);
          const y = Number(stableUniform(state.seed, decision.user_id, week, message, "frequency-comparison-v1") <
            probability(hidden.get(decision.user_id), decision.applied_frequency, history));
          reconstructedRows.push({ synthetic_user_id: decision.user_id, week, message_index: message,
            current_frequency: user.current, candidate_frequency: decision.applied_frequency,
            recent_interaction_rate: history.recent_interaction_rate, noninteraction_streak: history.noninteraction_streak,
            has_previous_interaction: Number(history.has_previous_interaction), interacted_within_24h: y });
          outcomes.push(y); user.outcomes.push(y); messages++; interactions += y;
        }
        user.current = decision.applied_frequency;
        assert.deepEqual(decision.observed_outcomes, outcomes);
      }
      const recorded = state.weeks.find(w => w.week === week);
      assert.equal(recorded.delivered_messages, messages); assert.equal(recorded.ordinary_interactions, interactions);
      assert.equal(recorded.interactions_per_message, interactions / messages);
    }
    assert.deepEqual(reconstructedRows, state.online_rows);
    for (const saved of state.users) {
      assert.deepEqual(saved.outcomes, users.get(saved.id).outcomes);
      assert.equal(saved.current, users.get(saved.id).current);
    }
    checks.push({ seed: state.seed, policy: state.policy, completed_weeks: state.weeks.length,
      complete: state.completed, reconstructed_messages: reconstructedRows.length, passed: true });
  }
  const result = { audited_at: new Date().toISOString(), passed: true, checks,
    checks_performed: ["current and snapshot source hashes", "disjoint initial training and evaluation users",
      "prior-week-only feedback", "exact public contexts", "Gemini input cells and complete context enumeration",
      "Gemini cached table validation and selected entry", "frequency eligibility",
      "matched seeded outcome reconstruction", "message and interaction counters", "checkpoint histories"] };
  writeJSON(path.join(out, "audit.json"), result);
  return result;
}
if (require.main === module) {
  const result = audit(path.resolve(process.argv[2]));
  console.log(JSON.stringify({ passed: result.passed, trajectories: result.checks.length,
    completed_trajectories: result.checks.filter(c => c.complete).length }));
}
module.exports = { audit };
