# Adaptation benchmark evidence package

Implementation is complete. All fixed and rules-only cases ran. The Gemini-dependent comparison remains INCOMPLETE because the existing project's daily free-tier quota was exhausted. Do not present the hybrid fraction as a final superiority result.

## Current evidence

- Fixed schedule: 9/24 tasks pass; 0/12 supported requests fulfilled.
- Rules interpreter: 12/24 tasks pass; 3/12 supported requests fulfilled.
- Hybrid interpreter: 12/22 completed first-run tasks pass; 5/12 supported requests fulfilled. Provider failures confound these outcomes and two no-change cases remain unexecuted.
- The repaired run made 20 external attempts: five valid HTTP 200 responses and fifteen provider failures. Four earlier diagnostic attempts bring this study to 24 attempts, below the authorised cap of 60.
- Three-run repetition sets completed for six fallback cases, and one started case has only two runs. Two further model-dependent cases have no first run. None of the six completed sets passed all three operational executions; provider errors prevent interpreting this as model-answer instability.
- All 215 regression tests passed. Benchmark failures are separate from regression-test failures.

## Read and demonstrate

Open `Adaptation_Benchmark_Research_Report.docx` for the editable report and `demo.html` for the local demonstration. The demo requires no API calls or external resources. `before_after.png` shows an actual timing change whose task still fails because sent history changes. `DEMONSTRATION.md` provides the five-minute sequence.

`REPORT.md` and `results.json` are raw automated summaries. Their paired difference is calculated only over completed pairs and is provisional; it is not a complete 24-case comparison. `presentation_metrics.json` separates provider-affected executions. Full provenance is in `manifest.json`, `cases.json`, `source-snapshot/`, `traces/`, and `api-attempts.jsonl`.

## Confirmed negative findings

1. Gemini integration originally returned HTTP 400 because nullable type arrays were sent in the wrong schema representation. The five nullable fields were repaired without changing the prompt/rules. Original diagnostic runs remain in the sibling unsuffixed and `_network` directories; no scores are pooled.
2. When a recurring slot references a previously sent source nudge, schedule application sets that historical source status from `sent` to `approved` and adds `reviewed_at`. The requested schedule can be correct while task success fails the history requirement. This remains unfixed in the evaluated application.
3. `Do not send more often; keep the current frequency.` matches the deterministic “more often” rule. The hybrid fast path accepts the same rule and does not call Gemini. Both adaptive arms make an unnecessary frequency change. This remains unfixed in the evaluated application.
4. The provider returned service unavailability and then daily quota exhaustion; the real classifier silently falls back to deterministic interpretation. These are operational failures, not evidence that a valid model interpretation was wrong.

## Reproduction

From the System POV repository, regenerate reports without network:

```sh
node scripts/adaptation-benchmark/run.js --report-only --out output/adaptation_benchmark_2026-10-02_repaired
```

After provider quota becomes available, resume the unexecuted cases and missing repetition without overwriting previous failures:

```sh
node scripts/adaptation-benchmark/run.js --live --out output/adaptation_benchmark_2026-10-02_repaired
```

Existing quota-affected outcomes are retained. A clean model-quality replication must be separately labelled with a new output directory, not overwrite them. Source changes require a new directory. The remaining study allowance is 36 external attempts; account for prior attempts before a new independent run. No automatic retry, paid fallback or model substitution is authorised by this package.

The local completion helper verifies frozen source hashes and runs only cases that cannot call Gemini:

```sh
node scripts/finish-adaptation-benchmark-local.js output/adaptation_benchmark_2026-10-02_repaired
```

The editable report/diagram/demo builder uses the bundled Python runtime:

```sh
/Users/stevenleehans/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/render-adaptation-benchmark.py output/adaptation_benchmark_2026-10-02_repaired
```

No deployment, production schedule write, or WhatsApp send occurred. Results describe a deliberately selected synthetic suite using local storage emulation. The rules/hybrid comparison isolates interpretation with a shared downstream logistic frequency policy.
