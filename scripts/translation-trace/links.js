"use strict";

// Link checks for PROTOCOL.md (v1). A link counts only when an explicit
// identifier or stored value connects the two records in the persisted stores.
// T12-T19 reuse the benchmark definitions (trace-completeness.js) unchanged.

const { evaluateStep, LINKS: BENCHMARK_LINKS } = require("../adaptation-benchmark/trace-completeness");
const { behaviourKey } = require("../../landing/api/_lib/adaptive-core");

const LINKS = {
  T1: "Prescription row carries the submitted prescription text",
  T2: "A stored row names the model and prompt version that produced the prescription and its drafts",
  T3: "Draft's prescription_id is the prescription its LLM prescription_ref named",
  T4: "A schedule_state row names the draft",
  T5: "Approved slot's source_nudge_id is a Workflow A draft of the same prescription",
  T6: "The approved schedule records which clinician approved it, and when",
  T7: "For every field the clinician changed, both the LLM value and the approved value remain stored",
  T8: "Approved behaviour resolves by behaviour_key to an approved envelope naming its approving clinician",
  T9: "Dated occurrence names its slot and that slot's prescription",
  T10: "Submitted delivery has a reservation ID and provider message ID on its occurrence's state row, and the occurrence is marked sent",
  T11: "Status callback stored as a delivery event naming the occurrence"
};
const BENCHMARK_IDS = Object.fromEntries(Object.keys(BENCHMARK_LINKS).map((name, i) => [name, `T${12 + i}`]));
const ALL_LINKS = Object.assign({}, LINKS, Object.fromEntries(Object.entries(BENCHMARK_LINKS).map(([name, text]) => [BENCHMARK_IDS[name], text])));

const filled = value => value !== undefined && value !== null && String(value).trim() !== "";
const rows = table => (table && (table.rows || table)) || [];
const PROVENANCE_MODEL = /(^|_)(model|llm|generated_by|translat)/i;
const PROVENANCE_PROMPT = /prompt/i;

// Workflow A rows for one patient, with the LLM's own references attached by
// write order (the gate maps prescriptions and nudges in array order).
function intakeRows(stores, userId, llm) {
  const prescriptions = rows(stores.sheets.prescriptions).filter(r => r.user_id === userId && String(r.prescription_id).startsWith("rx_"));
  const drafts = rows(stores.sheets.nudges).filter(r => r.user_id === userId && String(r.nudge_id).startsWith("ndg_"));
  const refs = (llm.prescriptions || []).map(p => p.ref);
  return { prescriptions, drafts, prescriptionByRef: Object.fromEntries(refs.map((ref, i) => [ref, prescriptions[i]]).filter(([, row]) => row)),
    draftRefs: drafts.map((_, i) => ((llm.nudges || [])[i] || {}).prescription_ref) };
}

function translationLinks(stores, userId, llm, submittedText) {
  const out = { T1: [], T2: [], T3: [], T4: [] };
  const { prescriptions, drafts, prescriptionByRef, draftRefs } = intakeRows(stores, userId, llm);
  for (const p of prescriptions) {
    out.T1.push({ id: p.prescription_id, ok: p.prescription_raw_text === submittedText });
    const related = [p, ...drafts.filter(d => d.prescription_id === p.prescription_id)];
    const fields = related.flatMap(row => Object.entries(row).filter(([, v]) => filled(v)).map(([k]) => k));
    out.T2.push({ id: p.prescription_id, ok: fields.some(k => PROVENANCE_MODEL.test(k)) && fields.some(k => PROVENANCE_PROMPT.test(k)) });
  }
  drafts.forEach((d, i) => {
    const intended = prescriptionByRef[draftRefs[i]];
    out.T3.push({ id: d.nudge_id, ok: Boolean(intended) && d.prescription_id === intended.prescription_id,
      note: intended ? undefined : `prescription_ref ${JSON.stringify(draftRefs[i])} names no prescription; written as ${d.prescription_id}` });
    out.T4.push({ id: d.nudge_id, ok: rows(stores.sheets.schedule_state).some(s => s.nudge_id === d.nudge_id) });
  });
  return out;
}

