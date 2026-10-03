"use strict";

// Independent reconstruction of completed Gemini trajectories and cached choices.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { OUT, ROOT, SEEDS } = require("./local-run");
const { generateDataset, datasetHash, scheduledSlot, historyFeatures, probability } = require("./generate");
const { stableUniform } = require("../generate-frequency-dataset");
const { eligible, applySafety } = require("../frequency-comparison/core");
const { writeJSON } = require("../frequency-comparison/gemini");
const sha = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function audit(out = OUT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const geminiManifest = JSON.parse(fs.readFileSync(path.join(out, "gemini/manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries({ ...manifest.source_sha256, ...geminiManifest.source_sha256 }))
    assert.equal(sha(fs.readFileSync(path.join(ROOT, name), "utf8")), expected, name);
  const results = JSON.parse(fs.readFileSync(path.join(out, "gemini/results.json"), "utf8"));
  assert.equal(results.complete, true);
  assert.equal(results.completed_seeds, SEEDS.length);
  const checked = [];
  for (const seed of SEEDS) {
    const data = generateDataset({ seed });
    assert.equal(datasetHash(data.rows), manifest.dataset_sha256[seed]);
    const state = JSON.parse(fs.readFileSync(path.join(out, `gemini/checkpoints/${seed}.json`), "utf8"));
    assert.equal(state.complete, true);
    assert.equal(state.next_week, 13);
    assert.equal(state.decisions.length, 120);
    const hidden = new Map(data.users.map(u => [u.synthetic_user_id, u]));
    const byFeedback = new Map(state.feedback.map(row => [`${row.synthetic_user_id}|${row.week}|${row.message_index}`, row]));
    assert.equal(byFeedback.size, state.feedback.length);
    let interactions = 0, messages = 0;
    for (const user of data.users.filter(u => Number(u.synthetic_user_id.slice(4)) >= 271)) {
      const prior = data.rows.filter(r => r.synthetic_user_id === user.synthetic_user_id && r.week <= 8);
      const timeline = [...prior];
      let current = prior.at(-1).candidate_frequency;
      for (let week = 9; week <= 12; week++) {
        const decision = state.decisions.find(d => d.synthetic_user_id === user.synthetic_user_id && d.week === week);
        assert.ok(decision);
        assert.equal(decision.seed, seed);
        assert.equal(decision.context.current_frequency, current);
        assert.deepEqual(decision.context.approved_slots, [1, 2, 3].map(i => scheduledSlot(user, week, i, seed)));
        assert.ok(eligible(decision.context).includes(decision.proposed_frequency));
        assert.equal(decision.applied_frequency, applySafety(decision.proposed_frequency, decision.context).frequency);
        const cache = JSON.parse(fs.readFileSync(path.join(out, `gemini/cache/${decision.cache_key}.json`), "utf8"));
        assert.equal(cache.cache_key, sha({ model: geminiManifest.model, body: cache.request }));
        assert.equal(cache.table[Number(user.synthetic_user_id.slice(4)) - 271].frequency, decision.proposed_frequency);
        assert.equal(cache.metadata.fallback, decision.fallback);
        const outcomes = [];
        for (let message = 1; message <= decision.applied_frequency; message++) {
          const slot = scheduledSlot(user, week, message, seed);
          const history = historyFeatures(timeline, slot);
          const row = byFeedback.get(`${user.synthetic_user_id}|${week}|${message}`);
          assert.ok(row);
          assert.equal(row.current_frequency, current);
          assert.equal(row.candidate_frequency, decision.applied_frequency);
          for (const [name, value] of Object.entries({ ...slot, ...history })) assert.deepEqual(row[name], value);
          const y = Number(stableUniform(seed, user.synthetic_user_id, week, message, "taxonomy-policy-response-v2") <
            probability(user, decision.applied_frequency, slot, history));
          assert.equal(row.interacted_within_24h, y);
          timeline.push(row); messages++; interactions += y; outcomes.push(y);
        }
        assert.deepEqual(decision.observed_outcomes, outcomes);
        current = decision.applied_frequency;
      }
    }
    const summary = results.gemini_per_seed.find(r => r.seed === seed);
    assert.equal(summary.delivered_messages, messages);
    assert.equal(summary.ordinary_interactions, interactions);
    assert.equal(state.feedback.length, messages);
    checked.push({ seed, messages, interactions, passed: true });
  }
  const result = { audited_at: new Date().toISOString(), passed: true, trajectories: checked,
    checks: ["source and dataset hashes", "cached proposed decisions", "eligible and applied frequencies",
      "clinician-owned slots", "chronological history", "seeded outcomes", "summary counts"] };
  writeJSON(path.join(out, "gemini/audit.json"), result);
  return result;
}
if (require.main === module) console.log(JSON.stringify({ passed: audit().passed, trajectories: SEEDS.length }));
module.exports = { audit };
