(function (root) {
  'use strict';
  function summarize(patient, adaptive, dictionary) {
    const actions = [];
    const paused = /^(disabled|paused|stopped|opted_out)$/i.test(patient.user_status || '');
    if (paused) actions.push('Messaging is paused or disabled. Review the patient status before planning delivery.');
    if (!patient.has_canonical_schedule) actions.push('Review and approve the prepared message plan.');
    if (!adaptive || adaptive.error) actions.push('Resource approval status is unavailable. Refresh before relying on automatic resource selection.');
    else {
      const missing = (patient.weekly_schedule || []).some(slot => (!slot.media_selection_mode || slot.media_selection_mode === 'automatic') && !(adaptive.envelopes || []).some(env => env.action_text === slot.action_text && env.pillar === slot.pillar && env.category === slot.category));
      if (missing) actions.push('Automatic resources are not prepared for every planned activity. Open the plan to prepare and review them.');
      const pending = (adaptive.envelopes || []).filter(item => item.status !== 'approved').length;
      if (pending) actions.push(pending + ' resource set' + (pending === 1 ? ' needs' : 's need') + ' review before automatic selection.');
      const failures = (adaptive.jobs || []).filter(item => item.status === 'failed').length;
      if (failures) actions.push('Resource preparation has a failed job. Open the message plan to review it.');
    }
    if (!dictionary) actions.push('Interaction and adaptation evidence is unavailable. Refresh to try again.');
    const policy = dictionary && dictionary.summary && dictionary.summary.latest_policy;
    let change = 'No recorded schedule adaptation yet.';
    if (policy) {
      if (policy.mode === 'shadow') change = 'Suggestion only — no schedule change was applied by this evaluation.';
      else if (policy.outcome === 'applied') change = 'An adaptation was recorded as applied to future messages.';
      else change = 'The latest evaluation did not record an applied schedule change.';
      if (policy.reason) change += ' ' + policy.reason;
    }
    return {
      actions,
      change,
      prescriptions: [...new Set((patient.prescriptions || []).map(item => item.prescription_raw_text || item.target_behavior).filter(Boolean))],
      status: actions.length ? 'Needs your attention' : 'No pending approval found in the loaded records',
      evidenceAt: dictionary && dictionary.generated_at || null
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { summarize };
  else root.ClinicianSummary = { summarize };
})(typeof window !== 'undefined' ? window : globalThis);
