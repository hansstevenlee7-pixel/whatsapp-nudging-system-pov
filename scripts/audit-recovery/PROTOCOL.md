# Audit-write recovery test: protocol

Written on 5 October 2026, before the test was run. The run records this file's SHA-256 (`PROTOCOL.sha256`).

## Question

Part 2 §5.2 marks this as unverified: "a schedule write that succeeds followed by a failed audit write needs an explicit recovery test." When that happens, does the system recover so that every schedule change can still be explained, and no rule is broken on the retry?

## The boundary under test

There is one place where a schedule change and its audit record go to different stores in sequence: the frequency worker in apply mode (`landing/api/_lib/adaptive-handlers.js`, `frequencyWorker`).

1. `applyAdaptiveSchedule` writes the changed future schedule to Google Sheets in one batch. Every slot it changes or removes is stamped with a new policy decision id.
2. `savePolicyEvaluation` then writes the model recommendation and the policy decision under that id to the adaptation store (Supabase), together with the patient's adaptation state.

The reply path writes only a decision. Delivery preparation writes its reservation and decision in one Sheets batch. Neither crosses this boundary.

## Set-up

- **Harness.** The existing in-memory Sheets fixture and adaptation-store test adapter, as in `landing/tests/frequency-worker.test.js`. There is no network.
- **Fault.** Only the adaptation store fails: `savePolicyEvaluation` throws "audit store unavailable". The Sheets writes work throughout.
- **Patient.** One synthetic patient with one behaviour (`physical_activity/increase`, "Walk for 20 minutes").
  - The envelope is approved with automatic apply, frequency 1 to 3 per week, at 09:00.
  - `ADAPTIVE_SCHEDULE_APPLY_ENABLED=true`.
  - Two past deliveries are closed with no interaction, so the policy supports one decrease.
- **Runs.** Each scenario calls the worker several times. No new delivery closes between runs, so the evidence is the same in every run.

## Scenarios

| Id | Start | Audit store | Runs |
|---|---|---|---|
| S1 Transient | 2 per week (Mon, Thu) | Fails in run 1, works from run 2 | 3 runs: 2026-08-27 00:00Z, +1 h, +2 h |
| S2 Persistent | 2 per week (Mon, Thu) | Fails in runs 1 to 3 | 3 runs: 2026-08-27 00:00Z, +1 h, +2 h |
| S3 Step limit | 3 per week (Mon, Wed, Fri) | Fails in run 1, works from run 2 | 2 runs: 2026-08-27 00:00Z, +1 day |

## Properties (pass criteria, fixed now)

- **P1 Surfaced.** A run whose audit write fails does not answer 2xx and does not report `status: "complete"`.
- **P2 No unexplained change.** At the end of every run, each non-empty `adaptation_decision_id` on the behaviour's schedule rows, active or inactive, names a persisted decision. "Persisted" means a row with that `decision_id` exists in the adaptation store or in the Sheets `adaptation_decisions` tab.
- **P3 Recovered record.** After the first run whose audit write succeeds (S1, S3), the adaptation store holds exactly one applied policy decision (`adaptive_policy_applied`) for the change. Its `frequency_before` and `frequency_after` equal the active-slot counts before run 1 and after the last run. The adaptation store is the record the policy itself reads for its weekly step limit and duplicate check.
- **P4 One step per week (S3).** Within the 7 days the runs span, the active-slot count changes by at most one step: 3 → 2, never 3 → 2 → 1.
- **P5 No compounding during an outage (S2).** Runs 2 and 3 leave the active schedule as run 1 left it.

A property passes only if it holds in every scenario it applies to.

## Predictions, from reading the code before running

- P1 holds: the audit failure propagates and the worker answers 500.
- P2 fails: run 1 stamps the slots with a decision id that is never persisted, and nothing later writes it.
- P3 fails in S1: run 2 re-evaluates against the already-reduced schedule (1 per week) and records "no change 1 → 1". The actual change 2 → 1 is never recorded.
- P4 fails in S3: the weekly step limit reads only persisted decisions, so run 2 takes a second decrease, 2 → 1, in the same week.
- P5 holds in S2: at 1 per week, the envelope minimum stops a further decrease.

## Records

- The test is `landing/tests/audit-write-recovery.test.js`. Each property is a separate subtest, so the run shows each verdict.
- The first run's output, the protocol hash, the test-file hash and the Git commit go to `output/audit_write_recovery_2026-10-05/`.
- That first run is kept unchanged. Any repair is a labelled iteration in a new folder, run against the same unchanged properties.
