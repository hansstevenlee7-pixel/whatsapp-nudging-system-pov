const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../clinician-summary');
const patient = { has_canonical_schedule: true, prescriptions: [] };
test('unavailable evidence never implies healthy automation', () => {
  const result = summarize(patient, null, null);
  assert.equal(result.actions.length, 2);
  assert.equal(result.status, 'Needs your attention');
});
test('shadow suggestions cannot be presented as applied changes', () => {
  const result = summarize(patient, { envelopes: [] }, { summary: { latest_policy: { mode: 'shadow', outcome: 'applied' } } });
  assert.match(result.change, /Suggestion only/);
});
test('approval and resource failures remain visible', () => {
  const result = summarize({ ...patient, has_canonical_schedule: false, user_status: 'disabled' }, { envelopes: [{ status: 'pending' }], jobs: [{ status: 'failed' }] }, { summary: {} });
  assert.equal(result.actions.length, 4);
});
test('applied outcome and clinician prescription come from stored records', () => {
  const result = summarize({ ...patient, prescriptions: [{ prescription_raw_text: 'Walk after lunch' }] }, { envelopes: [{ status: 'approved' }] }, { summary: { latest_policy: { mode: 'apply', outcome: 'applied', reason: 'Explicit request' } } });
  assert.deepEqual(result.prescriptions, ['Walk after lunch']);
  assert.match(result.change, /recorded as applied/);
  assert.equal(result.actions.length, 0);
});
