# Adaptability scenario suite (adaptability-scenarios-v1)

Local deterministic simulation; frozen model; no network, deployment or WhatsApp send. Protocol: `scripts/adaptability-scenarios/PROTOCOL.md`. Configuration SHA-256 `1c4dc5d95466757c09b1964433c14237f3c32ff5039310c9706d5fd0e667de5b`.

**Hard criterion A5 (implementable arms, Parts A and B):** 0 violations — met.

## Part A: population drift (300 profiles x 12 weeks x 10 seeds; half shift preference after week 6)

Mean ± SD across seeds. `oracle` reads hidden state and is a reference bound only.

| Measure | fixed_2 | deterministic | model_selector | model_operative | oracle |
|---|---:|---:|---:|---:|---:|
| **A1 Responsiveness** | | | | | |
| Sensitivity, all | 0.0% ± 0.0 | 11.5% ± 0.9 | 4.3% ± 0.4 | 5.6% ± 0.7 | — |
| Sensitivity, target above current | 0.0% ± 0.0 | 2.5% ± 0.3 | 2.0% ± 0.3 | 0.3% ± 0.1 | — |
| Sensitivity, target below current | 0.0% ± 0.0 | 40.1% ± 1.2 | 81.3% ± 5.1 | 62.0% ± 4.5 | — |
| **A2 Restraint** | | | | | |
| Specificity | 100.0% ± 0.0 | 83.3% ± 0.9 | 92.1% ± 0.7 | 91.2% ± 0.6 | 95.4% ± 0.2 |
| Unnecessary-change rate | 0.0% ± 0.0 | 16.7% ± 0.9 | 7.9% ± 0.7 | 8.8% ± 0.6 | 4.6% ± 0.2 |
| **A3 Settling (profiles needing to move)** | | | | | |
| Up-shift settled by week 12 | 0.0% ± 0.0 | 7.5% ± 1.8 | 1.0% ± 1.0 | 1.7% ± 1.4 | — |
| Up-shift median decisions to settle | — | 3.35 ± 1.27 | 4.75 ± 0.42 | 3.63 ± 1.43 | — |
| Down-shift settled by week 12 | 0.0% ± 0.0 | 28.6% ± 4.5 | 4.8% ± 4.4 | 20.4% ± 4.4 | — |
| Down-shift median decisions to settle | — | 2.25 ± 0.42 | 2.00 ± 1.41 | 2.00 ± 0.88 | — |
| **A4 Stability** | | | | | |
| Changes per profile | 0.00 ± 0.00 | 1.85 ± 0.07 | 1.65 ± 0.06 | 1.09 ± 0.03 | 1.17 ± 0.02 |
| Reversals per profile | 0.000 ± 0.000 | 0.130 ± 0.017 | 0.455 ± 0.048 | 0.018 ± 0.006 | 0.000 ± 0.000 |
| **A5 Boundedness** | | | | | |
| Defined violations | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.0 ± 0.0 | 174.6 ± 12.9 |
| Silence increases | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.0 ± 0.0 | 0.0 ± 0.0 | 125.3 ± 11.0 |
| **A6 Accuracy** | | | | | |
| Exact match, all weeks | 34.3% ± 1.8 | 35.8% ± 1.5 | 32.1% ± 1.8 | 36.3% ± 1.7 | 100.0% ± 0.0 |
| Exact match, weeks 1-6 | 33.7% ± 2.0 | 38.4% ± 2.4 | 32.6% ± 3.5 | 39.7% ± 3.3 | 100.0% ± 0.0 |
| Exact match, weeks 7-12 stable | 34.7% ± 3.4 | 33.6% ± 3.6 | 30.8% ± 3.4 | 34.1% ± 3.5 | 100.0% ± 0.0 |
| Exact match, weeks 7-12 shifted | 34.9% ± 3.7 | 32.6% ± 3.1 | 32.0% ± 4.0 | 31.6% ± 3.9 | 100.0% ± 0.0 |
| Mean absolute error | 0.657 ± 0.018 | 0.872 ± 0.029 | 1.007 ± 0.039 | 0.915 ± 0.034 | 0.000 ± 0.000 |
| Oracle-gap closure (interactions/message) | 0.000 ± 0.000 | 0.068 ± 0.033 | -0.048 ± 0.072 | 0.119 ± 0.047 | 1.000 ± 0.000 |
| **E Efficiency (simulation only)** | | | | | |
| Interactions per message | 0.2408 ± 0.0130 | 0.2516 ± 0.0124 | 0.2332 ± 0.0153 | 0.2595 ± 0.0126 | 0.3991 ± 0.0177 |
| Delivered messages | 7200 ± 0 | 5247 ± 63 | 3749 ± 12 | 4319 ± 29 | 7238 ± 151 |
| Ordinary interactions | 1734 ± 93 | 1321 ± 80 | 874 ± 60 | 1121 ± 60 | 2889 ± 142 |

