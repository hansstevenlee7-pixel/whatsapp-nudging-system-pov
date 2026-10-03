# Schedule-change experiment — 9 September 2026

## Purpose and evidence boundary

This is a local, deterministic experiment of the System POV schedule writer. It checks whether a bounded frequency/time recommendation is persisted without rewriting a delivery that already has sending history. The experiment uses only synthetic rows in the in-memory Sheets fixture. It is not a participant study, a Google Sheets run, a Twilio test, or evidence that automatic adaptation is enabled in a deployed environment. The model-to-policy companion is documented in `MODEL_DRIVEN_SCHEDULE_CHANGE_EXPERIMENT_2026-09-09.md`, with a machine-readable result in `docs/evidence/modelled-schedule-change-2026-09-09.json`.

The implementation under test is `applyAdaptiveSchedule` in `landing/api/_lib/schedule-store.js`. The related worker path is covered separately by `landing/tests/frequency-worker.test.js`.

## Scenario

- Synthetic user: `patient-1`.
- Behaviour: `Be in bed by 10pm`, pillar `sleep`, category `establish`.
- Initial recurring plan: two active slots, Monday and Thursday at `09:00`, covering 7 September–4 October 2026.
- Historical delivery: Monday 7 September, status `sent`, with a Message SID and sent/delivered timestamps.
- Future unsent rows: Monday 14 September and Thursday 10 September, both initially `approved` with no sending history.
- Requested bounded change: frequency `2 -> 1` per week and delivery time `09:00 -> 18:30`.
- Evaluation time: `2026-09-09T00:00:00.000Z`.

The target frequency is within the allowed one-to-three messages-per-week range. The writer retains one existing slot, moves its time, and regenerates the future dated occurrences. A future occurrence belonging to the removed Thursday slot is stale and unsent, so it may be rejected. The historical Monday occurrence must remain byte-for-byte unchanged.

## Observed result

| Check | Observed result |
| --- | --- |
| Schedule application | `applied: true` |
| Application reason | `future_unsent_schedule_updated` |
| Active recurring slots after change | One: `slot-mon`, Monday, `18:30` |
| Historical Monday nudge | Unchanged (`sent`, original `09:00`, original timestamps) |
| Historical Monday schedule state | Unchanged, including Message SID and delivery timestamps |
| Future Monday nudge | Remained approved and changed to `18:30` |
| Future Thursday nudge | Changed from approved to `rejected` because its slot was removed and it was unsent |
| Future Thursday schedule state | Changed to `rejected`; no sending history existed |

The regression test is `schedule-change experiment preserves sent history and rejects only stale unsent rows` in `landing/tests/adaptive-schedule.test.js`. The existing worker test `enabled bounded policy applies a model decision to future unsent schedule rows` additionally verifies the enabled worker mode and the `adaptive_policy_applied` audit signal.

## Verification run

The targeted schedule and worker tests passed:

```text
6 tests passed, 0 failed
```

The complete local test suite (`npm test`) then passed:

```text
178 tests passed, 0 failed
```

The simulated Sheets failure messages printed during the full run are intentional failure-path tests; they did not fail the suite.

## Interpretation

The local implementation satisfies the narrow mutation invariant: a schedule change can alter the active recurring plan and future unsent dated rows while preserving sent history. The result supports the thesis claim “implemented and locally verified” for future-unsent-only mutation and audit-gated application.

It does not support any claim about patient adherence, clinical efficacy, real-user preference, WhatsApp delivery, deployed configuration, or production readiness. In particular, a direct schedule-writer test does not itself prove that the live worker ran or that a live audit export occurred. The worker's audit path is locally covered; live automatic schedule adaptation remains unverified.

## Reproduction

From `landing/`, run the targeted tests:

```bash
node --test --test-concurrency=1 tests/adaptive-schedule.test.js tests/frequency-worker.test.js
```

For the full local suite, run the bundled Node runtime against the sorted `tests/*.test.js` files with `--test-concurrency=1`. Serial execution is used because the Sheets fixture is intentionally process-global within a test process.
