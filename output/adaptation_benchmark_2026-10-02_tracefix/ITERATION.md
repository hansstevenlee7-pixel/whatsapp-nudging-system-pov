# Trace-link iteration (2 October 2026)

Local synthetic run of the fixed and rules arms; no WhatsApp send, deployment, cloud write or Gemini call. The earlier runs are retained unchanged (`../adaptation_benchmark_2026-10-02_repaired/` and `../adaptation_benchmark_2026-10-02_postfix/`).

## Why

The post-fix trace check (`../adaptation_benchmark_2026-10-02_postfix/TRACE_COMPLETENESS.md`) showed that changed recurring schedule slots did not name the decision that changed them: 0/4 schedule-changing cases. The link was recoverable only by behaviour key and time.

## Change

| File | Change |
|---|---|
| `landing/api/_lib/adaptive-handlers.js` | The frequency worker assigns the policy decision's UUID before the schedule write |
| `landing/api/_lib/schedule-store.js` | `applyAdaptiveSchedule` passes that ID internally to `saveSchedule`, which stamps `adaptation_decision_id` on every slot of the behaviour it changed or deactivated. A later save keeps a slot's link while its day and time are unchanged, and clears it otherwise. The link is never read from the HTTP body |
| `landing/api/_lib/frequency-shadow.js` | `policyRows` stores the policy row under that ID |
| `scripts/adaptation-benchmark/local-store.js` | The emulator now keeps a caller-supplied `decision_id`, as PostgreSQL does, and defaults only when it is absent |

No schema or migration change was needed: `adaptation_decision_id` was already a `weekly_schedule` column and a verified write field.

Regression tests are in `landing/tests/adaptive-schedule.test.js` (stamping, preservation, spoof rejection, clearing on clinician change) and `landing/tests/frequency-worker.test.js` (the worker's applied decision ID matches the changed slots). 226/226 tests pass.

## Results

- Task outcomes are identical to the post-fix run case by case: fixed 9/24, rules 17/24, 0 violations.
- Trace completeness (rules arm): 25/25 steps have every applicable link. Schedule change → persisted applied policy decision is now 4/4 (previously 0/4).
- The trace check was tightened at the same time: a stamped ID counts only if it names a persisted `adaptive_policy_applied` row. The earlier run still scores 0/4 under the stricter check.

This confirms the repair on the cases that revealed the gap; it is not an independent generalisation test. Cloud persistence and concurrency remain untested.
