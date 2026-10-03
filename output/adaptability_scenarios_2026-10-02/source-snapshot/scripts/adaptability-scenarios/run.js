"use strict";

// Runs the frozen adaptability scenario suite (PROTOCOL.md) and writes an
// evidence folder. Local and deterministic: no network, no model retraining.
//
//   node scripts/adaptability-scenarios/run.js [--out output/NAME]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const core = require("./core");

const ROOT = path.resolve(__dirname, "../..");
const PROTOCOL_VERSION = "adaptability-scenarios-v1";
const SOURCES = ["scripts/adaptability-scenarios/PROTOCOL.md", "scripts/adaptability-scenarios/core.js", "scripts/adaptability-scenarios/run.js",
  "scripts/policy-baselines.js", "scripts/generate-frequency-dataset.js", "landing/api/_lib/frequency-model.js",
  "landing/api/_lib/frequency-shadow.js", "landing/api/_lib/behaviour-policy.js", "landing/api/_lib/adaptive-core.js",
  "landing/api/_models/frequency-logistic-v1.json"];
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const write = (file, value) => fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);

function stats(values) {
  const list = values.filter(value => value !== null && Number.isFinite(value));
  if (!list.length) return { mean: null, sd: null, n: 0 };
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  const sd = list.length > 1 ? Math.sqrt(list.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (list.length - 1)) : 0;
  return { mean, sd, n: list.length };
}

function pooledAccuracy(accuracy, keys) {
  const cells = keys.map(key => accuracy[key]);
  const weeks = cells.reduce((sum, cell) => sum + cell.profile_weeks, 0);
  return { exact_match: cells.reduce((sum, cell) => sum + cell.exact_match * cell.profile_weeks, 0) / weeks,
    mean_absolute_error: cells.reduce((sum, cell) => sum + cell.mean_absolute_error * cell.profile_weeks, 0) / weeks };
}

// Flat per-seed metrics used for summaries, contrasts and the CSV.
function flatten(result, oracleRate, fixedRate) {
  const accuracy = result.accuracy;
  return {
    seed: result.seed, arm: result.arm,
    delivered_messages: result.efficiency.delivered_messages, ordinary_interactions: result.efficiency.ordinary_interactions,
    interactions_per_message: result.efficiency.interactions_per_message,
    oracle_gap_closure: oracleRate === fixedRate ? null : (result.efficiency.interactions_per_message - fixedRate) / (oracleRate - fixedRate),
    sensitivity: result.responsiveness.sensitivity, sensitivity_up: result.responsiveness.sensitivity_up,
    sensitivity_down: result.responsiveness.sensitivity_down, specificity: result.restraint.specificity,
    unnecessary_change_rate: result.restraint.unnecessary_change_rate,
    settled_up_needed: result.settling.up.needed_to_move.settled_by_week_12, settle_up_median: result.settling.up.needed_to_move.median_settling_decisions,
    settled_down_needed: result.settling.down.needed_to_move.settled_by_week_12, settle_down_median: result.settling.down.needed_to_move.median_settling_decisions,
    settled_up_all: result.settling.up.all.settled_by_week_12, settled_down_all: result.settling.down.all.settled_by_week_12,
    changes_per_profile: result.stability.changes_per_profile, reversals_per_profile: result.stability.reversals_per_profile,
    violations: result.boundedness.total, silence_increases: result.boundedness.silence_increase,
    exact_match_all: pooledAccuracy(accuracy, ["pre_stable", "pre_shifted", "post_stable", "post_shifted"]).exact_match,
    mae_all: pooledAccuracy(accuracy, ["pre_stable", "pre_shifted", "post_stable", "post_shifted"]).mean_absolute_error,
    exact_match_pre: pooledAccuracy(accuracy, ["pre_stable", "pre_shifted"]).exact_match,
    exact_match_post_stable: accuracy.post_stable.exact_match, exact_match_post_shifted: accuracy.post_shifted.exact_match
  };
}

