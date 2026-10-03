# Post-fix iteration of the bounded adaptation benchmark

Date: 2 October 2026. Local synthetic run; no WhatsApp send, deployment, cloud write or Gemini call.

## Why this run exists

The repaired benchmark (`../adaptation_benchmark_2026-10-02_repaired/`) exposed two implementation defects. Both were fixed as one Design Science build–evaluate iteration. The original failures remain unchanged in that directory and are still reported.

| Defect | Location | Fix |
|---|---|---|
| Saving a recurring slot rewrote an already-sent source nudge (`sent` → `approved`, new `reviewed_at`) | `landing/api/_lib/schedule-store.js`, source-backfill loop | Sources for which `historicalNudge(row)` is true are excluded from the backfill write |
| `Do not send more often; keep the current frequency.` matched the "more often" rule and raised frequency | `landing/api/_lib/adaptive-core.js`, `explicitInterpretation` | Frequency phrases count only when no negation (`don't`, `do not`, `not`, `no`, `never`) precedes them in the same clause |

Regression tests: `landing/tests/schedule-api.test.js` ("a sent source nudge is never rewritten…") and `landing/tests/adaptive-core.test.js` ("negated frequency wording…"). Full suite: 217/217 passed.

## Results (first execution of each case)

| Arm | Run | Task success | Supported requests | No-change | Boundary | Operational | Constraint violations | Interpretation exact |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed | pre-fix | 9/24 | 0/12 | 4/4 | 4/4 | 1/4 | 0 | 3/23 |
| Fixed | post-fix | 9/24 | 0/12 | 4/4 | 4/4 | 1/4 | 0 | 3/23 |
| Rules-only | pre-fix | 12/24 | 3/12 | 3/4 | 4/4 | 2/4 | 5 | 15/23 |
| Rules-only | post-fix | 17/24 | 5/12 | 4/4 | 4/4 | 4/4 | 0 | 16/23 |
| Rules + Gemini | pre-fix | 12/22 completed | 5/12 | 1/2 | 4/4 | 2/4 | 5 | — |
| Rules + Gemini | post-fix | not run | — | — | — | — | — | — |

The supported-request gain (3 → 5) comes from the history fix: `time-1` and `frequency-1` were interpreted correctly before, but failed the history check. The no-change gain comes from the negation fix.

## Remaining rules-only failures (negative result, retained)

All seven are paraphrased or indirect wording: `media-2`, `media-3`, `summary-3`, `time-2`, `time-3`, `frequency-2`, `frequency-3`. By wording form, the rules-only interpreter fulfils 4/4 direct, 1/4 paraphrased and 0/4 indirect requests. This is a coverage limit of the deterministic interpreter, not a safety failure. No rule was added to make these cases pass.

## Interpretation boundaries

- **Not independent evidence.** The fixes target failures that this same suite revealed. The post-fix run confirms that the defects are resolved on these cases; it is not an independent test of generalisation. The regression tests add further negation forms that are absent from the suite.
- **Hybrid arm not re-run.** The negation fix changes the hybrid path: "Do not send more often…" no longer takes the deterministic fast path, so it would now call Gemini. The pre-fix hybrid figures therefore describe the pre-fix code only.
- **No tuning.** The prompt, cases, oracle, model, frequency policy and expected outcomes are unchanged. `manifest.json` and `source-snapshot/` freeze the post-fix source.

Reproduce (no network):

```sh
node scripts/adaptation-benchmark/run.js --report-only --out output/adaptation_benchmark_2026-10-02_postfix
```
