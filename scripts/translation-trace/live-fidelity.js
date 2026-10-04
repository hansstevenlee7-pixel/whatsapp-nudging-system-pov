"use strict";

// Live LLM translation fidelity (FIDELITY_PROTOCOL.md v1). Each synthetic
// prescription goes through the portal intake API and Workflow A exactly as in the
// translation trace, except that "Call Gemini Vision" makes the one live request.
// The key comes from the git-ignored n8n.env and is never printed or stored.
//
//   node scripts/translation-trace/live-fidelity.js output/translation_fidelity_live_2026-10-04
//   node scripts/translation-trace/live-fidelity.js <scratch dir> --dry-run   (no network; gold-built responses)

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const realFetch = global.fetch; // captured before the harness replaces it
const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(ROOT, process.argv[2] || "output/translation_fidelity_live");
const DRY = process.argv.includes("--dry-run");
// FIDELITY_AMENDMENT_1.md: --complete <first-run dir> re-makes only the calls that got no response,
// at least 13 s apart, capped at the number missing, with zero retries.
const COMPLETE = process.argv.includes("--complete") ? path.resolve(ROOT, process.argv[process.argv.indexOf("--complete") + 1]) : null;
const PRIOR = COMPLETE ? JSON.parse(fs.readFileSync(path.join(COMPLETE, "results.json"), "utf8")) : null;
const MISSING = PRIOR ? PRIOR.calls.filter(r => r.status !== 200).map(r => r.id) : null;
const harness = require("./run");
const fidelity = require("./fidelity-cases");
const { FIDELITY_CASES, REPETITIONS } = fidelity;
const ATTEMPT_CAP = MISSING ? MISSING.length : fidelity.ATTEMPT_CAP;
const MIN_INTERVAL_MS = MISSING ? 13000 : fidelity.MIN_INTERVAL_MS;
const { WEEK1 } = require("./cases");

const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tidy = v => String(v == null ? "" : v).trim().toLowerCase().replace(/[\s-]+/g, "_");

