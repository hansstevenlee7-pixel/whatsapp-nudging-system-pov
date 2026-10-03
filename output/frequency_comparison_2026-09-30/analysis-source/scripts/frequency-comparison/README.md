# Frequency comparison: LR, contextual Thompson sampling, Gemini

This isolated experiment is the user's September 2026 extension of the earlier
frequency-only thesis scope. It does not change the application or frozen model.
Nudge-type selection and preference drift are not implemented here.

From the System POV repository:

```sh
node --test landing/tests/frequency-comparison.test.js
node scripts/frequency-comparison/run.js --local-only
node scripts/frequency-comparison/run.js --free-tier-confirmed
```

The final command is appropriate only for a Gemini project with billing disabled.
The user explicitly confirmed that condition for the existing key in this run.
Credentials are read from the environment or existing env files, never copied to
experiment outputs. There is no paid-model fallback. A real Gemini 2.5 Flash
availability check and synthetic preflight succeeded.

Default output: `output/frequency_comparison_2026-09-30/`. `--out PATH` selects a
new output location. `--max-calls N` caps API attempts during one invocation.
Quota, authentication and service failures leave resumable checkpoints and an
explicit incomplete report. Resume by running the same command after access is
available. Source or configuration changes require a new output directory.

## Protocol

- Seeds: 5128, 1–9. Existing generator: 300 users over 12 weeks per seed.
- Training: users 1–240, weeks 1–8. Validation: users 241–270, weeks 9–10,
  diagnostics only; no outcome-driven tuning. Evaluation: users 271–300,
  weeks 9–12. Their earlier observed histories initialise context, not model fits.
- Features and target match the existing generator. Identical exact feature-cell
  counts give all methods the same historical evidence. Standardisation uses only
  initial training data and remains fixed during online updates.
- LR retains the existing 2,200 gradient updates, learning rate 0.08 and coefficient
  penalty 0.05; it greedily selects an eligible frequency. Weekly fits start at
  zero, matching the old optimiser rather than silently improving the baseline.
- Bandit: Bayesian logistic reward model with zero-mean independent Gaussian
  priors (precision 0.05, including intercept); full-Hessian Laplace approximation;
  seeded coefficient draw per user-week; weekly posterior update. Cholesky solves
  implement both Newton fitting and correctly oriented posterior sampling.
- Gemini: temperature zero, thinking budget zero, strict JSON validation, frozen
  prompt. It returns a table for all 32 non-forced four-outcome history contexts.
  These contexts are mathematically enumerated, independent of user identities,
  evaluation-cohort composition, simulator parameters or future outcomes. The
  actual user context selects a row. One forced context bypasses the API.
- All current-week choices precede all current-week outcomes. The simulator uses
  matched response randomness. Each policy updates from its own realised feedback.
- Frequency 1–3; change at most one; no increase without recent ordinary interaction.
  These are experiment frequency constraints, not a full STOP/delivery-safety test.
- Primary: interactions/message; secondary: total interactions, message burden,
  changes, reversals, weekly trajectories, violations, and API reliability.
- Uncertainty: 10,000 bootstrap resamples of whole paired seeds. No message-level
  confidence intervals that treat correlated messages as independent samples.

## Pilot and batching amendment

The first implementation called Gemini for each distinct current-context prompt.
Google returned a free-tier **5 requests/minute** quota error after successful
calls. That pilot is preserved in
`output/frequency_comparison_2026-09-30_pilot_per_decision/`, including its original
manifest, source snapshot, actual responses, and incomplete report.

Before examining any complete LLM seed result, the main run was revised to request
the full finite decision table once per weekly training snapshot, with 13-second
request spacing. This requires at most 40 successful requests for the 1,200
user-week choices. Its table responses do not reuse the pilot's per-decision
responses. LR and bandit were rerun with identical settings; their results should
be byte-equivalent apart from configuration hashes. Pilot and final LLM results
must not be pooled. This is an execution and prompt-format amendment, not a change
to the cohort, simulator, features, reward, safety envelope, or statistical test.

## Evidence and limitations

`manifest.json` records the exact source hashes, frozen-model reproduction, Node
version and repository commit. `source-snapshot/` preserves the numerical and API
implementation. `validation/`, `training-cells/`, `checkpoints/`, `llm-cache/` and
`decisions.jsonl` preserve the full evidence chain. Final summaries appear in
`REPORT.md`, `results.json`, `per_seed.csv`, and `weekly.csv`.

The plotted comparison can be regenerated with Python and matplotlib:

```sh
python scripts/frequency-comparison/plot.py output/frequency_comparison_2026-09-30
```

Interpretation is bounded: the simulator is logistic, preferences are stationary,
only four weeks are evaluated, and hidden preferences are unavailable to every
policy. Per-message prediction differs from weekly action optimisation. The bandit
and LR differ in fitting and prior as well as exploration, so a difference cannot
be attributed solely to Thompson sampling. Cached Gemini tables assess one fixed
realisation, not independent-call variability. No clinical outcome or nudge-type
claim follows from this experiment.

Provider references: [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output),
[rate limits](https://ai.google.dev/gemini-api/docs/rate-limits),
[models API](https://ai.google.dev/api/models).