### Paired per-seed contrasts

| Contrast | Measure | Mean ± SD | Higher in |
|---|---|---:|---:|
| model_operative_minus_deterministic | interactions_per_message | 0.0079 ± 0.0063 | 9/10 |
| model_operative_minus_deterministic | sensitivity | -0.0585 ± 0.0052 | 0/10 |
| model_operative_minus_deterministic | sensitivity_up | -0.0215 ± 0.0024 | 0/10 |
| model_operative_minus_deterministic | specificity | 0.0791 ± 0.0118 | 10/10 |
| model_operative_minus_deterministic | exact_match_post_shifted | -0.0098 ± 0.0187 | 2/10 |
| model_operative_minus_deterministic | reversals_per_profile | -0.1117 ± 0.0157 | 0/10 |
| model_selector_minus_deterministic | interactions_per_message | -0.0184 ± 0.0088 | 1/10 |
| model_selector_minus_deterministic | sensitivity | -0.0722 ± 0.0051 | 0/10 |
| model_selector_minus_deterministic | sensitivity_up | -0.0052 ± 0.0025 | 0/10 |
| model_selector_minus_deterministic | specificity | 0.0879 ± 0.0113 | 10/10 |
| model_selector_minus_deterministic | exact_match_post_shifted | -0.0053 ± 0.0176 | 3/10 |
| model_selector_minus_deterministic | reversals_per_profile | 0.3247 ± 0.0356 | 10/10 |
| model_operative_minus_model_selector | interactions_per_message | 0.0263 ± 0.0091 | 10/10 |
| model_operative_minus_model_selector | sensitivity | 0.0137 ± 0.0053 | 10/10 |
| model_operative_minus_model_selector | sensitivity_up | -0.0163 ± 0.0033 | 0/10 |
| model_operative_minus_model_selector | specificity | -0.0088 ± 0.0092 | 2/10 |
| model_operative_minus_model_selector | exact_match_post_shifted | -0.0045 ± 0.0139 | 2/10 |
| model_operative_minus_model_selector | reversals_per_profile | -0.4363 ± 0.0468 | 0/10 |

## Part B: scripted personas (deterministic)

Weekly frequencies for weeks 1-12 are shown in backticks.

| Persona | Pre-declared pass rule | fixed_2 | deterministic | model_selector | model_operative |
|---|---|---|---|---|---|
| P1 always-responds | never decreases | PASS `222222222222` | PASS `233333333333` | FAIL `122222222222` | PASS `222222222222` |
| P2 never-responds | frequency 1 in week 12 and never increases | FAIL `222222222222` | PASS `221111111111` | PASS `111111111111` | PASS `211111111111` |
| P3 responsive-then-silent | no decrease decided in weeks 1-7 and frequency 1 in week 12 | FAIL `222222222222` | PASS `233333321111` | FAIL `122222211111` | PASS `222222211111` |
| P4 silent-then-responsive | no increase decided in weeks 1-7 and at least one increase decided in weeks 8-12 | FAIL `222222222222` | PASS `221111111233` | PASS `111111111122` | PASS `211111111122` |
| P5 alternating | at most one direction reversal and no increase after a silent last-4 window | PASS `222222222222` | PASS `222222222222` | FAIL `121111111111` | PASS `222222222222` |
| P6 prefers-minimum | frequency 1 in week 12 and at most one direction reversal | FAIL `222222222222` | FAIL `221112211122` | FAIL `121111211112` | FAIL `211112111121` |
| P7 avoids-minimum | frequency never 1 | PASS `222222222222` | PASS `233333333333` | FAIL `111111111111` | PASS `222222222222` |
| P8 delivery-failure | frequency stays 2 in every week | PASS `222222222222` | PASS `222222222222` | FAIL `111111111111` | PASS `222222222222` |

## Boundaries

The response function, hidden preferences and shift design are declared simulation assumptions, not estimates of real behaviour. `model_operative` runs the deployed `evaluateAdaptive` policy on synthetic fixtures; the 7-day cooldown is not separately exercised because decisions are weekly. Decision labels use the hidden preference behind the latest evidence. No adherence, behaviour-change, clinical or real-user claim follows. No significance test is claimed.