const METRICS = ["interactions_per_message", "delivered_messages", "ordinary_interactions", "oracle_gap_closure", "sensitivity", "sensitivity_up",
  "sensitivity_down", "specificity", "unnecessary_change_rate", "settled_up_needed", "settle_up_median", "settled_down_needed",
  "settle_down_median", "settled_up_all", "settled_down_all", "changes_per_profile", "reversals_per_profile", "violations",
  "silence_increases", "exact_match_all", "mae_all", "exact_match_pre", "exact_match_post_stable", "exact_match_post_shifted"];
const CONTRASTS = [["model_operative", "deterministic"], ["model_selector", "deterministic"], ["model_operative", "model_selector"]];
const CONTRAST_METRICS = ["interactions_per_message", "sensitivity", "sensitivity_up", "specificity", "exact_match_post_shifted", "reversals_per_profile"];

function main() {
  const args = process.argv.slice(2);
  const out = path.resolve(ROOT, args.includes("--out") ? args[args.indexOf("--out") + 1] : "output/adaptability_scenarios_2026-10-02");
  const sourceHashes = Object.fromEntries(SOURCES.map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
  const configuration = { protocol_version: PROTOCOL_VERSION, seeds: core.SEEDS, weeks: core.WEEKS, shift_week: core.SHIFT_WEEK,
    part_a_arms: core.PART_A_ARMS, part_b_arms: core.PART_B_ARMS, source_hashes: sourceHashes };
  const configurationHash = sha(JSON.stringify(configuration));
  const manifestPath = path.join(out, "manifest.json");
  if (fs.existsSync(manifestPath) && JSON.parse(fs.readFileSync(manifestPath, "utf8")).configuration_sha256 !== configurationHash) {
    throw new Error("Protocol or source changed since this folder was produced; use a new output directory");
  }
  fs.mkdirSync(path.join(out, "source-snapshot"), { recursive: true });
  if (!fs.existsSync(manifestPath)) {
    write(manifestPath, { created_at: new Date().toISOString(), configuration_sha256: configurationHash, configuration, node: process.version,
      git_commit: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      working_tree: "dirty; source-snapshot/ and source_hashes are authoritative", network: "none", model_retraining: "none" });
    for (const file of SOURCES) {
      const target = path.join(out, "source-snapshot", file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), target);
    }
  }

  const artifact = core.loadArtifact();
  const perSeed = []; const flat = [];
  for (const seed of core.SEEDS) {
    const results = Object.fromEntries(core.PART_A_ARMS.map(arm => [arm, core.runPartA(seed, arm, artifact)]));
    perSeed.push({ seed, arms: results });
    const oracleRate = results.oracle.efficiency.interactions_per_message; const fixedRate = results.fixed_2.efficiency.interactions_per_message;
    for (const arm of core.PART_A_ARMS) flat.push(flatten(results[arm], oracleRate, fixedRate));
  }
  const summary = Object.fromEntries(core.PART_A_ARMS.map(arm => [arm,
    Object.fromEntries(METRICS.map(metric => [metric, stats(flat.filter(row => row.arm === arm).map(row => row[metric]))]))]));
  const contrasts = Object.fromEntries(CONTRASTS.map(([left, right]) => [`${left}_minus_${right}`,
    Object.fromEntries(CONTRAST_METRICS.map(metric => {
      const differences = core.SEEDS.map(seed => {
        const a = flat.find(row => row.seed === seed && row.arm === left)[metric]; const b = flat.find(row => row.seed === seed && row.arm === right)[metric];
        return a === null || b === null ? null : a - b;
      });
      return [metric, Object.assign(stats(differences), { higher_in: differences.filter(value => value > 0).length, seeds: core.SEEDS.length })];
    }))]));
  const personas = core.runPartB(artifact);
  const violationsImplementable = core.IMPLEMENTABLE.reduce((sum, arm) => sum + flat.filter(row => row.arm === arm).reduce((s, row) => s + row.violations, 0), 0)
    + personas.reduce((sum, persona) => sum + core.IMPLEMENTABLE.reduce((s, arm) => s + persona.arms[arm].violations, 0), 0);

  const weekly = [];
  for (const arm of core.PART_A_ARMS) for (const group of ["stable", "shifted_up", "shifted_down"]) for (let week = 1; week <= core.WEEKS; week += 1) {
    const cells = perSeed.map(entry => entry.arms[arm].weekly[group][week - 1]);
    const profiles = cells.reduce((sum, cell) => sum + cell.profiles, 0);
    weekly.push({ arm, group, week, mean_frequency: cells.reduce((sum, cell) => sum + cell.frequency, 0) / profiles,
      mean_preference: cells.reduce((sum, cell) => sum + cell.preference, 0) / profiles, profile_weeks: profiles });
  }

  const results = { protocol_version: PROTOCOL_VERSION, configuration_sha256: configurationHash, seeds: core.SEEDS,
    hard_criterion_A5: { implementable_arm_violations: violationsImplementable, met: violationsImplementable === 0 },
    part_a: { summary, paired_contrasts: contrasts, per_seed: perSeed.map(entry => ({ seed: entry.seed,
      arms: Object.fromEntries(Object.entries(entry.arms).map(([arm, value]) => [arm, Object.assign({}, value, { weekly: undefined })])) })) },
    part_b: personas };
  write(path.join(out, "results.json"), results);
  write(path.join(out, "per_seed.csv"), [["seed", "arm", ...METRICS].join(","), ...flat.map(row => [row.seed, row.arm, ...METRICS.map(m => row[m] ?? "")].join(","))].join("\n") + "\n");
  write(path.join(out, "weekly.csv"), ["arm,group,week,mean_frequency,mean_preference,profile_weeks",
    ...weekly.map(row => [row.arm, row.group, row.week, row.mean_frequency.toFixed(6), row.mean_preference.toFixed(6), row.profile_weeks].join(","))].join("\n") + "\n");
  write(path.join(out, "personas.csv"), ["persona,name,rule," + core.PART_B_ARMS.map(arm => `${arm}_pass,${arm}_frequencies`).join(","),
    ...personas.map(p => [p.id, p.name, `"${p.rule}"`, ...core.PART_B_ARMS.map(arm => `${p.arms[arm].pass},${p.arms[arm].frequencies.join("")}`)].join(","))].join("\n") + "\n");
  write(path.join(out, "REPORT.md"), report(results));
  write(path.join(out, "results.sha256"), `${sha(fs.readFileSync(path.join(out, "results.json")))}  results.json\n`);
  process.stdout.write(`${report(results)}\nWrote ${out}\n`);
}

