# Frequency Adaptation Protocol

## Research question

> To what extent can a bounded WhatsApp nudging system use observable delivery and interaction traces to adapt the frequency, delivery window, and approved media format of future messages while maintaining reliable and traceable delivery?

This is a system-level technical-feasibility study. It does not measure clinical effectiveness, adherence, or real patient preference.

## Frozen scope

- Use the trained model only for frequency: 1, 2, or 3 messages per week.
- Adapt approved delivery windows and media formats with deterministic, explainable rules rather than additional models.
- Use a fixed synthetic-data seed and no online retraining.
- Count an ordinary reply or tracked-link visit within 24 hours of confirmed delivery as a positive interaction.
- Count no qualifying interaction within the closed 24-hour window as negative.
- Exclude STOP, explicit frequency commands, delivery failures, read receipts, identifiers, prescription text, and future information from model training.
- Keep shadow mode as the production default. A separate environment-gated, per-behaviour demonstration mode may apply the bounded policy to future unsent schedule rows.
- STOP remains absorbing and blocks future delivery independently of the model.

## Reproducible experiment

The generator creates 300 synthetic clients over 12 weeks. Each client has a hidden preferred frequency, baseline interaction tendency, and burden sensitivity. A regularised logistic regression uses:

1. candidate frequency;
2. current frequency;
3. recent interaction rate;
4. consecutive non-interactions;
5. whether a prior interaction exists;
6. candidate-frequency by recent-rate interaction;
7. candidate-frequency by non-interaction-streak interaction.

The split is by both client and time: clients 1–240 and weeks 1–8 train the model; clients 241–270 and weeks 9–10 form validation; clients 271–300 and weeks 11–12 form the untouched test set.

Run from `landing/`:

```bash
npm run model:generate
npm run model:train
```

The frozen artifact records the seed, feature order, standardisation values, coefficients, dataset hash, split definition, metrics, and policy comparison in `api/_models/frequency-logistic-v1.json`.

## Frozen results

| Evaluation | Model | Constant-rate baseline |
|---|---:|---:|
| Validation Brier score | 0.112762 | 0.136383 |
| Test Brier score | 0.137161 | 0.172242 |
| Test PR-AUC | 0.518518 | 0.220183 prevalence |

Lower Brier score is better. The matched 12-week policy replay produced:

| Policy | Messages | Interactions/message | Messages/interaction | Safety violations |
|---|---:|---:|---:|---:|
| Fixed at 2/week | 7,200 | 0.23708 | 4.2179 | 0 |
| Deterministic rule | 5,233 | 0.26008 | 3.84497 | 0 |
| ML plus safety | 3,800 | 0.26842 | 3.72549 | 0 |

The ML policy made 157 direction reversals in replay, compared with 35 for the deterministic rule. This is retained as a limitation rather than tuned away after seeing test results. Non-allowlisted participants therefore remain in shadow mode until prospective evidence justifies activation.

## Decision policy

The system scores all allowed frequencies, chooses the lowest frequency within five percentage points of the best predicted interaction probability, limits a recommendation to one step per week, requires two recent ordinary interactions before an increase, and requires two closed non-interaction windows before a model-assisted decrease. Explicit requests still take precedence when they fit the approved envelope.

Delivery-time adaptation groups ordinary replies and tracked visits into morning, afternoon, and evening. After at least two observations in one approved window, it moves one window per evaluation. Media adaptation uses explicit format requests first, then tracked visits by approved format, and otherwise rotates the least-recently-used approved resource. A read receipt is exposure evidence only and never drives a preference decision.

Two audit rows are written for each closed outcome window:

- `frequency_model_recommendation`: the deterministic JavaScript inference result;
- `adaptive_policy_shadow`: the bounded frequency/time/media result with actual schedule unchanged; or
- `adaptive_policy_applied`: the verified change to future unsent schedule rows and/or future automatic media selection.

Each evaluation has a stable key, so repeated worker runs do not create duplicate decisions.

Application requires both `ADAPTIVE_SCHEDULE_APPLY_ENABLED=true` and `adaptation_envelopes.automatic_schedule_apply=true` for the approved behaviour. The schedule writer preserves sent history, changes only future unsent occurrences, and verifies the recurring schedule after persistence.

## Passive interaction evidence

The Monitor derives and shows confirmed deliveries, read-known/read-unknown counts, send-to-read/visit/reply latency, tracked visits, ordinary replies, open 24-hour windows, and closed windows with no observable interaction. It never reports missing read evidence as unread, cannot measure WhatsApp reading duration, and does not claim adherence or health-action completion.
