"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { generateDataset, datasetHash, scheduledSlot, historyFeatures, probability } = require("./generate");
const { stableUniform } = require("../generate-frequency-dataset");
const { eligible } = require("../frequency-comparison/core");
const { OUT, ROOT, SEEDS, POLICIES } = require("./local-run");
const { writeJSON } = require("../frequency-comparison/gemini");
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const rowKey = row => `${row.policy}|${row.seed}|${row.synthetic_user_id}|${row.week}`;

function audit(out = OUT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  for (const [name, expected] of Object.entries(manifest.source_sha256)) {
    assert.equal(hash(fs.readFileSync(path.join(ROOT, name), "utf8")), expected, name);
  }
  const decisions = fs.readFileSync(path.join(out, "decisions.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const feedback = fs.readFileSync(path.join(out, "feedback.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const byDecision = new Map(decisions.map(d => [rowKey(d), d]));
  assert.equal(byDecision.size, decisions.length);
  // feedback.jsonl carries policy but not seed. The replay order and per-seed
  // message counts locate its rows without asking the original runner.
  assert.equal(feedback.length > 0, true);
  const summary = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
  const checked = [];
  let offset = 0;
  for (const policy of POLICIES) for (const seed of SEEDS) {
    const data = generateDataset({ seed });
    assert.equal(datasetHash(data.rows), manifest.dataset_sha256[seed]);
    const record = summary.per_seed.find(r => r.policy === policy && r.seed === seed);
    const events = feedback.slice(offset, offset + record.delivered_messages);
    offset += events.length;
    assert.equal(events.length, record.delivered_messages);
    assert.ok(events.every(r => r.policy === policy));
    const hidden = new Map(data.users.map(u => [u.synthetic_user_id, u]));
    let observed = 0;
    for (const user of data.users.filter(u => Number(u.synthetic_user_id.slice(4)) >= 271)) {
      const prior = data.rows.filter(r => r.synthetic_user_id === user.synthetic_user_id && r.week <= 8);
      const timeline = [...prior]; let current = prior.at(-1).candidate_frequency;
      for (let week = 9; week <= 12; week++) {
        const d = byDecision.get(`${policy}|${seed}|${user.synthetic_user_id}|${week}`);
        assert.ok(d);
        assert.ok(d.available_frequencies.includes(d.applied_frequency));
        assert.ok(eligible(d.context).includes(d.applied_frequency));
        assert.equal(d.context.current_frequency, current);
        assert.deepEqual(d.approved_slots, [1, 2, 3].map(i => scheduledSlot(user, week, i, seed)));
        for (let message = 1; message <= d.applied_frequency; message++) {
          const slot = scheduledSlot(user, week, message, seed), history = historyFeatures(timeline, slot);
          const row = events.find(e => e.synthetic_user_id === user.synthetic_user_id && e.week === week && e.message_index === message);
          assert.ok(row);
          assert.equal(row.current_frequency, current);
          assert.deepEqual(Object.fromEntries(Object.keys(history).map(k => [k, row[k]])), history);
          const y = Number(stableUniform(seed, user.synthetic_user_id, week, message, "taxonomy-policy-response-v2") <
            probability(hidden.get(user.synthetic_user_id), d.applied_frequency, slot, history));
          assert.equal(row.interacted_within_24h, y);
          timeline.push(row); observed += y;
        }
        current = d.applied_frequency;
      }
    }
    assert.equal(observed, record.ordinary_interactions);
    checked.push({ policy, seed, messages: events.length, interactions: observed, passed: true });
  }
  assert.equal(offset, feedback.length);
  const result = { audited_at: new Date().toISOString(), passed: true, trajectories: checked,
    checks: ["source and dataset hashes", "approved slots unchanged", "valid frequency decisions",
      "chronological same-taxonomy history", "matched seeded outcomes", "recorded interactions and messages"] };
  writeJSON(path.join(out, "audit.json"), result);
  return result;
}
if (require.main === module) console.log(JSON.stringify({ passed: audit().passed, trajectories: 30 }));
module.exports = { audit };
