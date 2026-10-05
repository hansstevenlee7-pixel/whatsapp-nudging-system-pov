# Audit-write recovery test: iteration 1, outbox repair (5 October 2026)

- **Protocol:** the same as the first run (`scripts/audit-recovery/PROTOCOL.md`, SHA-256 `bb9704f4…`). Scenarios, properties and pass criteria are unchanged.
- **First run:** kept unchanged in `../audit_write_recovery_2026-10-05/`.
- **Records:**
  - `manifest.txt` (source hashes);
  - `repair.patch` (the application change against commit `36de24f`);
  - `iteration_spec.txt` (full output).

Hans approved the repair on 5 October 2026. No deployment, cloud write, WhatsApp send or Gemini call was made.

## Verdicts

| Property | First run | This iteration |
|---|---|---|
| P1 Surfaced | Pass | Pass |
| P2 No unexplained change | Fail | **Pass** |
| P3 Recovered record | Fail | **Pass** |
| P4 One step per week | Fail | **Pass** |
| P5 No compounding during an outage | Pass | Pass |

All 13 checks pass.

## Repair

**Outbox.** When the frequency worker applies a change, it builds the two decision rows first: the model recommendation and the policy decision. Their ids are fixed in advance. Both rows are written to the Sheets `adaptation_decisions` tab inside the same atomic batch that changes the schedule (`saveSchedule`). The schedule therefore cannot change without its record. The rows are then written to the adaptation store as before.

**Recovery first.**
- Before evaluating a behaviour, the worker looks for applied evaluations from the last 14 days that are in the Sheets outbox but missing from the adaptation store. It replays them there with their original ids, and with the patient's adaptation state as it would have been updated.
- Only after a replay does the worker evaluate. The weekly step limit and the duplicate check therefore see the recovered change.
- A replay that fails stops the run before any new change.
- The replay is idempotent: rows already present are left alone, and the state moves only if the policy row was missing.
- The worker reports `recovered_evaluations`.

**Second defect found while repairing.**
- **What was wrong.** Since commit `d30059f` (4 October), the two rows of an evaluation were sent to Supabase in one bulk insert, but only the policy row carried a `decision_id`. PostgREST rejects a bulk insert whose objects have different keys (`PGRST102`, "All object keys must match"). Against real Supabase, every frequency evaluation would therefore have failed its audit write: in shadow mode and, after a schedule change, in apply mode. In apply mode that is exactly this test's failure.
- **Why no test caught it.** The in-memory test store did not enforce this PostgREST rule.
- **Production.** It was not observed there: no active patient has an approved adaptive plan.
- **Fix.** Both rows now always carry an id.
- **Test store.** The test stores in `audit-write-recovery.test.js` and `frequency-worker.test.js` now enforce the rule. Against the previous code, both frequency-worker evaluation tests then fail with `PGRST102`.

## Harness changes since the first run

The properties, scenarios and assertions are unchanged.

- The six TODO markers were removed.
- The test store enforces PostgREST's key rule and implements the replay operation. The replay fails while the store is down, like the first write.
- Each run's diagnostic line also records `recovered_evaluations`.

## Observed

- **S1.** Run 1 changes 2 → 1 and answers 500; the change is already recorded in the Sheets outbox. Run 2 replays it (`recovered_evaluations: 1`) and finds the evaluation already done. The adaptation store then holds one applied decision, 2 → 1, under the id the slots name.
- **S2.** Every run answers 500. Runs 2 and 3 stop at the failed replay and make no further change. The slots name a decision recorded in the Sheets outbox.
- **S3.** Run 1 changes 3 → 2 and answers 500. Run 2 replays the decision, 3 → 2, and stops there. The frequency stays at 2.

## Regression checks (no network)

| Check | Result |
|---|---|
| `npm test` in `landing/` | 269 passed, 0 failed. New: `policy-outbox.test.js`, 5 tests covering key uniformity, the Sheets round trip and replay idempotency |
| `node scripts/adaptation-benchmark/run.js --out <scratch>` (deterministic arms) | Summary table and `per_case.csv` identical to `adaptation_benchmark_2026-10-04_provenance`. Trace completeness identical: 25/25 steps in both arms |
| `node scripts/translation-trace/run.js <scratch>` | Verdicts, link results, summaries and `REPORT.md` identical to `translation_trace_2026-10-04_iteration2` once generated ids are masked. `results.json` differs only in the 422 message text, from the intake fix in commit `36de24f`, and in generated decision ids, because each evaluation now draws one more id |

## Scope

- Only the adaptation store fails; Sheets works.
- **A Sheets failure.** If Sheets fails, the schedule batch fails as a whole: no change and no outbox row are written.
- **Not tested:** concurrent workers, and a replay racing a second worker.
- **The double-failure case.** If the first adaptation-store write fails after the state update but before the decision insert, the replay moves the state version once more. The preferred values are the same.

## Deployment

Hans deployed the repair from `landing/` at 04:06 AEDT on 5 October 2026. The deployment is `dpl_2E9RA7uDPTMf23mEULeX3X4PbjW1`, aliased to `whatsapp-nudging-system-pov.vercel.app`. At deploy time `landing/` was clean at commit `d605dd4`.

Checked read-only at 04:07:
- the pages answer 200;
- `/api/patients` without a session answers 401;
- the three internal worker routes without the worker secret answer 403 `invalid_worker_secret`.

Recovery has not been exercised against the deployed stores.
