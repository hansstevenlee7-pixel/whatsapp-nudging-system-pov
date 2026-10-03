"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { build, validate } = require("../../scripts/patient-schema-synthetic/generate");
const { generateDataset, datasetHash } = require("../../scripts/taxonomy-frequency/generate");

test("source-shaped synthetic records link without patient identifiers", () => {
  const result = build();
  assert.equal(validate(result), true);
  assert.equal(result.tables.user.length, 300);
  assert.equal(result.tables.prescriptions.length, 600);
  assert.equal(result.tables.nudges.length, result.tables.model_rows.length);
  assert.ok(result.tables.user.every(u => u.user_id.startsWith("syn_") && u.phone === null && u.email === null));
  assert.ok(result.tables.inbound_messages.every(x => x.from_phone === null && x.matched_nudge_id.startsWith("syn_")));
});

test("source-shaped outcomes are exactly the disclosed simulator outcomes", () => {
  const generated = generateDataset();
  const sourceShaped = build();
  assert.equal(sourceShaped.generator_dataset_sha256, datasetHash(generated.rows));
  assert.equal(sourceShaped.tables.model_rows.filter(x => x.interacted_within_24h).length,
    generated.rows.filter(x => x.interacted_within_24h).length);
  assert.ok(sourceShaped.tables.prescriptions.every(x => x.frequency_per_week === 3));
  assert.ok(sourceShaped.tables.model_rows.every(x => x.candidate_frequency >= 1 && x.candidate_frequency <= 3));
});
