"use strict";

// RQ1 trace-completeness: a derived, descriptive measure computed from existing
// benchmark traces (no re-execution). For every evaluated step it checks whether
// each link of the prescription-to-next-message chain can be followed by an
// explicit identifier in the persisted stores, not by inference from timing.
//
//   node scripts/adaptation-benchmark/trace-completeness.js output/adaptation_benchmark_2026-10-02_postfix

const fs = require("node:fs");
const path = require("node:path");

const LINKS = {
  reply_to_interaction: "Inbound reply stored as an interaction event with its interaction_id and source nudge_id",
  interaction_to_decision: "Interaction decision persisted with a decision_id that carries the same interaction_id",
  decision_to_envelope: "Decision behaviour_key resolves to an approved envelope carrying the taxonomy triple",
  policy_to_audit: "Model recommendation and policy outcome persisted as separate rows sharing the evaluation_key",
  schedule_change_to_decision: "Changed recurring schedule rows name the persisted applied policy decision that changed them",
  next_message_to_decision: "Prepared next message names a persisted adaptation decision",
  next_message_to_prescription: "Prepared next message resolves to an active prescription",
  tracked_link_to_next_message: "Tracked media link names the prepared next message"
};

const rowsOf = table => (table && (table.rows || table)) || [];
const filled = value => value !== undefined && value !== null && String(value) !== "";

function slotSignature(rows) {
  return JSON.stringify(rowsOf(rows).filter(row => row.status === "active").map(row => [row.schedule_slot_id, row.day, row.scheduled_time]).sort());
}

function evaluateStep(trace, step, index) {
  const sheets = step.persisted_after.sheets; const db = step.persisted_after.database;
  const decisions = rowsOf(db.adaptation_decisions); const result = {};
  const body = step.input.body; const decision = step.decision || {};
  if (body != null && body !== "STOP") {
    result.reply_to_interaction = rowsOf(db.interaction_events).some(row => row.interaction_id === decision.interaction_id && filled(row.nudge_id) && row.nudge_id === decision.nudge_id);
    result.interaction_to_decision = filled(decision.decision_id) && decisions.some(row => row.decision_id === decision.decision_id && row.interaction_id === decision.interaction_id);
    result.decision_to_envelope = rowsOf(db.adaptation_envelopes).some(row => row.behaviour_key === decision.behaviour_key && row.status === "approved" &&
      filled(row.action_text) && filled(row.pillar) && filled(row.category));
  }
  const evaluation = step.policy && step.policy.body && step.policy.body.result;
  if (evaluation && evaluation.evaluation_key) {
    const shared = decisions.filter(row => row.interpretation && row.interpretation.evaluation_key === evaluation.evaluation_key).map(row => row.signal_type);
    result.policy_to_audit = shared.includes("frequency_model_recommendation") && shared.some(type => String(type).startsWith("adaptive_policy"));
  }
  const before = index === 0 ? trace.initial.sheets.weekly_schedule : trace.steps[index - 1].persisted_after.sheets.weekly_schedule;
  if (slotSignature(before) !== slotSignature(sheets.weekly_schedule)) {
    // Every active slot must name a persisted, applied policy decision.
    result.schedule_change_to_decision = rowsOf(sheets.weekly_schedule).filter(row => row.status === "active").every(row =>
      filled(row.adaptation_decision_id) && decisions.some(d => d.decision_id === row.adaptation_decision_id && d.signal_type === "adaptive_policy_applied"));
  }
  const prepared = step.prepared && step.prepared.body;
  if (prepared && prepared.nudge_id) {
    result.next_message_to_decision = filled(prepared.adaptation_decision_id) && decisions.some(row => row.decision_id === prepared.adaptation_decision_id);
    const nudge = rowsOf(sheets.nudges).find(row => row.nudge_id === prepared.nudge_id);
    result.next_message_to_prescription = Boolean(nudge) && rowsOf(sheets.prescriptions).some(row => row.prescription_id === nudge.prescription_id && row.status === "active");
    if (filled(prepared.media_asset_id)) result.tracked_link_to_next_message = rowsOf(db.tracked_links).some(row => row.nudge_id === prepared.nudge_id && row.asset_id === prepared.media_asset_id);
  }
  return result;
}

function main() {
  const out = path.resolve(process.argv[2] || "output/adaptation_benchmark_2026-10-02_postfix");
  const traces = fs.readdirSync(path.join(out, "traces")).filter(file => file.endsWith("--1.json")).map(file => JSON.parse(fs.readFileSync(path.join(out, "traces", file))));
  const byArm = {};
  for (const trace of traces) {
    const arm = byArm[trace.arm] = byArm[trace.arm] || { steps: 0, complete_steps: 0, links: {} };
    trace.steps.forEach((step, index) => {
      const links = evaluateStep(trace, step, index); arm.steps += 1;
      if (Object.values(links).every(Boolean)) arm.complete_steps += 1;
      for (const [name, ok] of Object.entries(links)) {
        const cell = arm.links[name] = arm.links[name] || { applicable: 0, present: 0, missing_cases: [] };
        cell.applicable += 1; if (ok) cell.present += 1; else cell.missing_cases.push(trace.case_id);
      }
    });
  }
  const result = { source: path.basename(out), measure: "derived from existing first-run traces; descriptive, not pre-registered", link_definitions: LINKS, arms: byArm };
  fs.writeFileSync(path.join(out, "trace_completeness.json"), `${JSON.stringify(result, null, 2)}\n`);
  const lines = ["# RQ1 trace completeness", "", `Derived from first-run traces in \`${path.basename(out)}\`. A link counts only when an explicit identifier connects the two records in the persisted local stores; timing-based inference does not count.`, ""];
  for (const [arm, value] of Object.entries(byArm)) {
    lines.push(`## ${arm}`, "", `Steps with every applicable link present: ${value.complete_steps}/${value.steps}`, "", "| Link | Present / applicable | Missing in |", "|---|---:|---|");
    for (const name of Object.keys(LINKS)) if (value.links[name]) {
      const cell = value.links[name];
      lines.push(`| ${LINKS[name]} | ${cell.present}/${cell.applicable} | ${cell.missing_cases.join(", ") || "—"} |`);
    }
    lines.push("");
  }
  fs.writeFileSync(path.join(out, "TRACE_COMPLETENESS.md"), `${lines.join("\n")}\n`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (require.main === module) main();
module.exports = { evaluateStep, LINKS };
