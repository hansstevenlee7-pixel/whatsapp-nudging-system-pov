# Taxonomy-grounded synthetic frequency experiment (v2)

**Status:** LR, contextual Thompson sampling and random reference complete across ten seeds. Gemini complete across ten seeds.

Frequency is the model-selected action. The clinician-owned action, pillar, category, nudge type and tone annotate each planned message; the policy can send the first one, two or three approved slots without editing their content.

## Local policy results

| Policy | Seeds | Mean interactions/message | Mean messages/seed | Mean interactions/seed | Frequency violations |
|---|---:|---:|---:|---:|---:|
| greedy_logistic | 10 | 20.53% | 158.5 | 33.0 | 0 |
| contextual_thompson | 10 | 21.13% | 164.9 | 35.5 | 0 |
| eligible_random | 10 | 18.54% | 199.2 | 37.2 | 0 |
| Gemini | 10 | 17.83% | 235.3 | 42.2 | 0 |

Bandit minus greedy LR: 0.60 percentage points; 95% paired seed-bootstrap interval [0.03 percentage points, 1.22 percentage points]; higher in 6/10 seeds. This small interval is conditional on the stipulated simulator and random seeds, not clinical effectiveness.

Random minus greedy LR: -1.99 percentage points; interval [-3.82 percentage points, 0.00 percentage points]. The random policy sent more messages and produced more total interactions, so interaction efficiency alone does not define a universal winner.

Gemini minus greedy LR: -2.69 percentage points; 95% paired seed-bootstrap interval [-4.09 percentage points, -1.13 percentage points]. This comparison uses a compressed LLM training summary and is conditional on the simulator.

## Does taxonomy context help predict?

The ablation compares the same model and data with all taxonomy features versus the original seven frequency/history features. Lower Brier and higher PR-AUC are better.

| Split | Full Brier | Frequency-only Brier | Full PR-AUC | Frequency-only PR-AUC | Seeds improved (Brier / PR-AUC) |
|---|---:|---:|---:|---:|---:|
| validation | 0.1297 | 0.1327 | 0.4042 | 0.3681 | 9/10 / 8/10 |
| test | 0.1314 | 0.1317 | 0.3449 | 0.3452 | 5/10 / 4/10 |

The taxonomy features help on validation but are mixed on the held-out test split. Their benefit has not been established. The taxonomy still makes message context and safety decisions explicit and inspectable.

## Evidence boundaries

This is a separate generator and version from the original frozen table. Values across the two simulators should not be compared as if they came from the same population. The synthetic action examples and response effects are declared assumptions, not clinical evidence. Hidden affinities never enter policy inputs. Weekly frequency is the sole selected action. The app's clinical application gates, STOP handling, delivery and user outcomes were not tested here.

The LLM uses a compressed contingency summary of the logged rows; LR and bandit use the full feature table. The three methods share the simulator, action envelope and observable current context, but do not have identical statistical input resolution. LLM results require their own limitation statement when complete.

## Artifacts

`manifest.json` fixes source and dataset hashes. `results.json` holds every local seed; `taxonomy_ablation.json` holds predictive diagnostics; `decisions.jsonl` and `feedback.jsonl` hold replay evidence; `gemini/` holds the separately checkpointed LLM arm. The original experiment is preserved in `output/frequency_comparison_2026-09-30/`.
