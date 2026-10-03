# Replacement text for Part 2 sections 5.4 and 6.2

Prepared 20 September 2026 against `evidence_2026-09-20/policy_baselines.json` and
`policy_baselines.log`, produced by `scripts/policy-baselines.js --seeds 10`. That harness
reproduces the frozen artifact's stored `policy_comparison` exactly on seed 5128 before
reporting anything new; the reproduction check is recorded in the JSON. The frozen model file
was not regenerated and its SHA-256 is unchanged.

**Word budget — read this before pasting.** Excluding table cells, the current 5.4 is 268 words
and 6.2 is 303, totalling 571. The replacement text is 710 and 572, totalling 1,282: a net
increase of 711 words of prose plus one seven-row table. The draft currently sits at about 7,609
words excluding references against an 8,000 ceiling, so roughly 390 words of headroom. **This text
does not fit without cuts elsewhere.** Removing the working-draft front matter recovers about 150
words and moving the implementation detail in 4.3, 4.4 and 4.7 to an appendix recovers about 450,
which covers it but leaves little room for the related-systems comparison table that 2.1 still
needs. If the budget stays tight, the two most compressible paragraphs here are the mechanism
paragraph in 6.2 (reduce to two sentences and move the rest to future work) and the oracle
paragraph in 5.4 (the table row carries most of the point).

About 170 words of the 5.4 replacement are retained verbatim from the current draft: the reversal
definition and the constraint-violation caveat, both of which are load-bearing and should not be
cut.

**Table renumbering.** This adds one table. Existing Table 4 (automation coverage) becomes Table 5.

---

## 5.4 RQ2 Frequency policy comparison

The matched replay uses the same 300 synthetic profiles for each policy over 12 weeks, with
pseudo-random variates keyed by seed, profile, week, message index and replay namespace. Every
policy starts each profile at two messages per week, so the two constant policies record one
initial change per profile. Three reference policies are included alongside the fixed,
deterministic and model-assisted arms reported in the proposal. Fixed-at-one and fixed-at-three
bound the approved envelope. The oracle assigns each profile its hidden preferred frequency; it
reads a simulation property the deployed system cannot observe and is an interpretation bound
rather than a candidate policy. This policy evaluation is separate from the held-out prediction
split and includes profiles used elsewhere in model development, so it is not an independent
held-out policy-generalisation experiment. The model-assisted simulator calls the shared
frequency recommendation function; it does not run the complete deployed frequency worker,
time and media policy, opt-out workflow, or database adapters.

**Table 3 Frozen matched frequency policy replay, seed 5128**

| Measure | Fixed 1 | Fixed 2 | Fixed 3 | Deterministic | Model assisted | Oracle |
|---|---|---|---|---|---|---|
| Messages | 3600 | 7200 | 10800 | 5233 | 3800 | 6972 |
| Ordinary interactions | 931 | 1707 | 1790 | 1361 | 1020 | 2778 |
| Interactions per message | 0.259 | 0.237 | 0.166 | 0.260 | 0.268 | 0.398 |
| Messages per interaction | 3.87 | 4.22 | 6.03 | 3.84 | 3.73 | 2.51 |
| Frequency changes | 300 | 0 | 300 | 557 | 523 | 195 |
| Direction reversals | 0 | 0 | 0 | 35 | 157 | 0 |
| Defined constraint violations | 0 | 0 | 300 | 0 | 0 | 88 |
| Profile-weeks at frequency 1 | 100% | 0% | 0% | 64.4% | 94.4% | 35.7% |

The final row is the result that most affects interpretation. The model-assisted policy selects
the minimum frequency in 94.4 per cent of profile-weeks and never selects three. The share at the
minimum reaches 92.3 per cent by week three and stays between 95.7 and 98.0 per cent from week
four to week twelve. The evaluated action
space is therefore effectively one to two, and mostly one, rather than the full approved range.

Against the fixed-at-one floor, the model-assisted policy sends 200 additional messages and
records 89 additional ordinary interactions, a marginal rate of 0.445 against its own average of
0.268. The increases it does make are therefore more productive than its average message. The
reduction in volume relative to fixed-at-two, however, is largely attributable to operating at
the floor rather than to per-profile selection.

The oracle bound shows what per-profile selection would be worth in this simulator: 0.398
interactions per message and 2,778 ordinary interactions, roughly 2.7 times the model-assisted
total, at a message volume close to fixed-at-two. The hidden preferred frequency is present in
the generator but is not recoverable from the seven observable features. The oracle also records
88 defined constraint violations, because reaching a profile's preferred frequency requires
raising frequency without a recent ordinary interaction. The safety gate forbids the assignment
the simulator rewards.

**Table 4 Policy stability across ten cohort seeds, mean ± standard deviation**

| Policy | Interactions per message | Ordinary interactions | Messages | Direction reversals | Profile-weeks at frequency 1 |
|---|---|---|---|---|---|
| Fixed 1 | 0.2358 ± 0.0129 | 849 ± 46 | 3600 ± 0 | 0 ± 0 | 100.0% |
| Fixed 2 | 0.2391 ± 0.0080 | 1721 ± 57 | 7200 ± 0 | 0 ± 0 | 0.0% |
| Deterministic | 0.2547 ± 0.0109 | 1347 ± 72 | 5285 ± 74 | 41 ± 6 | 63.4% |
| Model assisted, frozen | 0.2400 ± 0.0135 | 903 ± 56 | 3762 ± 28 | 139 ± 12 | 95.5% |
| Model assisted, retrained per seed | 0.2410 ± 0.0158 | 925 ± 62 | 3840 ± 187 | 159 ± 96 | 93.8% |
| Oracle | 0.3985 ± 0.0149 | 2879 ± 170 | 7224 ± 275 | 0 ± 0 | 32.8% |

