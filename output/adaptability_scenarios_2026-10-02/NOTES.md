# Reading the adaptability results

`REPORT.md` and `results.json` are the frozen, generated evidence. Reproduce with `node scripts/adaptability-scenarios/run.js` (results SHA-256 in `results.sha256`, identical on re-run) and `python3 scripts/adaptability-scenarios/plot.py output/adaptability_scenarios_2026-10-02`. These notes interpret the results; they change no number.

## Verification before interpretation

- `landing/tests/adaptability-scenarios.test.js` (8 tests) checks the metric definitions. It also confirms that the simulator reproduces the frozen stationary replay in `scripts/policy-baselines.js` exactly (delivered messages and interactions for `deterministic` and `model_selector`, seed 5128), and that the fixture exposes exactly the logged outcomes to `evaluateAdaptive`.
- Frozen model hash unchanged: `971e347d…aaa2`.
- After the 2 October trace-link change to `frequency-shadow.js` (`policyRows` only), a re-run into a scratch folder reproduced `part_a` and `part_b` byte-for-byte. This folder's manifest still pins the pre-change source snapshot, so re-running into this same folder is refused by design.

## Pre-declared expectations

| Expectation | Outcome |
|---|---|
| H1: model arms respond less to upward than downward targets | **Supported**, and true of the rules arm too. Up-sensitivity is 0.3% (`model_operative`), 2.0% (`model_selector`) and 2.5% (`deterministic`). Down-sensitivity is 62.0%, 81.3% and 40.1%. The asymmetry belongs to the loop (evidence + gates), not only to the model |
| H2: `model_operative` has zero A5 violations and holds under P8 | **Supported**: 0 violations; P8 frequency `222222222222` |
| H3: no implementable arm reaches the oracle | **Supported**: best oracle-gap closure is 0.119 ± 0.047 (`model_operative`) |

## Main findings

1. **The loop is restrained, not responsive.** About 91% specificity against about 6% sensitivity for `model_operative`. The dominant error is holding when a change was warranted (seed 5128: 1,796 such holds vs 7 correct upward moves).
2. **Downward ratchet.** All adaptive arms drift toward one message per week, regardless of the hidden preference (`adaptability_trajectories.png`). In this simulator, under-messaging someone who prefers more depresses their interaction, which the loop reads as evidence for sending less. Under-delivery is therefore self-confirming. Combined with the increase gates, upward shifts are almost never followed: 1.7% of up-shifted profiles that needed to move settled by week 12 under `model_operative`, against 20.4% for down-shifts.
3. **Accuracy is no better than not adapting.** Exact match with the hidden preference is 32–36% for every implementable arm, near the 33% chance level. The mean absolute error is lower for `fixed_2` (0.657) than for any adaptive arm (0.872–1.007). Adaptation in this design does not find each profile's level.
4. **The deployed policy behaves better than the replay model arm** (thesis Tables 5–6 after the 4 October renumbering). `model_operative` vs `model_selector`:
   - interactions per message +0.026, higher in 10/10 seeds;
   - reversals 0.018 vs 0.455 per profile;
   - persona passes 7/8 vs 2/8.

   The replay arm decreases frequency in week 1 with no evidence at all (P8 fails), whereas the deployed `insufficient_evidence` hold and the two-non-interaction rule prevent this. The 94% at-minimum figure in the frozen replay table is therefore partly a property of the simplified replay arm, not of the evaluated artifact.
5. **Against the rules arm, the deployed policy is more efficient but less adaptive.**
   - Interactions per message +0.0079 (9/10 seeds).
   - Specificity +7.9 points (10/10).
   - Reversals −0.112 per profile (10/10).
   - But sensitivity −5.9 points (0/10) and post-shift accuracy −1.0 point (2/10).
6. **Identifiability limit (P6).** A recipient who interacts only at the minimum frequency looks "responsive" at that level. Every adaptive arm then raises frequency, sees silence and lowers it again. Interaction-rate evidence cannot distinguish "responds because messages are rare" from "is responsive".
7. **P1 ceiling.** A persona that interacts with every message is never raised to three per week by either model arm (`model_operative` holds at 2). The model never uses the top of the envelope.

## Cautions

- **Oracle A1/A2 are labelling artefacts.** The oracle moves at week 7, before any post-shift evidence exists, so it is counted as an unnecessary change, and it never has a change-needed decision. Treat it only as the A6/E reference.
- **Settling medians come from few profiles.** For example, `model_selector` up-shift medians exist in only 6 of 10 seeds. Report the settled share; give medians only with their counts.
- **The cooldown is not exercised.** The 7-day cooldown is not separately tested under weekly decisions; the protocol states this simplification.
- **Assumptions only.** The response function and shift design are invented. No adherence, behaviour, clinical or real-user claim follows.
