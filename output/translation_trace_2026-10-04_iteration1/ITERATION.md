# Iteration 1: repairs after translation-trace v1 (4 October 2026)

This iteration uses the same protocol (`translation-trace-v1`, SHA-256 `39fca63e…`), cases and harness as `../translation_trace_2026-10-04/`. That first run is kept unchanged. Only the application and workflow code changed (`repairs.patch`). `results.json` reproduces byte for byte (`545a8045…`).

No WhatsApp send, deployment, cloud write or Gemini call was made. The Workflow A change is in the repository definition only; the live n8n workflow was not updated.

## Repairs

| # | Finding in v1 | Change | Regression test |
|---|---|---|---|
| 1 | A20, A21: a draft naming no prescription was linked to the first one by fallback, a fabricated link. A22: a prescription with no draft was written, so its chain never started | `workflows/workflow_a_intake.json` *Validation Gate*: the fallback applies only when there is exactly one prescription; otherwise the intake is refused. A prescription with no draft refuses the intake | `action-taxonomy.test.js` "intake rejects a draft that names no prescription…" |
| 2 | B1, B3, B4, B6: the first explicit frequency request stepped from the envelope minimum, because nothing initialises `preferred_frequency`. "Fewer" at 3/week was refused; "more" at 2/week changed nothing while the patient was told it would be used | `adaptive-core.js` `insideEnvelope` takes the planned frequency as the base until a preference exists. `adaptive-service.js` supplies it from the approved schedule, using the frequency policy's own `currentFrequency` | `adaptive-core.test.js` "a first frequency request steps from the approved plan…" |
| 3 | B2: "Got it — your request will be used…" was sent after "Thanks, done!" | `adaptive-handlers.js` acknowledges only an applied *explicit* request | `reply-acknowledgement.test.js` |

Against the committed code, the three regression tests fail and the other 33 in their files pass (`regression_tests_before_fix.log`). With the repairs, all 36 pass (`regression_tests_after_fix.log`). The full suite passes 236/236 (`full_suite_after_fix.log`): the 228 earlier tests, 4 harness checks and 4 regression tests.

## Results (REPORT.md)

- **Part A.** 25 of 28 verdicts agree (22 in v1). Refused intakes wrote 0 rows. A20–A22 are now refused. A23–A25 (week-1 date, distinct dates, draft count) are still accepted: these rules are left to the prompt and clinician review, and are reported rather than enforced.
- **Part B.** Chains still close in 6 of 6. Explicit requests now act:

  | Case | Request | Result |
  |---|---|---|
  | B1 | Fewer | 3 → 2 |
  | B3 | Fewer | 2 → 1 |
  | B4 | Fewer | 2 → 1 |
  | B6 | More | 2 → 3 |
  | B5 | Fewer at the floor of one | Held, outside the envelope |

  Each applied change is acknowledged; the ordinary reply (B2) is not.
- **T16 becomes applicable** because schedules now change. It is 3/4 under the benchmark definition, which was written for one-behaviour seeds and requires *every* active slot to name the applied policy decision. In B3 the changed and deactivated nutrition slots both name the decision. The untouched stress-management slot of the same patient does not, correctly. No changed slot lacks its decision.
- **Still absent, and unchanged because they need a schema change** (PROTOCOL.md):
  - T2: translation provenance, 0/7;
  - T6: approving clinician on the schedule, 0/14;
  - T7: the LLM's value after a prescription-level correction, 3/4.

## Benchmark check

`../adaptation_benchmark_2026-10-04_translationfix/` reruns the fixed and rules arms on the repaired code. Every case outcome is identical to `_reservefix`, and trace completeness is 25/25 steps. The benchmark seeds set `preferred_frequency`, so repair 2 does not change them.