Seed 5128 is favourable to the model-assisted arm and its ordering does not replicate. Because
every policy is replayed on the same cohort, the per-seed differences are exactly paired. On
interactions per message the model-assisted policy is 0.0147 ± 0.0125 below the deterministic
policy and higher in only one of ten seeds; retraining the model on each seed does not change
this (0.0137 ± 0.0132 below, higher in one of ten). It is 0.0009 ± 0.0142 above fixed-at-two,
higher in four of ten seeds, which is no reliable difference. It is 0.0042 ± 0.0039 above the
fixed-at-one floor, higher in nine of ten seeds. The defensible statement is therefore that
model-assisted adaptation reliably but narrowly outperforms sending the minimum, and does not
outperform the deterministic rule.

The frozen predictive component is more stable than the policy ordering. Across the same ten
seeds the test Brier score is below the constant-rate comparator in ten of ten, with a mean skill
score of 0.127 and a range of 0.024 to 0.249. The published value of 0.204 is the second highest
of the ten. Prediction improving on a constant rate and the policy built on it outperforming a
rule-based alternative are separate claims, and only the first replicates here.

The implemented reversal counter increments when a non-hold direction differs from the
immediately preceding week's non-hold direction. A hold week resets that comparison, so the count
does not include every later return in the opposite direction across intervening holds. This
definition is necessary to read 157 and 35 as the measured stability outcome rather than a
complete measure of oscillation.

The violation column applies only to the simulator checks: frequency outside one to three, a
change larger than one step, or an increase without the recent-interaction flag. The fixed-at-three
and oracle rows confirm that the counter detects the conditions it defines. It does not measure
duplicate sends, post-STOP delivery, cross-behaviour changes, or persistence failures, which
belong to system verification. TODO-EVIDENCE: do not label this column overall system safety or
infer comprehensive compliance from its zero values.

---

## 6.2 Interpretation of learning and adaptation

For RQ2, the frozen model improves Brier score against the constant-rate comparator under the
specified synthetic split, and that improvement holds across every cohort seed tested. The policy
built on it is a different matter. Model-assisted replay reduces message volume by roughly half
relative to fixed-at-two and raises interactions per message on the published seed, but across
seeds it does not beat the deterministic rule and is indistinguishable from fixed-at-two. What it
reliably beats is sending the approved minimum, by a small margin. These are joint consequences of
the fitted model, the lowest-near-best selector and the response generator, and none of them
establishes that a real recipient would prefer the policy.

The concentration at the minimum frequency is a property of the fitted model rather than of the
selection rule. Replacing the lowest-near-best rule with the highest-probability candidate, while
retaining the one-step and recent-interaction bounds, still places 89.2 per cent of profile-weeks
at frequency one, against 94.4 per cent for the shipped rule; intermediate tolerances of 0.01 and
0.001 give 90.0 and 89.2 per cent. The shipped rule therefore contributes about five percentage
points, and it improves both interactions per message and stability, halving direction reversals
from 290 to 157. The tolerance is not the explanation.

A plausible mechanism is that a pooled model cannot identify an individual profile's preferred
frequency from these features. Each profile's preference is a hidden constant, the only
individual signal available is a four-message interaction history at a positive rate near 0.2, and
the feature set contains no per-profile term. The fitted coefficients therefore express a
population-average frequency effect, which is negative because exceeding a profile's preference
carries an explicit burden penalty while falling below it costs only a distance term. Recommending
the minimum for almost everyone is the correct pooled answer and the wrong individual one. The
oracle gap quantifies what that costs. A per-profile intercept, a longer history window or an
explicit exploration allowance would be the natural extensions, and each would require a
separately identified experiment rather than a reinterpretation of this one.

Two further boundaries constrain the result. First, the safety layer is asymmetric: decreases
follow silence, increases require recent ordinary interaction. Combined with a policy that
lowers frequency, this forms a ratchet toward the floor, and it is what prevents the oracle
assignment from being reachable. That asymmetry is a deliberate design choice about
communication burden rather than a defect, but it bounds achievable interaction and should be
read as such. Second, the model is fitted on rows whose candidate frequency was assigned at
random and is then applied under a policy-induced assignment, so current frequency, recent
interaction rate and non-interaction streak follow different distributions at decision time than
in training. This is a distribution shift between fitting and use, separate from the leakage
controls described in 3.4.

For RQ3, routine operations are represented as automated services, while approval, setup and
exception resolution remain manual responsibilities. The summary interface makes this boundary
visible and distinguishes suggestion from application. No observed clinician task times or
user-study ratings are available. The defensible result is documented automation coverage with
remaining manual steps, not a demonstrated reduction in clinician workload.

The interaction proxy does not close Part 1's gap concerning feedback from behavioural outcomes.
Its authority is confined to approved communication logistics and checked by deterministic policy.
This contains a design risk rather than resolving the missing behavioural evidence.
