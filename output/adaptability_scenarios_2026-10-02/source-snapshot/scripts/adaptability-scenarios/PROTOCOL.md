# Adaptability scenario suite: frozen protocol (v1)

Written 2 October 2026, before any run. `run.js` copies this file's SHA-256 into the output manifest. Any change to this protocol after results exist requires a new version number and a new output directory. A run against a changed protocol must not overwrite earlier results.

## Purpose

RQ2 asks how the adaptive component changes later delivery within clinician limits, and how this compares with fixed and rule-based policies. Earlier replays (Tables 3–4) measured efficiency under a **stationary** simulator. They did not test the proposal §4.6 scenarios of "changing interaction patterns" and "time or decision steps needed to respond to a scenario change". This suite operationalises **adaptability**:

> the capacity of the closed loop to change subsequent delivery in the direction that the interaction evidence warrants, within the clinician-approved envelope, in a timely, stable and traceable way.

Adaptability is a property of the whole loop (rules + model + safety policy), not of the model alone. Holding steady can be the correct response. No measure here concerns adherence, behaviour change or health.

## Artifact under test (read-only)

- Frozen model `landing/api/_models/frequency-logistic-v1.json` (SHA-256 `971e347d…aaa2`). No retraining.
- Selection rule `recommendFrequency` (`landing/api/_lib/frequency-model.js`).
- Deployed frequency policy `evaluateAdaptive` (`landing/api/_lib/frequency-shadow.js`).

## Arms

| Arm | Definition | Role |
|---|---|---|
| `fixed_2` | Two messages per week throughout | Non-adaptive reference |
| `deterministic` | `selectFrequency("deterministic")` from `scripts/policy-baselines.js`: decrease after a non-interaction streak ≥ 3; increase when there was a recent interaction and the rate is ≥ 0.75 | Rule-based comparator (Tables 3–4) |
| `model_selector` | `selectFrequency("model_plus_safety")`: frozen model + lowest-near-best rule + ±1 clamp + increase requires ≥ 1 recent interaction | Same arm as Tables 3–4 |
| `model_operative` | `evaluateAdaptive` called on a synthetic patient/event fixture built from the closed outcome log, in apply semantics. Adds the operative gates: increase requires ≥ 2 positives in the last 4 closed windows; decrease held until ≥ 2 consecutive closed non-interactions; no closed window → `insufficient_evidence` → hold | The evaluated artifact |
| `oracle` | Hidden preferred frequency of the current week, ignoring constraints | Reference bound only; never implementable. Part A only |

All arms start at 2 per week, with an envelope of 1–3 per week. A decision is made at the start of every week 1–12 from the closed outcomes so far, matching `policy-baselines.js`.

**Cooldown.** The 7-day cooldown on applied changes is not separately exercised (`adaptive.decisions = []`). Weekly decision points already allow at most one change per 7 days. This simplification is reported.

**Fixture timing.** Message *m* of week *w* is delivered on day `7(w−1) + 2m − 1` at 09:00 UTC. Every window therefore closes before the next week's decision at day `7w` 00:00 UTC. Positive outcomes are recorded as a `link_visit` two hours after delivery. Failed deliveries carry no `delivered_at`.

## Part A: population drift

- **Cohorts.** `cohort(300, seed)` from `scripts/generate-frequency-dataset.js`. Seeds: 5128, 1, 2, …, 9 (the same ten as the Table 4 stability check).
- **Shift.** A profile is shifted iff `stableUniform(seed, id, 0, 0, "adaptability-shift-select") < 0.5`. Its post-shift preference is one of the other two frequencies:
  - the lower one if `stableUniform(seed, id, 0, 1, "adaptability-shift-value") < 0.5`;
  - otherwise the higher one.
- **Timing.** Weeks 1–6 use the original preference; weeks 7–12 use the post-shift preference. Unshifted profiles are the stationary control.
- **Outcomes.** A message interacts iff `stableUniform(seed, id, week, m, "adaptability-drift") < probability(profile with that week's preference, current frequency, live history)`, using the unchanged generator's probability. Random numbers are matched across arms. All deliveries succeed.