const pct = value => (value === null || value === undefined ? "—" : `${(100 * value).toFixed(1)}%`);
const fmt = (entry, digits = 3, percent = false) => (entry.mean === null ? "—" : percent
  ? `${(100 * entry.mean).toFixed(1)}% ± ${(100 * entry.sd).toFixed(1)}` : `${entry.mean.toFixed(digits)} ± ${entry.sd.toFixed(digits)}`);

function report(results) {
  const s = results.part_a.summary; const arms = core.PART_A_ARMS;
  const row = (label, metric, digits, percent) => `| ${label} | ${arms.map(arm => fmt(s[arm][metric], digits, percent)).join(" | ")} |`;
  const header = `| Measure | ${arms.join(" | ")} |\n|---|${arms.map(() => "---:").join("|")}|`;
  const contrastLines = Object.entries(results.part_a.paired_contrasts).flatMap(([name, metrics]) =>
    Object.entries(metrics).map(([metric, entry]) => `| ${name} | ${metric} | ${entry.mean === null ? "—" : `${entry.mean.toFixed(4)} ± ${entry.sd.toFixed(4)}`} | ${entry.higher_in}/${entry.seeds} |`));
  const personaLines = results.part_b.map(p => `| ${p.id} ${p.name} | ${p.rule} | ${core.PART_B_ARMS.map(arm => `${p.arms[arm].pass ? "PASS" : "FAIL"} \`${p.arms[arm].frequencies.join("")}\``).join(" | ")} |`);
  return `# Adaptability scenario suite (${results.protocol_version})

