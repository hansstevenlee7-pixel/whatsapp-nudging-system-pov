"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { mulberry32 } = require("../generate-frequency-dataset");
const { eligible } = require("./core");
const { writeJSON } = require("./gemini");

const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
function describe(xs) {
  const sorted = [...xs].sort((a, b) => a - b), avg = mean(xs);
  return { mean: avg, median: (sorted[Math.floor((xs.length - 1) / 2)] + sorted[Math.ceil((xs.length - 1) / 2)]) / 2,
    sd: xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (xs.length - 1)) : null,
    min: sorted[0], max: sorted.at(-1), n: xs.length };
}
function pairedBootstrap(differences, seed = 20260930) {
  const random = mulberry32(seed), draws = [];
  for (let b = 0; b < 10000; b++) {
    let sum = 0;
    for (let i = 0; i < differences.length; i++) sum += differences[Math.floor(random() * differences.length)];
    draws.push(sum / differences.length);
  }
  draws.sort((a, b) => a - b);
  return { ...describe(differences), ci95: differences.length > 1 ? [draws[249], draws[9749]] : null,
    higher_seeds: differences.filter(x => x > 0).length, tied_seeds: differences.filter(x => x === 0).length,
    bootstrap_unit: "whole paired cohort seed", bootstrap_replicates: 10000 };
}
function summarizeState(state) {
  const messages = state.weeks.reduce((s, w) => s + w.delivered_messages, 0);
  const interactions = state.weeks.reduce((s, w) => s + w.ordinary_interactions, 0);
  return { seed: state.seed, policy: state.policy, complete: state.completed, completed_weeks: state.weeks.length,
    delivered_messages: messages, ordinary_interactions: interactions, interactions_per_message: messages ? interactions / messages : null,
    messages_per_interaction: interactions ? messages / interactions : null,
    frequency_changes: state.weeks.reduce((s, w) => s + w.frequency_changes, 0),
    direction_reversals: state.weeks.reduce((s, w) => s + w.direction_reversals, 0),
    applied_constraint_violations: state.decisions.filter(d => !eligible(d.context).includes(d.applied_frequency)).length,
    rejected_proposals: state.decisions.filter(d => d.safety_rejected).length,
    decision_count: state.decisions.length, fallback_decisions: state.decisions.filter(d => d.fallback).length,
    forced_decisions: state.decisions.filter(d => d.source === "forced_by_constraints").length,
    chosen_frequency_counts: Object.fromEntries([1, 2, 3].map(f => [f, state.decisions.filter(d => d.applied_frequency === f).length])),
    weeks: state.weeks };
}
function csv(rows, columns) {
  const escape = v => JSON.stringify(typeof v === "object" ? JSON.stringify(v) : v ?? "");
  return [columns.join(","), ...rows.map(r => columns.map(c => escape(r[c])).join(","))].join("\n") + "\n";
}
function buildReport(out) {
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const config = manifest.configuration;
  const dir = path.join(out, "checkpoints");
  const states = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) : [];
  const perSeed = states.map(summarizeState), complete = perSeed.filter(s => s.complete);
  const across = {};
  const fields = ["interactions_per_message", "delivered_messages", "ordinary_interactions", "frequency_changes", "direction_reversals", "applied_constraint_violations", "fallback_decisions"];
  for (const policy of config.policies) {
    const rows = complete.filter(r => r.policy === policy);
    across[policy] = { completed_seeds: rows.length, requested_seeds: config.seeds.length };
    if (rows.length) for (const field of fields) across[policy][field] = describe(rows.map(r => r[field]));
  }
  const paired = {};
  for (const policy of config.policies.filter(p => p !== "logistic_regression")) {
    const pairs = complete.filter(r => r.policy === policy).map(r => [r, complete.find(b => b.policy === "logistic_regression" && b.seed === r.seed)]).filter(p => p[1]);
    if (pairs.length) paired[policy + "_minus_lr"] = { seeds: pairs.map(p => p[0].seed),
      ...Object.fromEntries(fields.slice(0, 3).map(field => [field, pairedBootstrap(pairs.map(([a, b]) => a[field] - b[field]))])) };
  }
  const cacheDir = path.join(out, "llm-cache");
  const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(f => f.endsWith(".json")).map(f => JSON.parse(fs.readFileSync(path.join(cacheDir, f), "utf8"))) : [];
  const attempts = cached.flatMap(c => c.metadata.attempts || []);
  const llmUsage = { unique_cached_requests: cached.length, cached_request_attempts: attempts.length,
    invalid_attempts: attempts.filter(a => a.validation_error).length,
    input_tokens: attempts.reduce((s, a) => s + (a.usage?.promptTokenCount || 0), 0),
    output_tokens: attempts.reduce((s, a) => s + (a.usage?.candidatesTokenCount || 0), 0),
    total_tokens: attempts.reduce((s, a) => s + (a.usage?.totalTokenCount || 0), 0),
    latency_ms: attempts.length ? describe(attempts.map(a => a.latency_ms)) : null,
    model_versions: [...new Set(attempts.map(a => a.model_version).filter(Boolean))],
    note: "Usage covers successful cached requests and their retries; interrupted/uncached errors are separately logged. Free tier confirmed by user; invoice not inspected." };
  const status = JSON.parse(fs.readFileSync(path.join(out, "run-status.json"), "utf8"));
  const report = { generated_at: new Date().toISOString(), complete: complete.length === config.seeds.length * config.policies.length,
    configuration_sha256: manifest.config_sha256, reproduction: manifest.reproduction.matched,
    status, across_seeds: across, paired_contrasts: paired, llm_usage: llmUsage, per_seed: perSeed };
  writeJSON(path.join(out, "results.json"), report);
  fs.writeFileSync(path.join(out, "per_seed.csv"), csv(perSeed, ["seed", "policy", "complete", "completed_weeks", ...fields]));
  fs.writeFileSync(path.join(out, "weekly.csv"), csv(perSeed.flatMap(s => s.weeks.map(w => ({ seed: s.seed, policy: s.policy, ...w }))), ["seed", "policy", "week", "delivered_messages", "ordinary_interactions", "interactions_per_message", "frequency_changes", "direction_reversals"]));
  const decisions = states.flatMap(s => s.decisions);
  fs.writeFileSync(path.join(out, "decisions.jsonl"), decisions.map(d => JSON.stringify(d)).join("\n") + (decisions.length ? "\n" : ""));
  const percent = v => (v * 100).toFixed(2) + "%";
  const lines = ["# Synthetic frequency-policy comparison", "", `Status: **${report.complete ? "COMPLETE" : "INCOMPLETE — do not present as a completed three-method comparison"}**.`, "",
    `Frozen dataset and original policy comparison: reproduced. Frozen model unchanged: ${status.frozen_artifact_unchanged}.`, "",
    "## Completed seed results", "", "Only complete 4-week seed runs enter this table. Means are equally weighted across seeds.", "",
    "| Policy | Seeds | Interaction rate, mean ± SD | Messages per seed | Interactions per seed | Applied violations |",
    "|---|---:|---:|---:|---:|---:|"];
  for (const [policy, a] of Object.entries(across)) lines.push(a.completed_seeds ?
    `| ${policy} | ${a.completed_seeds}/10 | ${percent(a.interactions_per_message.mean)} ± ${percent(a.interactions_per_message.sd || 0)} | ${a.delivered_messages.mean.toFixed(1)} | ${a.ordinary_interactions.mean.toFixed(1)} | ${a.applied_constraint_violations.mean} |` :
    `| ${policy} | 0/10 | Not available | — | — | — |`);
  lines.push("", "## Paired comparisons with logistic regression", "");
  for (const [name, contrast] of Object.entries(paired)) {
    const c = contrast.interactions_per_message;
    lines.push(`- ${name}: ${(c.mean * 100).toFixed(2)} percentage points; ${c.ci95 ? `95% paired seed-bootstrap CI [${(c.ci95[0] * 100).toFixed(2)}, ${(c.ci95[1] * 100).toFixed(2)}]` : "CI unavailable with one seed"}; higher in ${c.higher_seeds}/${c.n} seeds.`);
  }
  if (status.pause) lines.push("", `Execution pause: **${status.pause.reason}**. Completed evidence and decisions are checkpointed. A paused LLM is not replaced by rules.`);
  lines.push("", "## Design and interpretation", "",
    "Three policies choose 1–3 messages/week. Users 1–240, weeks 1–8 initialise training. Users 241–270, weeks 9–10 provide validation diagnostics without tuning. Users 271–300 are evaluated over weeks 9–12; their observed weeks 1–8 initialise their context only. Evaluation labels from the original dataset are never reused as counterfactual outcomes.", "",
    "The train-only scaler and exact feature-cell counts are shared information contracts. LR is greedy and refitted weekly. Thompson sampling uses a full-Hessian Laplace Bayesian logistic posterior, updated weekly, with independent seeded coefficient draws. Gemini receives the same feature cells and a fixed enumeration of every possible four-outcome history context, with fixed temperature-zero prompts and no simulator parameters. It returns a complete context-to-frequency decision table once per weekly training snapshot. This enumeration is independent of the evaluation cohort and reveals no cohort distribution or future outcomes. Each actual user receives the entry for their context; single-eligible-action states bypass the API. This is a cached LLM policy, not an estimate of independent-call variability.", "",
    "Each week's decisions are fixed before any current-week reward is observed. Feedback is generated by the existing stationary simulator with matched random numbers across policies. Each policy then learns only from its own realised outcomes. Frequency can change by at most one and cannot increase without an interaction in the recent four message outcomes.", "",
    "LR retains the old features, regularisation, and optimiser but uses greedy selection, weekly updates, and a different held-out sequential protocol. These results must not be substituted for the original thesis table.", "",
    "The primary metric rewards interaction efficiency, not maximum total interactions. Message burden and total interactions are reported alongside it. The simulator itself is logistic; hidden user heterogeneity is unobservable. Models predict per-message responses, while actions cover a week during which history changes. Four evaluation weeks and ten seeds limit claims about learning, drift recovery, or small differences. Bootstrap intervals describe seed variability for this fixed cached LLM policy, not LLM model-version or sampling uncertainty. LR and the bandit also differ in optimiser convergence and intercept regularisation; this three-method comparison does not isolate exploration as the cause of any difference.", "",
    "This runner does not simulate STOP events, duplicate delivery, time windows, or actual sends; its zero-violation claim covers frequency constraints only. Production safeguards are outside this experiment. No clinical efficacy, adherence, real-user preference, or nudge-type conclusion follows from these results.", "",
    "## LLM execution", "", `Unique cached requests: ${llmUsage.unique_cached_requests}; cached request attempts: ${llmUsage.cached_request_attempts}; input/output tokens: ${llmUsage.input_tokens}/${llmUsage.output_tokens}; invalid attempts: ${llmUsage.invalid_attempts}.`,
    "", `Model versions: ${llmUsage.model_versions.join(", ") || "none recorded"}. User confirmed billing disabled; no paid fallback. Forced single-action decisions require no model call. API errors and unfinished requests remain separate from policy outcomes.`, "",
    "## Reproduction", "", "```sh", "node scripts/frequency-comparison/run.js --free-tier-confirmed", "```", "",
    "Run from the System POV repository. The runner verifies source/configuration hashes, resumes existing checkpoints, and never rewrites the frozen model. Omit `--free-tier-confirmed` unless the configured key belongs to a billing-disabled project. `--local-only` runs LR and bandit without API requests.", "",
    "Files: manifest.json, source-snapshot/, validation/, training-cells/, checkpoints/, decisions.jsonl, per_seed.csv, weekly.csv, results.json, llm-cache/, and llm-errors/.", "");
  fs.writeFileSync(path.join(out, "REPORT.md"), lines.join("\n"));
  return report;
}

if (require.main === module) buildReport(path.resolve(process.argv[2]));
module.exports = { describe, pairedBootstrap, summarizeState, buildReport };