## Part B: scripted personas (deterministic, no randomness)

Arms: `fixed_2`, `deterministic`, `model_selector`, `model_operative`. The pass rule for each persona was fixed before the run.

| ID | Outcome script | Expected behaviour (pass rule) |
|---|---|---|
| P1 always-responds | Every delivery interacts | Never decreases |
| P2 never-responds | No delivery interacts | Frequency is 1 in week 12, and it never increases |
| P3 responsive→silent | Interacts in weeks 1–6, never in weeks 7–12 | No decrease decided in weeks 1–7, and frequency is 1 in week 12 |
| P4 silent→responsive | Never in weeks 1–6, always in weeks 7–12 | No increase decided in weeks 1–7, and at least one increase decided in weeks 8–12 |
| P5 alternating | Interacts on odd-numbered deliveries only | At most one direction reversal, and no increase after a silent last-4 window |
| P6 prefers-minimum | Interacts iff the current frequency is 1 | Frequency is 1 in week 12, with at most one direction reversal |
| P7 avoids-minimum | Interacts iff the current frequency is ≥ 2 | Frequency is never 1 |
| P8 delivery-failure | Every delivery fails (no closed window) | Frequency stays 2 in every week; failure is not preference evidence |

`fixed_2` is expected to fail every persona whose rule requires a change. It is a reference, not a candidate.

## Measures

**Decision labels (Part A).** A decision at the start of week *t* ≥ 2 is labelled with the target `pref(t−1)`: the preference that generated the most recent evidence. Week 1 has no evidence and is excluded.

| # | Property | Measure |
|---|---|---|
| A1 | Responsiveness | Sensitivity = moves one step toward the target ÷ decisions where current ≠ target |
| A2 | Restraint | Specificity = holds ÷ decisions where current = target. Its complement is the unnecessary-change rate |
| A3 | Settling time | Shifted profiles only. `settle_week` = the first week *t* in 7–12 with frequency = post-shift preference in every week *t*…12. Settling decisions = `settle_week − 7`. Reported as the share settled by week 12 and the median among those settled. Split by shift direction, for all shifted profiles and for the subset not already at the new target in week 7 ("needed to move") |
| A4 | Stability | Frequency changes per profile, and direction reversals per profile (the `policy-baselines.js` definition: a non-hold direction opposite to the previous week's non-hold direction; a hold week resets the comparison) |
| A5 | Boundedness | Per decision: frequency outside 1–3; a step larger than 1; an increase when none of the last 4 closed windows interacted (**silence-increase**); and, for the operative policy definition, an increase with fewer than 2 positives in the last 4. Hard criterion: 0 for `deterministic`, `model_selector` and `model_operative`. The model arms are checked against their own gate definitions |
| A6 | Accuracy | Exact-match rate and mean absolute error of the frequency vs that week's hidden preference. Split by period (weeks 1–6 vs 7–12) and by shifted vs stable profiles. Oracle-gap closure on interactions per message = (arm − fixed_2) ÷ (oracle − fixed_2) |
| E | Efficiency (simulation only) | Delivered messages, ordinary interactions, interactions per message, messages per interaction |

**Statistics.** Mean ± SD across the ten seeds. Paired per-seed contrasts (`model_operative − deterministic`, `model_selector − deterministic`) are reported with wins out of 10. No significance test is claimed.

## Pre-declared expectations

These are predictions, not success criteria.

- **H1.** Both model arms will show lower A1 for upward targets than for downward targets. Reasons: the pooled negative candidate-frequency coefficient and the asymmetric increase gates.
- **H2.** `model_operative` will record zero A5 violations, and will hold under P8.
- **H3.** No implementable arm will reach the oracle's A6 accuracy or interaction efficiency.

## Completion and claim boundary

Research completion requires all arms, seeds and personas to run, with every result reported, including failures. A negative result is a valid outcome and must not be tuned away. No arm, rule, threshold or label may change after results are seen.

The simulator's response function, its hidden preferences and the shift design are invented assumptions. Results describe technical adaptation behaviour under those assumptions. They do not describe real recipients, adherence or clinical benefit. `oracle` reads hidden state and is never a candidate policy.
