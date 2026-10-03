"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { paperCandidates, discover } = require("../api/_lib/media-discovery");

const job = { behaviour_key: "demo-key", action_text: "Increase your daily steps to 1000.", pillar: "physical_activity", category: "increase" };

function paper(id, title) {
  return { pmcid: id, title, abstractText: "An open-access study about physical activity and walking.", journalTitle: "Open Health Journal",
    firstPublicationDate: "2024-01-01", isOpenAccess: "Y", authorString: "A Researcher" };
}

test("paper discovery broadens a no-result exact query without leaving the behaviour triple", async () => {
  const queries = [];
  const fetchImpl = async url => {
    const parsed = new URL(String(url));
    queries.push(parsed.searchParams.get("query"));
    const fallback = queries.length > 1;
    return new Response(JSON.stringify({ resultList: { result: fallback ? [paper("PMC1", "Walking and physical activity") , paper("PMC2", "Daily steps and health")] : [] } }), { status: 200 });
  };
  const candidates = await paperCandidates(job, fetchImpl);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /Increase your daily steps to 1000/);
  assert.match(queries[1], /increase OR improve OR more/);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].media_kind, "paper");
});

test("discovery returns an approved-ready paper pool when YouTube is not configured", async () => {
  const previousKey = process.env.YOUTUBE_API_KEY;
  const previousChannels = process.env.YOUTUBE_TRUSTED_CHANNEL_IDS;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_TRUSTED_CHANNEL_IDS;
  let paperSearches = 0;
  const fetchImpl = async url => {
    const parsed = new URL(String(url));
    if (!parsed.pathname.includes("/europepmc/")) throw new Error(`Unexpected request: ${url}`);
    paperSearches += 1;
    return new Response(JSON.stringify({ resultList: { result: paperSearches === 1 ? [] : [paper("PMC3", "Walking and physical activity"), paper("PMC4", "Daily steps and health")] } }), { status: 200 });
  };
  try {
    const result = await discover(job, fetchImpl);
    assert.equal(result.all.length, 2);
    assert.deepEqual(result.pool.map(item => item.media_kind), ["paper", "paper"]);
  } finally {
    if (previousKey == null) delete process.env.YOUTUBE_API_KEY; else process.env.YOUTUBE_API_KEY = previousKey;
    if (previousChannels == null) delete process.env.YOUTUBE_TRUSTED_CHANNEL_IDS; else process.env.YOUTUBE_TRUSTED_CHANNEL_IDS = previousChannels;
  }
});