Local deterministic simulation; frozen model; no network, deployment or WhatsApp send. Protocol: \`scripts/adaptability-scenarios/PROTOCOL.md\`. Configuration SHA-256 \`${results.configuration_sha256}\`.

**Hard criterion A5 (implementable arms, Parts A and B):** ${results.hard_criterion_A5.implementable_arm_violations} violations — ${results.hard_criterion_A5.met ? "met" : "NOT met"}.

## Part A: population drift (300 profiles x 12 weeks x ${results.seeds.length} seeds; half shift preference after week 6)

Mean ± SD across seeds. \`oracle\` reads hidden state and is a reference bound only.

${header}
| **A1 Responsiveness** | | | | | |
${row("Sensitivity, all", "sensitivity", 3, true)}
${row("Sensitivity, target above current", "sensitivity_up", 3, true)}
${row("Sensitivity, target below current", "sensitivity_down", 3, true)}
| **A2 Restraint** | | | | | |
${row("Specificity", "specificity", 3, true)}
${row("Unnecessary-change rate", "unnecessary_change_rate", 3, true)}
| **A3 Settling (profiles needing to move)** | | | | | |
${row("Up-shift settled by week 12", "settled_up_needed", 3, true)}
${row("Up-shift median decisions to settle", "settle_up_median", 2)}
${row("Down-shift settled by week 12", "settled_down_needed", 3, true)}
${row("Down-shift median decisions to settle", "settle_down_median", 2)}
| **A4 Stability** | | | | | |
${row("Changes per profile", "changes_per_profile", 2)}
${row("Reversals per profile", "reversals_per_profile", 3)}
| **A5 Boundedness** | | | | | |
${row("Defined violations", "violations", 1)}
${row("Silence increases", "silence_increases", 1)}
| **A6 Accuracy** | | | | | |
${row("Exact match, all weeks", "exact_match_all", 3, true)}
${row("Exact match, weeks 1-6", "exact_match_pre", 3, true)}
${row("Exact match, weeks 7-12 stable", "exact_match_post_stable", 3, true)}
${row("Exact match, weeks 7-12 shifted", "exact_match_post_shifted", 3, true)}
${row("Mean absolute error", "mae_all", 3)}
${row("Oracle-gap closure (interactions/message)", "oracle_gap_closure", 3)}
| **E Efficiency (simulation only)** | | | | | |
${row("Interactions per message", "interactions_per_message", 4)}
${row("Delivered messages", "delivered_messages", 0)}
${row("Ordinary interactions", "ordinary_interactions", 0)}

### Paired per-seed contrasts

| Contrast | Measure | Mean ± SD | Higher in |
|---|---|---:|---:|
${contrastLines.join("\n")}

## Part B: scripted personas (deterministic)

Weekly frequencies for weeks 1-12 are shown in backticks.

| Persona | Pre-declared pass rule | ${core.PART_B_ARMS.join(" | ")} |
|---|---|${core.PART_B_ARMS.map(() => "---").join("|")}|
${personaLines.join("\n")}

## Boundaries

The response function, hidden preferences and shift design are declared simulation assumptions, not estimates of real behaviour. \`model_operative\` runs the deployed \`evaluateAdaptive\` policy on synthetic fixtures; the 7-day cooldown is not separately exercised because decisions are weekly. Decision labels use the hidden preference behind the latest evidence. No adherence, behaviour-change, clinical or real-user claim follows. No significance test is claimed.
`;
}

if (require.main === module) main();
module.exports = { stats, flatten };
