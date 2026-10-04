# RQ1 trace completeness

Derived from first-run traces in `adaptation_benchmark_2026-10-04_reservefix`. A link counts only when an explicit identifier connects the two records in the persisted local stores; timing-based inference does not count.

## fixed

Steps with every applicable link present: 25/25

| Link | Present / applicable | Missing in |
|---|---:|---|
| Inbound reply stored as an interaction event with its interaction_id and source nudge_id | 23/23 | — |
| Interaction decision persisted with a decision_id that carries the same interaction_id | 23/23 | — |
| Decision behaviour_key resolves to an approved envelope carrying the taxonomy triple | 23/23 | — |
| Prepared next message names a persisted adaptation decision | 24/24 | — |
| Prepared next message resolves to an active prescription | 24/24 | — |
| Tracked media link names the prepared next message | 24/24 | — |

## rules

Steps with every applicable link present: 25/25

| Link | Present / applicable | Missing in |
|---|---:|---|
| Inbound reply stored as an interaction event with its interaction_id and source nudge_id | 23/23 | — |
| Interaction decision persisted with a decision_id that carries the same interaction_id | 23/23 | — |
| Decision behaviour_key resolves to an approved envelope carrying the taxonomy triple | 23/23 | — |
| Model recommendation and policy outcome persisted as separate rows sharing the evaluation_key | 23/23 | — |
| Changed recurring schedule rows name the persisted applied policy decision that changed them | 4/4 | — |
| Prepared next message names a persisted adaptation decision | 24/24 | — |
| Prepared next message resolves to an active prescription | 24/24 | — |
| Tracked media link names the prepared next message | 24/24 | — |