// Approval links, evaluated on the stores right after approval and envelope approval.
function approvalLinks(stores, chain) {
  const out = { T5: [], T6: [], T7: [], T8: [] };
  const drafts = rows(stores.sheets.nudges).filter(r => r.user_id === chain.user_id && String(r.nudge_id).startsWith("ndg_"));
  const slots = rows(stores.sheets.weekly_schedule).filter(r => r.user_id === chain.user_id && r.status === "active");
  const decisions = rows(stores.database.adaptation_decisions);
  for (const slot of slots) {
    const draft = drafts.find(d => d.nudge_id === slot.source_nudge_id);
    out.T5.push({ id: slot.schedule_slot_id, ok: Boolean(draft) && draft.prescription_id === slot.prescription_id });
    const key = behaviourKey(slot);
    // "Which clinician approved it, and when": an identity field naming the clinician
    // plus a filled time field on the same record.
    const attributed = record => Object.entries(record).some(([k, v]) => /approv|review|clinician|actor/i.test(k) && String(v) === chain.clinician.auth_user_id) &&
      Object.entries(record).some(([k, v]) => /approv\w*_at$|review\w*_at$|decided_at$/i.test(k) && filled(v));
    const named = attributed(slot) || decisions.some(d => d.behaviour_key === key && d.decision_source === "clinician" && attributed(d));
    out.T6.push({ id: slot.schedule_slot_id, ok: named });
  }
  for (const change of chain.clinician_changes) {
    let llmKept;
    if (change.scope === "draft") {
      const draft = drafts.find(d => d.nudge_id === change.draft_id);
      llmKept = Boolean(draft) && String(draft[change.field]) === String(change.llm_value);
    } else {
      const holders = [...rows(stores.sheets.prescriptions), ...drafts].filter(r => r.prescription_id === change.prescription_id);
      // A revision row keeps a replaced value as previous_value under its field name.
      const revisions = rows(stores.sheets.prescription_revisions).filter(r => r.prescription_id === change.prescription_id && r.field === change.field);
      llmKept = holders.some(r => String(r[change.field]) === String(change.llm_value)) ||
        revisions.some(r => String(r.previous_value) === String(change.llm_value) && String(r.new_value) === String(change.approved_value));
    }
    out.T7.push({ id: `${change.scope}:${change.field}:${change.draft_id || change.prescription_id}`, ok: llmKept && change.approved_kept(stores),
      note: llmKept ? undefined : `the LLM value ${JSON.stringify(change.llm_value)} is no longer stored` });
  }
  for (const key of [...new Set(slots.map(slot => behaviourKey(slot)))]) {
    const envelope = rows(stores.database.adaptation_envelopes).find(e => e.behaviour_key === key && e.user_id === chain.user_id && e.status === "approved");
    out.T8.push({ id: key, ok: Boolean(envelope) && envelope.approved_by === chain.clinician.auth_user_id && filled(envelope.pillar) && filled(envelope.category) && filled(envelope.action_text) });
  }
  return out;
}

function deliveryLinks(stores, chain) {
  const out = { T9: [], T10: [], T11: [] };
  const slots = rows(stores.sheets.weekly_schedule).filter(r => r.user_id === chain.user_id);
  for (const occurrence of rows(stores.sheets.nudges).filter(r => r.user_id === chain.user_id && String(r.nudge_id).startsWith("schd_"))) {
    const slot = slots.find(s => s.schedule_slot_id === occurrence.schedule_slot_id);
    out.T9.push({ id: occurrence.nudge_id, ok: Boolean(slot) && slot.prescription_id === occurrence.prescription_id });
  }
  for (const delivery of chain.deliveries) {
    const state = rows(stores.sheets.schedule_state).find(s => s.nudge_id === delivery.nudge_id);
    const nudge = rows(stores.sheets.nudges).find(n => n.nudge_id === delivery.nudge_id);
    out.T10.push({ id: delivery.nudge_id, ok: Boolean(state) && String(state.delivery_attempt_id).startsWith("att_") && state.wa_message_id === delivery.sid &&
      Boolean(nudge) && nudge.status === "sent" });
    if (delivery.callback) out.T11.push({ id: delivery.sid, ok: rows(stores.sheets.delivery_events).some(e => e.wa_message_id === delivery.sid && e.nudge_id === delivery.nudge_id) });
  }
  return out;
}

function feedbackLinks(chain) {
  if (!chain.feedback) return {};
  const step = { input: { body: chain.feedback.reply }, decision: chain.feedback.decision, policy: chain.feedback.policy,
    prepared: chain.feedback.prepared, persisted_after: chain.feedback.after };
  const result = evaluateStep({ initial: chain.feedback.before }, step, 0);
  return Object.fromEntries(Object.entries(result).map(([name, ok]) => [BENCHMARK_IDS[name], [{ id: name, ok }]]));
}

// Walk back from the last delivered message to the submitted text using only
// the specific link instances on that path.
function chainClosure(stores, chain, submittedText) {
  const last = chain.deliveries[chain.deliveries.length - 1];
  if (!last) return { closed: false, path: [], broken_at: "no delivery" };
  const path = [];
  const state = rows(stores.sheets.schedule_state).find(s => s.nudge_id === last.nudge_id);
  if (!(state && state.wa_message_id === last.sid)) return { closed: false, path, broken_at: "T10 provider message -> occurrence" };
  path.push(`message ${last.sid} -> occurrence ${last.nudge_id}`);
  const occurrence = rows(stores.sheets.nudges).find(n => n.nudge_id === last.nudge_id);
  const slot = occurrence && rows(stores.sheets.weekly_schedule).find(s => s.schedule_slot_id === occurrence.schedule_slot_id);
  if (!slot) return { closed: false, path, broken_at: "T9 occurrence -> slot" };
  path.push(`occurrence -> slot ${slot.schedule_slot_id}`);
  const draft = rows(stores.sheets.nudges).find(n => n.nudge_id === slot.source_nudge_id && String(n.nudge_id).startsWith("ndg_"));
  if (!(draft && draft.prescription_id === slot.prescription_id)) return { closed: false, path, broken_at: "T5 slot -> LLM draft" };
  path.push(`slot -> LLM draft ${draft.nudge_id}`);
  const prescription = rows(stores.sheets.prescriptions).find(p => p.prescription_id === draft.prescription_id);
  if (!prescription) return { closed: false, path, broken_at: "T3 draft -> prescription" };
  path.push(`draft -> prescription ${prescription.prescription_id}`);
  if (prescription.prescription_raw_text !== submittedText) return { closed: false, path, broken_at: "T1 prescription -> submitted text" };
  path.push("prescription -> submitted text");
  return { closed: true, path, broken_at: null };
}

module.exports = { LINKS: ALL_LINKS, intakeRows, translationLinks, approvalLinks, deliveryLinks, feedbackLinks, chainClosure };
