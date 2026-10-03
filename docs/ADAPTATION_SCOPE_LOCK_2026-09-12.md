# Adaptation Scope Lock

**Locked:** 12 September 2026 · **Submission:** 23 October 2026 · **Verified against code, not docs**

Supersedes the adaptation scope in `FREQUENCY_MODEL_PROTOCOL.md` where they disagree. Basis: `THESIS_DIRECTION_2026-09-12.md` and the revised proposal, §4.4: *"One bounded adaptation dimension will provide the core experiment; other implemented capabilities may be demonstrated without becoming additional optimisation studies."*

## 1. The lock

| Dimension | Status | Role in Part 2 |
| --- | --- | --- |
| **Frequency** (1-3/week) | Model-assisted | **Core experiment.** Only dimension with a frozen model, frozen metrics, and a 3-policy replay. |
| Delivery window | Deterministic only | Demonstrated capability. One trace case. Not an optimisation study. |
| Media format | Deterministic only | Demonstrated capability. One trace case. Not an optimisation study. |

Rationale: frequency is the only dimension carrying evaluable evidence. Promoting time or media to evaluated studies would require new protocols, new baselines, and new replays that do not fit before 23 October.

## 2. Verified adaptation surface

**Decision point.** Close of a 24-hour outcome window after a confirmed delivery — *not* weekly. Requires >=1 closed record or returns `insufficient_evidence` / `no_closed_24h_outcome`.

**Proximal outcome (label).** `link_visit` OR ordinary `inbound_reply` within 24h of `delivered_at`, where status is `delivered`/`read`. Ordinary = non-empty and not `STOP`/`PAUSE`/`MORE`/`LESS` (`frequency-model.js:ordinaryReply`).

**Tailoring variables (7 features).** candidate_frequency, current_frequency, recent_interaction_rate, noninteraction_streak, has_previous_interaction, candidate x recent_rate, candidate x streak. History window = last 4 closed outcomes; streak capped at 4.

**Decision rules — three layers, not two:**

1. *Model scores* — `scoreFrequencies` returns a probability per eligible frequency. Logged raw as `candidate_scores`.
2. *Selection rule* — lowest frequency within 0.05 of the best probability; clamped to current +/-1; increase blocked without >=1 recent interaction.
3. *Safety policy* — explicit in-envelope patient request overrides the model; increase blocked unless >=2 positives in last 4; decrease held unless non-interaction streak >=2; one **applied** frequency change per 7 days; envelope bounds.

**Application.** Dual-gated (`ADAPTIVE_SCHEDULE_APPLY_ENABLED` + per-behaviour `automatic_schedule_apply`). Shadow is default. Future unsent rows only; sent history immutable.

**Audit.** Two rows per evaluation, idempotent on `evaluation_key = model_id:behaviour_key:nudge_id:delivered_at`.

## 3. JITAI mapping (Nahum-Shani et al., 2018)

| JITAI component | This system |
| --- | --- |
| Decision point | Close of each 24h outcome window after confirmed delivery |
| Proximal outcome | Ordinary interaction within 24h |
| Intervention options | Frequency in [frequency_min, frequency_max] ∩ {1,2,3} |
| Tailoring variables | The 7 observable features above |
| Decision rules | Model scores → selection rule → deterministic safety policy |
| **Distal outcome** | **Explicitly not evaluated** — no behaviour, adherence, or health claim |

The empty distal-outcome slot states the claim boundary in the framework's own vocabulary.

## 4. Verified citations

| Use | Citation |
| --- | --- |
| Why logistic regression | Christodoulou, Ma, Collins, Steyerberg, Verbakel & Van Calster (2019). *J Clin Epidemiol*, 110, 12-22. |
| Why interpretable in high-stakes | Rudin (2019). *Nat Mach Intell*, 1(5), 206-215. doi:10.1038/s42256-019-0048-x |
| Adaptation framework | Nahum-Shani et al. (2018). *Ann Behav Med*, 52(6), 446-462. doi:10.1007/s12160-016-9830-8 |
| Why PR-AUC | Saito & Rehmsmeier (2015). *PLoS ONE*, 10(3), e0118432. |
| Why Brier/calibration | Van Calster, McLernon, van Smeden et al. (2019). *BMC Med*, 17, 230. |

## 5. Discrepancies found (fix in prose, not code)

- **D1** Schema allows `frequency_min/max` 1-7; runtime clamps to 1-3. Silent narrowing — state the operative range as 1-3.
- **D2** The `frequency_model_recommendation` audit row is **not** raw model output; it already contains the selection rule. Raw scores are preserved in `candidate_scores`. Describe three layers.
- **D3** "One step per week" conflates two rules: a +/-1 magnitude clamp and a 7-day cooldown on applied changes.
- **D4** Decision point is window close, not weekly.
- **D5** Two entry points exist: `evaluateShadow` (frequency only) and `evaluateAdaptive` (frequency + time + media). Name `evaluateAdaptive` as the evaluated artifact.
- **D6** STOP is absorbing at the delivery layer (`user_status: "opted_out"`). Adaptation is starved of new closed windows, not blocked inside the policy.
- **D7** Two increase gates exist (>=1 in the selection rule, >=2 in the safety policy). The >=2 gate is operative.

## 6. Frozen — do not revisit

Model, seed 5128, dataset hash, split, and all §5 headline metrics stay frozen. Calibrating the generator, adding comparator arms, and contextual bandits are out of scope for Part 2 and belong in Future Work.
