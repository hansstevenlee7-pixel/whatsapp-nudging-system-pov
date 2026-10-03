"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { generateFixture } = require("../../scripts/generate-adaptation-fixture");

test("synthetic adaptation fixture covers the acceptance scenarios without clinical claims", () => {
  const fixture = generateFixture();
  const decisions = fixture.decisions;
  assert.equal(fixture.synthetic, true);
  assert.equal(decisions[0].rule, "exposure_only");
  assert.equal(decisions[0].outcome, "no_change");
  assert.deepEqual(decisions[0].scores_after, {});
  assert.equal(decisions[1].next_state.preferred_format, "video");
  assert.equal(decisions[2].next_state.preferred_summary_length, "short");
  assert.equal(decisions[3].next_state.preferred_time, "18:30");
  assert.equal(decisions[4].scores_after.video, 1);
  assert.equal(decisions[5].next_state.preferred_frequency, 3);
  assert.notEqual(decisions[5].selected_asset.asset_id, decisions[4].selected_asset.asset_id);
  assert.equal(decisions[6].outcome, "outside_envelope");
  assert.equal(decisions[6].reason, "time_outside_envelope");
  assert.equal(decisions[7].next_state.preferred_frequency, 4);
  assert.equal(decisions[8].outcome, "outside_envelope");
  assert.equal(decisions[8].reason, "frequency_outside_envelope");
  assert.match(fixture.outcome_boundary, /not adherence or clinical outcomes/);
});
