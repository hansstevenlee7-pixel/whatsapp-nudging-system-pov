# Audit-write recovery test: first run (5 October 2026)

- **Protocol:** `scripts/audit-recovery/PROTOCOL.md`, SHA-256 `bb9704f4…`, hashed at 2026-10-04T15:39:23Z, before the test file was written or run.
- **Run:** 2026-10-04T15:40:22Z.
- **Test:** `landing/tests/audit-write-recovery.test.js`, SHA-256 `8e8c60f4…`.
- **Code:** application code at commit `36de24f`, unchanged.
- **Records:** `manifest.txt` and the full output, `first_run_spec.txt`. The output prints each run's observations as a JSON diagnostic line.

## Verdicts

| Property | S1 transient | S2 persistent | S3 step limit | Verdict |
|---|---|---|---|---|
| P1 Surfaced | holds | holds | holds | **Pass** |
| P2 No unexplained change | fails | fails | fails | **Fail** |
| P3 Recovered record | fails | n/a | fails | **Fail** |
| P4 One step per week | n/a | n/a | fails | **Fail** |
| P5 No compounding during an outage | n/a | holds | n/a | **Pass** |

Every verdict matches the prediction written in the protocol before the run.

## What happened

**S1 (2 per week; audit store down for run 1 only).**
- Run 1 changed the schedule from 2 to 1 per week, stamped the changed slots with decision `692dc0fb…`, and then answered 500 when the audit write failed.
- Run 2 re-evaluated the reduced schedule. It recorded "adaptive_policy_no_change 1→1" and reported `complete`.
- Run 3 found that evaluation already recorded and stayed idle.
- After all three runs, the schedule still names `692dc0fb…`, a decision that exists in no store. The change from 2 to 1 is recorded nowhere.

**S2 (audit store down for all three runs).** Every run answered 500. Runs 2 and 3 made no further change, because at 1 per week the envelope minimum stops another decrease. The unrecorded change from run 1 stayed in place throughout.

**S3 (3 per week; audit store down for run 1 only).**
- Run 1 changed the schedule from 3 to 2 per week and answered 500.
- One day later, run 2 took a second decrease, from 2 to 1, and recorded it as "adaptive_policy_applied 2→1".
- The weekly one-step limit missed the first change because it reads only persisted decisions. The patient's frequency fell by two steps within a day, and the record shows one step from 2.

## Interpretation

- **Surfacing works.** A failed audit write is reported as a failure, not as success.
- **Recovery does not.** Once the audit write fails after a schedule change:
  - the change stays applied with no record;
  - the slot's link names a decision that does not exist;
  - a retry cannot reconstruct the change, because it re-evaluates against the already-changed schedule.
- **Safety and traceability.** Because the weekly step limit reads only the audit record, a lost record also weakens that rule. The envelope still held: the frequency never left 1 to 3 per week. RQ1 traceability and the step-limit rule did not survive this failure.

**Control.** With the audit store working, `landing/tests/frequency-worker.test.js` ("enabled bounded policy applies a model decision…") shows the same change recorded once, with every changed slot naming the persisted decision.

**Scope.**
- Only the adaptation store fails; Sheets works.
- The harness uses in-memory stand-ins for both stores.
- Concurrent workers and a Sheets failure during the same run are not tested.

## After this run

The six failing checks were marked TODO, and the test file then changed; this folder keeps the first run's output and hashes. The repair and its re-run under the same protocol are in `../audit_write_recovery_2026-10-05_outbox/`.
