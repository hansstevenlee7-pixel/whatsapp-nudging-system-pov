# Model-driven schedule-change experiment — 9 September 2026

## What this experiment demonstrates

This experiment runs the complete local decision path:

```text
synthetic delivery history
        -> closed-window evidence
        -> frozen frequency model
        -> bounded safety policy
        -> future-unsent schedule writer
        -> separate audit rows
```

It is the model-based companion to `SCHEDULE_CHANGE_EXPERIMENT_2026-09-09.md`. The companion checks the schedule writer with a fixed target and a time change. This record checks that the frozen model supplies the frequency recommendation before the policy and writer act.

Evidence level: **verified-local-synthetic**. No participant data, live Google Sheet write, WhatsApp delivery, Twilio event, deployment, or clinical outcome is involved.

## Inputs

- Model artifact: `frequency-logistic-v1` (`landing/api/_models/frequency-logistic-v1.json`), SHA-256 `971e347d95f2d2eaf207db7d0d9978defe97df871eeb94068903eb989321aaa2`.
- Behaviour: `Walk for 20 minutes` / `physical_activity` / `increase`.
- Initial recurring schedule: Monday and Thursday at `09:00` (`2` slots per week).
- Closed delivery history: two confirmed deliveries, both with no qualifying ordinary reply or tracked-link visit in the 24-hour window.
- Approved frequency envelope: `1`–`3` messages per week.
- Approved time window: fixed at `09:00`.
- Evaluation time: `2026-08-27T00:00:00.000Z`.
- Runtime: Node.js `v24.19.0` from the bundled workspace runtime.
- Model features: recent interaction rate `0`, non-interaction streak `2`, no previous interaction, and no recent interaction.

The ordinary-interaction label is deliberately narrow. A missing read receipt is not treated as a negative interaction; the two negatives here are closed delivery windows with no qualifying reply or visit.

## Model result

The model scored every permitted candidate frequency:

| Candidate frequency | Predicted interaction probability |
| ---: | ---: |
| 1 | 0.190180 |
| 2 | 0.147263 |
| 3 | 0.112683 |

The model recommendation was `1` message per week. The current frequency was `2`, so the model direction was a decrease. The behaviour key used for the run was `085911262764f34d2832fdf8cb9785d3`; this is a system correlation key, not a patient identifier.

## Policy result

The bounded policy accepted the model's decrease:

- current frequency: `2`;
- recommended frequency: `1`;
- one-step limit: satisfied (`2 -> 1`);
- approved frequency envelope: satisfied (`1`–`3`);
- recent non-interaction requirement: satisfied (two closed non-interaction windows);
- time: held at `09:00` because the approved delivery window was fixed;
- media: no format signal, so no format change was proposed.

The policy is the authority for application. The model does not directly write a schedule.

## Schedule result

The schedule writer returned `applied: true` with reason `future_unsent_schedule_updated`. The active recurring schedule changed from:

| Before | After |
| --- | --- |
| Monday 09:00 | Monday 09:00 |
| Thursday 09:00 | removed from the active recurring plan |

The two previously delivered rows and their `schedule_state` entries remained unchanged, including their synthetic Message SIDs and delivery timestamps. Only future unsent materialisation was eligible for change. The implementation therefore reduced future frequency without rewriting delivery history.

## Audit trail

The policy layer emits two separate rows for the same stable evaluation key:

| Signal | Outcome | Frequency before -> after | Rule |
| --- | --- | --- | --- |
| `frequency_model_recommendation` | `no_change` (recommendation record) | `2 -> 1` | `regularized_logistic_regression` |
| `adaptive_policy_applied` | `applied` | `2 -> 1` | `bounded_frequency_time_media_policy` |

This distinction is important for the thesis: the first row states what the model proposed; the second states what the bounded policy allowed and what the schedule writer persisted. The evaluation key is `frequency-logistic-v1:085911262764f34d2832fdf8cb9785d3:past-2:2026-08-21T00:00:00.000Z`, which prevents repeated worker runs from creating duplicate policy decisions.

## Reproduction and source locations

Run from the repository root with the bundled Node runtime:

```bash
node scripts/experiment-modelled-schedule-change.js
```

The harness is `scripts/experiment-modelled-schedule-change.js`. The model and policy are implemented in `landing/api/_lib/frequency-shadow.js` and `landing/api/_lib/frequency-model.js`; the future-unsent writer is `landing/api/_lib/schedule-store.js`. The worker integration assertion is `enabled bounded policy applies a model decision to future unsent schedule rows` in `landing/tests/frequency-worker.test.js`.

## Thesis-ready interpretation

In a fixed-seed synthetic scenario containing two closed delivery windows without a qualifying interaction, the frozen logistic model assigned the highest predicted interaction probability to one message per week. The bounded policy accepted this one-step decrease within the approved envelope and applied it to the active recurring schedule. Previously delivered rows and their provider-correlation state were unchanged. The result demonstrates a locally reproducible model-to-policy-to-schedule path and audit separation, not improved adherence, causal benefit, patient preference, or live deployment behaviour.

## Remaining evidence gaps

- `TODO-EVIDENCE`: repeat the same correlation check against a separately provisioned, isolated System POV Sheet only after its required tabs and headers are verified.
- `TODO-EVIDENCE`: capture a redacted deployed worker run showing the same evaluation key, decision rows, and subsequent schedule read-back.
- `TODO-EVIDENCE`: do not report this synthetic decrease as a clinical or adherence result.
