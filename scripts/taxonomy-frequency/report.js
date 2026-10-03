"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { OUT } = require("./local-run");
const { mulberry32 } = require("../generate-frequency-dataset");

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
function pairedInterval(values) {
  const random = mulberry32(20260930);
  const draws = Array.from({ length: 10000 }, () => mean(Array.from({ length: values.length },
    () => values[Math.floor(random() * values.length)]))).sort((a, b) => a - b);
  return [draws[249], draws[9749]];
}

function generate(out = OUT) {
  const result = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
  const ablation = JSON.parse(fs.readFileSync(path.join(out, "taxonomy_ablation.json"), "utf8"));
  const geminiFile = path.join(out, "gemini", "results.json");
  const gemini = fs.existsSync(geminiFile) ? JSON.parse(fs.readFileSync(geminiFile, "utf8")) : null;
  const across = result.across_seeds, p = result.paired_contrasts;
  const pct = x => `${(100 * x).toFixed(2)}%`;
  const pp = x => `${(100 * x).toFixed(2)} percentage points`;
  const lines = ["# Taxonomy-grounded synthetic frequency experiment (v2)", "",
    "**Status:** LR, contextual Thompson sampling and random reference complete across ten seeds. " +
      (gemini?.complete ? "Gemini complete across ten seeds." : `Gemini ${gemini?.completed_seeds || 0}/10 seeds; three-method result pending.`), "",
    "Frequency is the model-selected action. The clinician-owned action, pillar, category, nudge type and tone annotate each planned message; the policy can send the first one, two or three approved slots without editing their content.", "",
    "## Local policy results", "",
    "| Policy | Seeds | Mean interactions/message | Mean messages/seed | Mean interactions/seed | Frequency violations |",
    "|---|---:|---:|---:|---:|---:|"];
  for (const [name, row] of Object.entries(across)) lines.push(`| ${name} | ${row.seeds} | ${pct(row.mean_interactions_per_message)} | ${row.mean_delivered_messages.toFixed(1)} | ${row.mean_ordinary_interactions.toFixed(1)} | ${row.total_constraint_violations} |`);
  if (gemini?.complete && gemini.gemini_per_seed?.length === 10) {
    const rows = gemini.gemini_per_seed;
    lines.push(`| Gemini | ${rows.length} | ${pct(mean(rows.map(r => r.interactions_per_message)))} | ${mean(rows.map(r => r.delivered_messages)).toFixed(1)} | ${mean(rows.map(r => r.ordinary_interactions)).toFixed(1)} | ${rows.reduce((sum, r) => sum + r.constraint_violations, 0)} |`);
  }
  lines.push("", `Bandit minus greedy LR: ${pp(p.contextual_thompson_minus_logistic.mean)}; 95% paired seed-bootstrap interval [${pp(p.contextual_thompson_minus_logistic.ci95[0])}, ${pp(p.contextual_thompson_minus_logistic.ci95[1])}]; higher in ${p.contextual_thompson_minus_logistic.higher_seeds}/10 seeds. This small interval is conditional on the stipulated simulator and random seeds, not clinical effectiveness.`,
    "", `Random minus greedy LR: ${pp(p.eligible_random_minus_logistic.mean)}; interval [${pp(p.eligible_random_minus_logistic.ci95[0])}, ${pp(p.eligible_random_minus_logistic.ci95[1])}]. The random policy sent more messages and produced more total interactions, so interaction efficiency alone does not define a universal winner.`,
    "", "## Does taxonomy context help predict?", "",
    "The ablation compares the same model and data with all taxonomy features versus the original seven frequency/history features. Lower Brier and higher PR-AUC are better.", "",
    "| Split | Full Brier | Frequency-only Brier | Full PR-AUC | Frequency-only PR-AUC | Seeds improved (Brier / PR-AUC) |",
    "|---|---:|---:|---:|---:|---:|");
  if (gemini?.complete && gemini.matched_logistic_comparison?.length === 10) {
    const differences = gemini.matched_logistic_comparison.map(r => r.gemini_minus_logistic);
    const interval = pairedInterval(differences);
    lines.splice(lines.indexOf("## Does taxonomy context help predict?"), 0,
      `Gemini minus greedy LR: ${pp(mean(differences))}; 95% paired seed-bootstrap interval [${pp(interval[0])}, ${pp(interval[1])}]. This comparison uses a compressed LLM training summary and is conditional on the simulator.` , "");
  }
  for (const [split, a] of Object.entries(ablation.across_seeds)) lines.push(`| ${split} | ${a.full_brier.toFixed(4)} | ${a.frequency_only_brier.toFixed(4)} | ${a.full_pr_auc.toFixed(4)} | ${a.frequency_only_pr_auc.toFixed(4)} | ${a.brier_improved_seeds}/10 / ${a.pr_auc_improved_seeds}/10 |`);
  lines.push("", "The taxonomy features help on validation but are mixed on the held-out test split. Their benefit has not been established. The taxonomy still makes message context and safety decisions explicit and inspectable.", "",
    "## Evidence boundaries", "",
    "This is a separate generator and version from the original frozen table. Values across the two simulators should not be compared as if they came from the same population. The synthetic action examples and response effects are declared assumptions, not clinical evidence. Hidden affinities never enter policy inputs. Weekly frequency is the sole selected action. The app's clinical application gates, STOP handling, delivery and user outcomes were not tested here.", "",
    "The LLM uses a compressed contingency summary of the logged rows; LR and bandit use the full feature table. The three methods share the simulator, action envelope and observable current context, but do not have identical statistical input resolution. LLM results require their own limitation statement when complete.", "",
    "## Artifacts", "",
    "`manifest.json` fixes source and dataset hashes. `results.json` holds every local seed; `taxonomy_ablation.json` holds predictive diagnostics; `decisions.jsonl` and `feedback.jsonl` hold replay evidence; `gemini/` holds the separately checkpointed LLM arm. The original experiment is preserved in `output/frequency_comparison_2026-09-30/`.", "");
  fs.writeFileSync(path.join(out, "REPORT.md"), lines.join("\n"));
  return path.join(out, "REPORT.md");
}
if (require.main === module) console.log(generate());
module.exports = { generate };
