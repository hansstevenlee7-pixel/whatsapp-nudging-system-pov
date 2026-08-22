"use strict";

const { httpError } = require("./http");
const { querySet, rankCandidate, selectPool, validateSummary } = require("./adaptive-core");

function text(value) { return String(value == null ? "" : value).trim(); }
function trustedChannels() { return text(process.env.YOUTUBE_TRUSTED_CHANNEL_IDS).split(",").map(value => value.trim()).filter(Boolean); }

async function youtubeCandidates(job, fetchImpl = fetch) {
  const key = text(process.env.YOUTUBE_API_KEY);
  const channels = trustedChannels();
  if (!key || !channels.length) return [];
  const query = querySet(job);
  const results = [];
  async function runSearch(searchText) {
    for (const channelId of channels) {
      const url = new URL("https://www.googleapis.com/youtube/v3/search");
      Object.entries({ part: "snippet", type: "video", maxResults: "5", order: "relevance", safeSearch: "strict",
        relevanceLanguage: "en", regionCode: "AU", channelId, q: searchText, key }).forEach(([name, value]) => url.searchParams.set(name, value));
      const response = await fetchImpl(url);
      if (!response.ok) throw httpError(502, `YouTube search failed (${response.status})`);
      const payload = await response.json();
      for (const item of payload.items || []) {
        if (!item.id || !item.id.videoId) continue;
        results.push(rankCandidate({ media_kind: "video", title: text(item.snippet && item.snippet.title),
          description: text(item.snippet && item.snippet.description), source_name: text(item.snippet && item.snippet.channelTitle),
          source_id: item.id.videoId, source_url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id.videoId)}`,
          published_at: item.snippet && item.snippet.publishedAt || null, open_access: true, trusted: true, patient_suitable: true,
          metadata: { channel_id: channelId, thumbnail: item.snippet && item.snippet.thumbnails && item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url }
        }, query));
      }
    }
  }
  await runSearch(query.video);
  if (!results.length && query.video_fallback) await runSearch(query.video_fallback);
  return results;
}

async function paperCandidates(job, fetchImpl = fetch) {
  const query = querySet(job);
  async function runSearch(searchText) {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
    url.searchParams.set("query", `(${searchText}) AND OPEN_ACCESS:y AND HAS_ABSTRACT:y`);
    url.searchParams.set("format", "json"); url.searchParams.set("resultType", "core"); url.searchParams.set("pageSize", "10");
    const response = await fetchImpl(url);
    if (!response.ok) throw httpError(502, `Europe PMC search failed (${response.status})`);
    const payload = await response.json();
    return (payload.resultList && payload.resultList.result) || [];
  }
  const primary = await runSearch(query.paper);
  const fallback = primary.length ? [] : await runSearch(query.paper_fallback);
  const seen = new Set();
  return primary.concat(fallback).filter(item => {
    const id = text(item.pmcid || item.pmid || item.id);
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(item => {
    const id = text(item.pmcid || item.pmid || item.id);
    const sourceUrl = item.pmcid ? `https://europepmc.org/articles/${encodeURIComponent(item.pmcid)}` : `https://europepmc.org/article/MED/${encodeURIComponent(id)}`;
    return rankCandidate({ media_kind: "paper", title: text(item.title), abstract: text(item.abstractText), description: text(item.abstractText),
      source_name: text(item.journalTitle || "Europe PMC"), source_id: id, source_url: sourceUrl,
      published_at: item.firstPublicationDate || null, open_access: Boolean(item.isOpenAccess === "Y" || item.openAccess === "Y"),
      trusted: true, patient_suitable: false,
      full_text_url: item.pmcid ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(item.pmcid)}/fullTextXML` : null,
      metadata: { authors: item.authorString || "", doi: item.doi || "", cited_by_count: item.citedByCount || 0 }
    }, query);
  });
}

async function summarizePaper(candidate, fetchImpl = fetch) {
  const key = text(process.env.GEMINI_API_KEY);
  if (!key || !candidate.abstract) return candidate;
  const model = text(process.env.GEMINI_SUMMARY_MODEL) || "gemini-2.5-flash";
  const schema = { type: "object", required: ["short_summary","detailed_summary","limitations","source_title","original_url"], properties: {
    short_summary: { type: "string" }, detailed_summary: { type: "string" }, limitations: { type: "string" },
    source_title: { type: "string" }, original_url: { type: "string" }
  } };
  let sourceText = candidate.abstract;
  if (candidate.full_text_url) {
    try {
      const full = await fetchImpl(candidate.full_text_url);
      if (full.ok) sourceText = (await full.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 100000);
    } catch (_) {}
  }
  const prompt = ["Summarise this health research for a general patient in plain English.",
    "Do not add advice, recommendations, or claims absent from the supplied source text.",
    "Short summary: no more than 60 words. Detailed summary: no more than 120 words. State limitations plainly.",
    `Title: ${candidate.title}`, `URL: ${candidate.source_url}`, `Source text: ${sourceText}`].join("\n");
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1 } })
  });
  if (!response.ok) return candidate;
  const payload = await response.json();
  try {
    const raw = payload.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(raw);
    const summary = validateSummary(Object.assign({}, parsed, { source_title: candidate.title, original_url: candidate.source_url }));
    return Object.assign({}, candidate, summary);
  } catch (_) { return candidate; }
}

async function discover(job, fetchImpl = fetch) {
  const [videos, papers] = await Promise.all([youtubeCandidates(job, fetchImpl), paperCandidates(job, fetchImpl)]);
  const summarized = [];
  for (const paper of papers.slice(0, 3)) summarized.push(await summarizePaper(paper, fetchImpl));
  const all = videos.concat(summarized).map(item => Object.assign({}, item, { behaviour_key: job.behaviour_key }));
  return { all, pool: selectPool(all) };
}

module.exports = { trustedChannels, youtubeCandidates, paperCandidates, summarizePaper, discover };
