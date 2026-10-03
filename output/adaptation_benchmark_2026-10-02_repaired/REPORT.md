# Bounded adaptation benchmark

Status: **INCOMPLETE**. Local synthetic evaluation; no WhatsApp messages sent.

| Arm | Task success | Supported requests | Unnecessary changes | Constraint violations |
|---|---:|---:|---:|---:|
| fixed | 9/24 | 0/12 | 0/4 | 0 |
| rules | 12/24 | 3/12 | 1/4 | 5 |
| hybrid | 12/22 | 5/12 | 1/2 | 5 |

Hybrid minus rules: 9.09 percentage points on 22 paired cases. Repeat consistency: 0/6 cases succeeded in all three fresh runs.

API attempts: 20; non-200/network failures: 15; invalid JSON payloads: 0; prompt/output/thought tokens: 592/209/1555. The application can silently fall back to rules on provider errors; HTTP success is not evidence of model benefit.

## Interpretation boundaries

The rules and hybrid arms differ only in reply interpretation. Both use the same existing downstream frozen logistic frequency policy and safety logic. Fixed retains initial preferences and skips automatic policy evaluation but shares STOP, consent, approved resources and delivery preparation. This is not a comparison of entirely model-free software against AI.

Cases were authored from requirements by the implementer, not independently adjudicated. Scores describe this deliberately selected suite, not a population. Direct phrases may overlap existing rules; paraphrases are not claimed to be representative or statistically independent. Three repetitions measure observed stability, not population reliability. No significance or equivalence claim follows.

Actual application inbound, interpretation, decision persistence, frequency worker, schedule application and delivery preparation run against local Sheets and minimal PostgREST emulators. Cloud persistence, concurrency, real delivery, and clinical benefit remain untested. History protection excludes legitimate inbound audit fields (interacted_at, last_inbound_message_sid, last_updated). Missing read evidence remains unknown; permitted rotation is not treated as clinical inference.

## Failures

- fixed/frequency-1/run-1: 0:expected_frequency
- hybrid/frequency-1/run-1: 0:sent_nudge_unchanged
- rules/frequency-1/run-1: 0:sent_nudge_unchanged
- fixed/frequency-2/run-1: 0:expected_frequency
- hybrid/frequency-2/run-1: 0:expected_frequency
- hybrid/frequency-2/run-2: 0:expected_frequency
- hybrid/frequency-2/run-3: 0:expected_frequency
- rules/frequency-2/run-1: 0:expected_frequency
- fixed/frequency-3/run-1: 0:expected_frequency
- hybrid/frequency-3/run-1: 0:expected_frequency
- hybrid/frequency-3/run-2: 0:expected_frequency
- rules/frequency-3/run-1: 0:expected_frequency
- fixed/media-1/run-1: 0:expected_format
- fixed/media-2/run-1: 0:expected_format
- hybrid/media-2/run-2: 0:expected_format
- rules/media-2/run-1: 0:expected_format
- fixed/media-3/run-1: 0:expected_format
- hybrid/media-3/run-3: 0:expected_format
- rules/media-3/run-1: 0:expected_format
- hybrid/nochange-negated/run-1: 0:expected_frequency; 0:unrelated_preferences_preserved; 0:sent_nudge_unchanged
- rules/nochange-negated/run-1: 0:expected_frequency; 0:unrelated_preferences_preserved; 0:sent_nudge_unchanged
- fixed/operational-duplicate/run-1: 0:expected_frequency
- hybrid/operational-duplicate/run-1: 0:sent_nudge_unchanged
- rules/operational-duplicate/run-1: 0:sent_nudge_unchanged
- fixed/operational-history/run-1: 0:expected_time
- hybrid/operational-history/run-1: 0:sent_nudge_unchanged
- rules/operational-history/run-1: 0:sent_nudge_unchanged
- fixed/operational-sequence/run-1: 0:expected_format
- fixed/summary-1/run-1: 0:expected_summary
- fixed/summary-2/run-1: 0:expected_summary
- fixed/summary-3/run-1: 0:expected_summary
- hybrid/summary-3/run-1: 0:expected_summary
- hybrid/summary-3/run-2: 0:expected_summary
- hybrid/summary-3/run-3: 0:expected_summary
- rules/summary-3/run-1: 0:expected_summary
- fixed/time-1/run-1: 0:expected_time
- hybrid/time-1/run-1: 0:sent_nudge_unchanged
- rules/time-1/run-1: 0:sent_nudge_unchanged
- fixed/time-2/run-1: 0:expected_time
- hybrid/time-2/run-1: 0:expected_time
- hybrid/time-2/run-2: 0:expected_time
- hybrid/time-2/run-3: 0:expected_time
- rules/time-2/run-1: 0:expected_time
- fixed/time-3/run-1: 0:expected_time
- hybrid/time-3/run-1: 0:expected_time
- hybrid/time-3/run-2: 0:sent_nudge_unchanged
- hybrid/time-3/run-3: 0:expected_time
- rules/time-3/run-1: 0:expected_time

## Research grounding

Hevner et al. (2004), Design Science in Information Systems Research, MIS Quarterly 28(1), 75–105. https://doi.org/10.2307/25148625

Venable, Pries-Heje and Baskerville (2016), FEDS, European Journal of Information Systems 25, 77–89. https://doi.org/10.1057/ejis.2014.36

Nahum-Shani et al. (2018), Just-in-Time Adaptive Interventions in Mobile Health, Annals of Behavioral Medicine 52(6), 446–462. https://doi.org/10.1007/s12160-016-9830-8

Yao et al. (2024), tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains. https://arxiv.org/abs/2406.12045 . Final-state evaluation is the methodological precedent; this is not a tau-bench run or leaderboard-comparable score.
