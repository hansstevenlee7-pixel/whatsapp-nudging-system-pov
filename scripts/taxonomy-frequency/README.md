# Version 2: taxonomy-grounded synthetic frequency experiment

This is a **new** synthetic experiment. The original seed-5128 dataset, model
artifact, frozen predictive table, and in-progress three-policy comparison stay
available as version 1 evidence. A new thesis table should explicitly name this
version and should be substituted only after its methods and limitations are
reviewed. Results from v1 and v2 are not directly comparable: the simulator,
response prevalence, feature space, and candidate weekly message plans differ.

Frequency remains the **only model-selected action**: 1, 2, or 3 messages/week.
Each user has two illustrative, clinician-approved synthetic behaviours; the
three prewritten weekly slots have an action, pillar, category, nudge type and
tone from the live schema. A frequency choice sends the first N slots and cannot
rewrite their content. The simulator privately holds response tendency,
frequency tolerance, fatigue, and taxonomy affinities. Its fixed scenario
coefficients and all 12 illustrative actions are declared in `generate.js`.
Those numbers are assumptions for a controlled technical test, not empirical
effects, medical evidence, or personal preferences inferred from real patients.

Run locally from the System POV repository:

```sh
node scripts/taxonomy-frequency/generate.js
node scripts/taxonomy-frequency/local-run.js
node scripts/taxonomy-frequency/ablation.js
node --test landing/tests/taxonomy-frequency-*.test.js
```

The independent LLM arm uses the already confirmed billing-disabled Gemini
project. It starts only after the v1 free-tier comparison is complete:

```sh
node scripts/taxonomy-frequency/gemini-run.js --free-tier-confirmed
```

All outputs are under `output/taxonomy_frequency_v2_2026-09-30/`. The source
and dataset hashes are pinned in `manifest.json`. The LLM arm has its own
manifest, prompt hash, output cache, and weekly checkpoints under `gemini/`.
Quota, auth, transport, or invalid-output handling cannot silently substitute
a rule for a model call. No paid fallback, real sends, or deployment is involved.

## Evaluation contract

- Repeat 300 users and 12 weeks over ten prespecified cohort seeds (5128, 1–9).
  Users 1–240/weeks 1–8 train; users 241–270/weeks 9–10 provide untuned
  validation diagnostics; users 271–300/weeks 9–12 receive held-out replay.
  Their earlier logged histories initialise context only.
- Regularised logistic prediction uses frequency, recent outcomes and one-hot
  taxonomy features. Its greedy frequency policy and the contextual Thompson
  policy share the same posterior mean and prior; Thompson samples uncertainty.
  This better isolates exploration than the v1 comparison, although their later
  training data still diverge because the policies choose different actions.
- An eligible-random reference answers whether learned policies improve over
  unconstrained choice inside the same frequency safety envelope. It is a
  reference, not a fourth learned method.
- All 30 choices within a week are fixed before the simulator produces that
  week's outcomes. Each learned arm updates from its own observed responses.
  The shared random response key pairs policies on cohort, user, week and slot.
- No choice changes frequency by more than one or increases from recent silence.
  The main application has additional safeguards not exercised in this replay.
- Primary policy metric: ordinary interactions per delivered message. Total
  interactions, messages, changes, constraint violations and paired seed
  intervals are reported together to expose the workload tradeoff.
- Predictive diagnostics: held-out Brier and PR-AUC. The taxonomy ablation
  fits the same logistic model once with all features and once with only the
  original seven frequency/history features, on identical splits and seeds.

## LLM information limit

The LLM policy receives the current observed history, all three approved
future slots, and a deterministic contingency summary of the same logged
training evidence. The LR and bandit use the full row-level feature table.
This summary is lossy. The LLM comparison tests whether a constrained
language-model policy works with a practical evidence summary; it does not
isolate model class under perfectly identical information. One API request
covers all 30 independent decisions for a seed-week (40 successful requests
for all ten seeds). Gemini calls remain paced and resumable under the free tier.

## Interpretation boundary

Taxonomy labels make the simulation closer to the *structure* of the working
system. The response effects are still invented and deliberately disclosed.
They do not measure clinical effectiveness, adherence, patient preference,
real message quality or the benefit of choosing nudge types. The first ablation
has mixed held-out results, so it does not justify a claim that taxonomy
features improve prediction for new users. Four replay weeks cannot establish
robust adaptation to preference drift. All v2 outcome claims are conditional
on this synthetic scenario.
