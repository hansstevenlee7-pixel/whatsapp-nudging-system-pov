"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../api/_lib/adaptive-core");

const behaviour = { action_text: "Walk for 20 minutes", pillar: "physical_activity", category: "increase" };

test("taxonomy queries use only the behaviour triple and are stable", () => {
  const first = core.querySet(Object.assign({}, behaviour, { name: "Ada", phone: "+61400000000" }));
  const second = core.querySet(behaviour);
  assert.equal(first.behaviour_key, second.behaviour_key);
  assert.match(first.video, /Walk for 20 minutes/);
  assert.match(first.video, /physical activity/);
  assert.match(first.paper_fallback, /walk OR for OR minutes/);
  assert.match(first.paper_fallback, /increase OR improve OR more/);
  assert.doesNotMatch(first.video, /Ada|61400000000/);
});

test("candidate ranking is deterministic and trusted open access sources win", () => {
  const query = core.querySet(behaviour);
  const trusted = core.rankCandidate({ title: "Walking for health", trusted: true, open_access: true, patient_suitable: true }, query);
  const broad = core.rankCandidate({ title: "Walking for health", trusted: false, open_access: false }, query);
  assert.ok(trusted.ranking_score > broad.ranking_score);
  assert.deepEqual(core.selectPool([
    Object.assign({ media_kind: "video" }, trusted), Object.assign({ media_kind: "paper" }, trusted),
    Object.assign({ media_kind: "reading", ranking_score: 1 }, broad)
  ]).map(item => item.media_kind), ["video", "paper", "reading"]);
});

test("paper summaries enforce source and word limits", () => {
  const valid = core.validateSummary({ short_summary: "Walking can support health.", detailed_summary: "A controlled study examined walking.",
    limitations: "One study.", source_title: "Study", original_url: "https://example.org/paper" });
  assert.equal(valid.source_title, "Study");
  assert.throws(() => core.validateSummary({ short_summary: "x ".repeat(61), detailed_summary: "ok", limitations: "", source_title: "Study", original_url: "https://example.org" }), /60 words/);
});

test("explicit format requests apply within an approved envelope", () => {
  const envelope = Object.assign(core.defaultEnvelope(Object.assign({}, behaviour, { scheduled_time: "09:00", frequency_per_week: 3 })), { status: "approved" });
  const assets = [{ asset_id: "v1", media_kind: "video" }, { asset_id: "p1", media_kind: "paper" }];
  const decision = core.decide({ body: "I prefer videos", event_type: "inbound_reply", envelope, assets, state: {} });
  assert.equal(decision.outcome, "applied");
  assert.equal(decision.next_state.preferred_format, "video");
  assert.equal(decision.selected_asset.asset_id, "v1");
  assert.equal(core.explicitInterpretation("I don't like reading").format, "video");
  assert.equal(core.explicitInterpretation("I read it").explicit, false);
});

test("time and frequency changes outside the envelope are not applied", () => {
  const envelope = core.defaultEnvelope(Object.assign({}, behaviour, { scheduled_time: "09:00", frequency_per_week: 3 }));
  const time = core.decide({ body: "send at 8pm", event_type: "inbound_reply", envelope, assets: [], state: {} });
  assert.equal(time.outcome, "outside_envelope");
  const frequency = core.decide({ body: "less often", event_type: "inbound_reply", envelope, assets: [], state: { preferred_frequency: 3 } });
  assert.equal(frequency.outcome, "outside_envelope");
});

test("negated frequency wording requests no frequency change", () => {
  for (const body of ["Do not send more often; keep the current frequency.", "Please don't send more messages", "No more messages like this", "never fewer than two"]) {
    const result = core.explicitInterpretation(body);
    assert.equal(result.frequency_delta, 0, body);
    assert.equal(result.explicit, false, body);
  }
  assert.equal(core.explicitInterpretation("Send fewer messages").frequency_delta, -1);
  assert.equal(core.explicitInterpretation("No, send fewer messages").frequency_delta, -1);
  assert.equal(core.explicitInterpretation("Please message me more often").frequency_delta, 1);
});

test("silence rotates least recently used media and never changes frequency", () => {
  const envelope = core.defaultEnvelope(Object.assign({}, behaviour, { scheduled_time: "09:00", frequency_per_week: 3 }));
  const assets = [{ asset_id: "v1", media_kind: "video" }, { asset_id: "p1", media_kind: "paper" }];
  const decision = core.decide({ event_type: "scheduled_selection", envelope, assets, state: { asset_history: ["v1"], preferred_frequency: 3 } });
  assert.equal(decision.selected_asset.asset_id, "p1");
  assert.equal(decision.next_state.preferred_frequency, 3);
});

test("rotation remains least-recently-used after every approved resource has appeared", () => {
  const envelope = core.defaultEnvelope(Object.assign({}, behaviour, { scheduled_time: "09:00", frequency_per_week: 3 }));
  const assets = [{ asset_id: "v1", media_kind: "video" }, { asset_id: "v2", media_kind: "video" }];
  const decision = core.decide({ event_type: "scheduled_selection", envelope, assets,
    state: { asset_history: ["v1", "v2", "v1"], preferred_format: "video", preferred_frequency: 3 } });
  assert.equal(decision.selected_asset.asset_id, "v2");
});

test("a link visit raises that format score while a read state does not", () => {
  const envelope = core.defaultEnvelope(Object.assign({}, behaviour, { scheduled_time: "09:00", frequency_per_week: 3 }));
  const assets = [{ asset_id: "v1", media_kind: "video" }, { asset_id: "p1", media_kind: "paper" }];
  const clicked = core.decide({ event_type: "link_visit", asset_kind: "paper", envelope, assets, state: {} });
  assert.equal(clicked.scores_after.paper, 1);
  assert.equal(clicked.selected_asset.asset_id, "p1");
  const read = core.decide({ event_type: "delivery_status", envelope, assets, state: {} });
  assert.deepEqual(read.scores_after, {});
  assert.equal(read.outcome, "no_change");
  assert.equal(read.rule, "exposure_only");
  assert.equal(read.selected_asset, null);
});