function geminiKey() {
  const line = fs.readFileSync(path.join(ROOT, "n8n.env"), "utf8").split(/\r?\n/).find(l => l.startsWith("GEMINI_API_KEY="));
  const key = line ? line.slice("GEMINI_API_KEY=".length).trim().replace(/^["']|["']$/g, "") : "";
  if (!key) throw new Error("GEMINI_API_KEY is not set in n8n.env");
  return key;
}
const KEY = DRY ? "" : geminiKey();
const redact = text => KEY ? String(text).split(KEY).join("[redacted]") : String(text);

let attempts = 0; let lastCall = 0;
function dryResponse(c) {
  const prescriptions = c.gold.map((g, i) => ({ ref: `p${i + 1}`, pillar: g.pillar, category: g.category, frequency_per_week: g.frequency, duration_weeks: g.weeks }));
  let day = 0;
  const nudges = c.gold.flatMap((g, i) => Array.from({ length: g.frequency }, () => ({ prescription_ref: `p${i + 1}`, pillar: g.pillar, nudge_type: "reminder",
    action_text: "Dry-run action", scheduled_date: WEEK1[(day++) % 7], scheduled_time: "09:00", tone_variant: "encouraging", message_body: "Dry-run body.",
    message_body_alt: "Dry-run alternative.", template_name: "health_plan_reminder" })));
  return { modelVersion: "dry-run", responseId: `dry-${c.id}`, candidates: [{ content: { parts: [{ text: JSON.stringify({ prescriptions, nudges }) }] } }] };
}

async function responder(request, record, c) {
  record.request = { url: request.url.replace(/key=[^&]*/, "key=[redacted]"), body_sha256: sha(request.body),
    generation_config: JSON.parse(request.body).generationConfig };
  if (DRY) { record.status = 200; record.response = dryResponse(c); return record.response; }
  if (attempts >= ATTEMPT_CAP) { record.status = "not_attempted_cap"; throw new Error("attempt cap reached"); }
  const wait = lastCall + MIN_INTERVAL_MS - harness.RealDate.now();
  if (wait > 0) await sleep(wait);
  attempts += 1; lastCall = harness.RealDate.now(); record.attempted_at = new harness.RealDate().toISOString();
  const started = harness.RealDate.now();
  try {
    const res = await realFetch(request.url.replace(/key=[^&]*/, `key=${encodeURIComponent(KEY)}`), {
      method: "POST", headers: { "content-type": "application/json" }, body: request.body });
    record.status = res.status; const text = await res.text();
    try { record.response = JSON.parse(redact(text)); } catch (_) { record.response = { raw: redact(text).slice(0, 2000) }; }
  } catch (error) { record.status = 0; record.response = { error: redact(error.message) }; }
  record.latency_ms = harness.RealDate.now() - started;
  if (record.status !== 200) throw new Error(`Gemini HTTP ${record.status}`);
  return record.response;
}

function outputOf(record) {
  const text = record.response && record.response.candidates && record.response.candidates[0] && record.response.candidates[0].content &&
    record.response.candidates[0].content.parts && record.response.candidates[0].content.parts[0] && record.response.candidates[0].content.parts[0].text;
  if (typeof text !== "string") return { text: null, parsed: null };
  try { return { text, parsed: JSON.parse(text) }; } catch (_) { return { text, parsed: null }; }
}

// Gold matching: same pillar, preferring the same category; each output used once.
function score(parsed, gold) {
  const output = ((parsed && parsed.prescriptions) || []).map(p => ({ ref: p.ref, pillar: tidy(p.pillar), category: tidy(p.category),
    frequency: parseInt(p.frequency_per_week, 10), weeks: parseInt(p.duration_weeks, 10) }));
  const used = new Set(); const matches = [];
  for (const g of gold) {
    const pool = output.map((o, i) => ({ o, i })).filter(({ o, i }) => !used.has(i) && o.pillar === g.pillar);
    const pick = pool.find(({ o }) => o.category === g.category) || pool.find(({ o }) => (g.alt.category || []).includes(o.category)) || pool[0];
    if (pick) used.add(pick.i);
    const o = pick && pick.o;
    matches.push({ gold: `${g.pillar}/${g.category}/${g.frequency}/${g.weeks}`, output: o ? `${o.pillar}/${o.category}/${o.frequency}/${o.weeks}` : null,
      pillar: Boolean(o), category_exact: Boolean(o) && o.category === g.category,
      category_accepted: Boolean(o) && (o.category === g.category || (g.alt.category || []).includes(o.category)),
      frequency_exact: Boolean(o) && o.frequency === g.frequency,
      frequency_accepted: Boolean(o) && (o.frequency === g.frequency || (g.alt.frequency || []).includes(o.frequency)),
      duration_exact: Boolean(o) && o.weeks === g.weeks });
  }
  const rules = [];
  for (const p of (parsed && parsed.prescriptions) || []) {
    const drafts = ((parsed && parsed.nudges) || []).filter(n => n.prescription_ref === p.ref);
    const dates = drafts.map(n => n.scheduled_date);
    rules.push({ ref: p.ref, count_matches_frequency: drafts.length === parseInt(p.frequency_per_week, 10), within_week1: dates.every(d => WEEK1.includes(d)),
      distinct_dates: new Set(dates).size === dates.length, action_within_120: drafts.every(n => String(n.action_text || "").length <= 120),
      bodies_within_180: drafts.every(n => String(n.message_body || "").length <= 180 && String(n.message_body_alt || "").length <= 180) });
  }
  return { count_matches: output.length === gold.length, extras: output.length - used.size, matches, rules,
    signature: output.map(o => `${o.pillar}|${o.category}|${o.frequency}|${o.weeks}`).sort().join(" ; "),
    actions: ((parsed && parsed.nudges) || []).map(n => n.action_text) };
}

async function main() {
  harness.setOut(OUT);
  const calls = [];
  for (const c of FIDELITY_CASES) {
    for (let rep = 1; rep <= REPETITIONS; rep++) {
      const id = `${c.id}-r${rep}`; const record = { id, case: c.id, rep }; const userId = `usr-${id.toLowerCase()}`;
      if (MISSING && !MISSING.includes(id)) continue;
      harness.newEnvironment(id);
      const intake = await harness.submitIntake({ id, text: c.text, responder: request => responder(request, record, c) }, userId);
      const cur = harness.current(); const gate = cur.workflowRuns[0] && cur.workflowRuns[0].gate && cur.workflowRuns[0].gate[0];
      const { text, parsed } = outputOf(record);
      Object.assign(record, { intake_status: intake.status, accepted: intake.status === 200 && intake.body && intake.body.status === "ok",
        gate: gate ? { validation_passed: gate.validation_passed, stage: gate.stage || null, errors: gate.errors || (gate.error ? [gate.error] : []) } : null,
        rows_written: cur.sheets.writes.length, prompt_sha256: cur.gemini[0] && cur.gemini[0].prompt_sha256,
        stored_provenance: (harness.snapshot().sheets.prescriptions.rows[0] || {}).translation_model ? (({ translation_model, translation_prompt_sha256, translation_response_id }) =>
          ({ translation_model, translation_prompt_sha256, translation_response_id }))(harness.snapshot().sheets.prescriptions.rows[0]) : null,
        output_text: text, parsed_ok: Boolean(parsed), score: parsed ? score(parsed, c.gold) : null });
      calls.push(record);
      process.stdout.write(`${id}: HTTP ${record.status} ${record.accepted ? "accepted" : `refused/failed (${record.gate ? record.gate.stage : "no gate"})`}\n`);
    }
  }
  // M10: the full chain on the first accepted real output of each text (no new call).
  // In completion mode, only for texts that had no chain in the first run.
  const combined = PRIOR ? PRIOR.calls.map(r => r.status === 200 ? r : (calls.find(n => n.id === r.id) || r)) : calls;
  const chains = [];
  for (const c of FIDELITY_CASES) {
    if (PRIOR && (PRIOR.chains.find(ch => ch.case === c.id) || {}).ran) continue;
    const first = combined.find(r => r.case === c.id && r.accepted && r.parsed_ok);
    if (!first) { chains.push({ case: c.id, ran: false, reason: "no accepted output" }); continue; }
    try {
      const result = await harness.partB({ id: `${c.id}-chain`, text: c.text, llm: JSON.parse(first.output_text), responder: () => first.response,
        review: {}, reply: "Send fewer messages" });
      chains.push({ case: c.id, ran: true, from_call: first.id, closed: result.closure.closed, broken_at: result.closure.broken_at, decision: result.decision,
        policy: result.policy, links: Object.fromEntries(Object.entries(result.links).map(([k, v]) => [k, `${v.filter(x => x.ok).length}/${v.length}`])) });
    } catch (error) { chains.push({ case: c.id, ran: false, reason: redact(error.message) }); }
  }
  harness.restoreDate();
  const summary = summarise(calls, chains);
  const results = { protocol: "translation-fidelity-v1", amendment: PRIOR ? "FIDELITY_AMENDMENT_1.md" : null, first_run: PRIOR ? path.relative(ROOT, COMPLETE) : null,
    dry_run: DRY, attempts, summary, calls, chains, refused_outbound: harness.refused };
  if (PRIOR) {
    const allChains = PRIOR.chains.map(ch => ch.ran ? ch : (chains.find(n => n.case === ch.case) || ch));
    results.combined = { note: "first-run response where one exists, otherwise the completion run's (FIDELITY_AMENDMENT_1.md)",
      summary: summarise(combined, allChains), calls: combined.map(r => ({ id: r.id, status: r.status, from: r.status === 200 && PRIOR.calls.includes(r) ? "first_run" : "completion",
        accepted: r.accepted, matches: r.score ? r.score.matches : null, rules: r.score ? r.score.rules : null })), chains: allChains };
  }
  const text = `${JSON.stringify(results, null, 2)}\n`;
  if (KEY && text.includes(KEY)) throw new Error("refusing to write: key found in results");
  fs.writeFileSync(path.join(OUT, "results.json"), text);
  const files = ["FIDELITY_PROTOCOL.md", "FIDELITY_AMENDMENT_1.md", "fidelity-cases.js", "live-fidelity.js", "run.js", "n8n-runtime.js", "links.js"].map(f => `scripts/translation-trace/${f}`)
    .concat(["workflows/workflow_a_intake.json"]);
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify({ created_at: new Date().toISOString(), dry_run: DRY, node: process.version,
    git_commit: require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    working_tree: "dirty; source_sha256 identifies the exact files run", attempts, attempt_cap: ATTEMPT_CAP, min_interval_ms: MIN_INTERVAL_MS,
    model_versions: [...new Set(calls.map(r => r.response && r.response.modelVersion).filter(Boolean))],
    source_sha256: Object.fromEntries(files.map(f => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), results_sha256: sha(text) }, null, 2)}\n`);
  writeReport(results);
}

function pct(n, d) { return d ? `${n}/${d} (${(100 * n / d).toFixed(0)}%)` : "0/0"; }
function summarise(calls, chains) {
  const ok = calls.filter(r => r.status === 200); const accepted = calls.filter(r => r.accepted);
  const matches = calls.filter(r => r.score).flatMap(r => r.score.matches);
  const rules = accepted.filter(r => r.score).flatMap(r => r.score.rules);
  const consistency = FIDELITY_CASES.map(c => {
    const sigs = calls.filter(r => r.case === c.id && r.score).map(r => r.score.signature);
    return { case: c.id, calls: sigs.length, consistent: sigs.length > 1 && new Set(sigs).size === 1 };
  });
  const goldTotal = calls.filter(r => r.score).reduce((s, r) => s + r.score.matches.length, 0);
  return { calls: calls.length, http_ok: ok.length, accepted: accepted.length, refused: calls.filter(r => r.intake_status === 422).length,
    rows_written_on_refusal: calls.filter(r => !r.accepted).reduce((s, r) => s + r.rows_written, 0),
    count_matches: calls.filter(r => r.score && r.score.count_matches).length, scored_calls: calls.filter(r => r.score).length,
    gold_prescriptions: goldTotal, pillar: matches.filter(m => m.pillar).length, category_exact: matches.filter(m => m.category_exact).length,
    category_accepted: matches.filter(m => m.category_accepted).length, frequency_exact: matches.filter(m => m.frequency_exact).length,
    frequency_accepted: matches.filter(m => m.frequency_accepted).length, duration_exact: matches.filter(m => m.duration_exact).length,
    rules: { prescriptions: rules.length, count_matches_frequency: rules.filter(r => r.count_matches_frequency).length, within_week1: rules.filter(r => r.within_week1).length,
      distinct_dates: rules.filter(r => r.distinct_dates).length, action_within_120: rules.filter(r => r.action_within_120).length,
      bodies_within_180: rules.filter(r => r.bodies_within_180).length },
    consistent_texts: consistency.filter(c => c.consistent).length, consistency,
    chains_run: chains.filter(c => c.ran).length, chains_closed: chains.filter(c => c.closed).length };
}

function writeReport(results) {
  const s = results.summary;
  const lines = [`# Live LLM translation fidelity${results.dry_run ? " (DRY RUN, not reported)" : ""}`, "",
    `Protocol \`translation-fidelity-v1\`${results.amendment ? ", completion run under FIDELITY_AMENDMENT_1.md (first run kept in " + results.first_run + ")" : ""}. ${s.calls} calls planned (${results.attempts} attempted, cap 45); model versions: ${[...new Set(results.calls.map(r => r.response && r.response.modelVersion).filter(Boolean))].join(", ") || "none"}.`, "",
    "| Measure | Result |", "|---|---|",
    `| M1 HTTP 200 with a candidate | ${pct(s.http_ok, s.calls)} |`,
    `| M2 Accepted by the intake gate | ${pct(s.accepted, s.calls)}; refused ${s.refused}; rows written on refusal ${s.rows_written_on_refusal} |`,
    `| M3 Prescription count equals gold | ${pct(s.count_matches, s.scored_calls)} |`,
    `| M4 Pillar | ${pct(s.pillar, s.gold_prescriptions)} |`,
    `| M5 Category exact / with declared alternatives | ${pct(s.category_exact, s.gold_prescriptions)} / ${pct(s.category_accepted, s.gold_prescriptions)} |`,
    `| M6 Frequency exact / with declared alternatives | ${pct(s.frequency_exact, s.gold_prescriptions)} / ${pct(s.frequency_accepted, s.gold_prescriptions)} |`,
    `| M7 Duration exact | ${pct(s.duration_exact, s.gold_prescriptions)} |`,
    `| M8 Drafts equal frequency / within week 1 / distinct dates / action ≤120 / bodies ≤180 | ${pct(s.rules.count_matches_frequency, s.rules.prescriptions)} / ${pct(s.rules.within_week1, s.rules.prescriptions)} / ${pct(s.rules.distinct_dates, s.rules.prescriptions)} / ${pct(s.rules.action_within_120, s.rules.prescriptions)} / ${pct(s.rules.bodies_within_180, s.rules.prescriptions)} |`,
    `| M9 Texts with identical labels across repetitions | ${pct(s.consistent_texts, FIDELITY_CASES.length)} |`,
    `| M10 Full chains closed on real output | ${s.chains_closed}/${s.chains_run} run |`, "",
    "## Per call", "", "| Call | HTTP | Gate | Gold → output (pillar/category/frequency/weeks) | Prompt rules broken |", "|---|---|---|---|---|"];
  for (const r of results.calls) {
    const broken = r.score ? r.score.rules.flatMap(x => Object.entries(x).filter(([k, v]) => k !== "ref" && v === false).map(([k]) => `${x.ref}:${k}`)) : [];
    lines.push(`| ${r.id} | ${r.status} | ${r.accepted ? "accepted" : r.gate ? `refused (${r.gate.stage}: ${(r.gate.errors || []).join("; ").slice(0, 120)})` : "no response"} | ${r.score ? r.score.matches.map(m => `${m.gold} → ${m.output || "missing"}`).join("<br>") + (r.score.extras ? `<br>+${r.score.extras} extra` : "") : "—"} | ${broken.join(", ") || "—"} |`);
  }
  lines.push("", "## Full chain on real output (M10)", "", "| Text | From call | Closed | Reply decision | Links (T1–T19) |", "|---|---|---|---|---|");
  for (const c of results.chains) {
    lines.push(c.ran ? `| ${c.case} | ${c.from_call} | ${c.closed ? "yes" : `no (${c.broken_at})`} | ${c.decision ? c.decision.outcome : "—"} | ${Object.entries(c.links).filter(([, v]) => v.split("/")[0] !== v.split("/")[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "all complete"} |` : `| ${c.case} | — | not run | — | ${c.reason} |`);
  }
  lines.push("", "## Action wording (verbatim, first call per text)", "");
  for (const c of FIDELITY_CASES) {
    const first = results.calls.find(r => r.case === c.id && r.score);
    lines.push(`- **${c.id}** “${c.text}” → ${first ? first.score.actions.map(a => `“${a}”`).join(", ") : "no parsed output"}`);
  }
  if (results.combined) {
    const c = results.combined.summary;
    lines.push("", "## Combined with the first run (FIDELITY_AMENDMENT_1.md)", "", results.combined.note, "", "| Measure | Combined |", "|---|---|",
      `| M1 HTTP 200 with a candidate | ${pct(c.http_ok, c.calls)} |`, `| M2 Accepted | ${pct(c.accepted, c.calls)}; refused ${c.refused}; rows written on refusal ${c.rows_written_on_refusal} |`,
      `| M3 Count | ${pct(c.count_matches, c.scored_calls)} |`, `| M4 Pillar | ${pct(c.pillar, c.gold_prescriptions)} |`,
      `| M5 Category exact / with alternatives | ${pct(c.category_exact, c.gold_prescriptions)} / ${pct(c.category_accepted, c.gold_prescriptions)} |`,
      `| M6 Frequency exact / with alternatives | ${pct(c.frequency_exact, c.gold_prescriptions)} / ${pct(c.frequency_accepted, c.gold_prescriptions)} |`,
      `| M7 Duration exact | ${pct(c.duration_exact, c.gold_prescriptions)} |`,
      `| M8 Drafts equal frequency / week 1 / distinct / action ≤120 / bodies ≤180 | ${pct(c.rules.count_matches_frequency, c.rules.prescriptions)} / ${pct(c.rules.within_week1, c.rules.prescriptions)} / ${pct(c.rules.distinct_dates, c.rules.prescriptions)} / ${pct(c.rules.action_within_120, c.rules.prescriptions)} / ${pct(c.rules.bodies_within_180, c.rules.prescriptions)} |`,
      `| M9 Identical labels across repetitions | ${pct(c.consistent_texts, FIDELITY_CASES.length)} |`, `| M10 Chains closed | ${c.chains_closed}/${c.chains_run} run |`);
  }
  lines.push("", `Outbound requests refused: ${results.refused_outbound.length}.`);
  fs.writeFileSync(path.join(OUT, "REPORT.md"), `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.slice(0, 18).join("\n")}\n`);
}

main().catch(error => { harness.restoreDate(); console.error(redact(error && error.stack || error)); process.exitCode = 1; });
