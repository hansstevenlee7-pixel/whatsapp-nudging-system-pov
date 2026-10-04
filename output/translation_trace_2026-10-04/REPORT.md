# RQ1 translation-to-feedback trace

Protocol `translation-trace-v1` (SHA-256 `39fca63eb80db833…`). Synthetic fixtures, local stand-ins, no network.

## Part A: translation gate under faulty LLM output

Verdict agrees with the declared expectation in 22/28 cases. Rows written on refused intakes: 0. Silent acceptances: A20 (referential), A21 (referential), A22 (referential), A23 (schedule), A24 (schedule), A25 (schedule).

| Case | Class | Expected | Verdict | Rows written | Gate stage | Draft → intended prescription | Agrees |
|---|---|---|---|---:|---|---|---|
| A01 | control | ACCEPT | ACCEPTED | 7 | passed | 2/2 | yes |
| A02 | control | ACCEPT | ACCEPTED | 10 | passed | 3/3 | yes |
| A03 | parse | REJECT | REJECTED | 0 | parse | — | yes |
| A04 | parse | REJECT | REJECTED | 0 | parse | — | yes |
| A05 | parse | REJECT | REJECTED | 0 | parse | — | yes |
| A06 | shape | REJECT | REJECTED | 0 | shape | — | yes |
| A07 | taxonomy | REJECT | REJECTED | 0 | enum | — | yes |
| A08 | taxonomy | REJECT | REJECTED | 0 | enum | — | yes |
| A09 | taxonomy | REJECT | REJECTED | 0 | enum | — | yes |
| A10 | drift | NORMALISE | ACCEPTED | 7 | passed | 2/2 | yes |
| A11 | drift | NORMALISE | ACCEPTED | 7 | passed | 2/2 | yes |
| A12 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A13 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A14 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A15 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A16 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A17 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A18 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A19 | bounds | REJECT | REJECTED | 0 | enum | — | yes |
| A20 | referential | REJECT | ACCEPTED | 8 | passed | 1/2 | **no** |
| A21 | referential | REJECT | ACCEPTED | 8 | passed | 1/2 | **no** |
| A22 | referential | REJECT | ACCEPTED | 8 | passed | 2/2 | **no** |
| A23 | schedule | REJECT | ACCEPTED | 7 | passed | 2/2 | **no** |
| A24 | schedule | REJECT | ACCEPTED | 7 | passed | 2/2 | **no** |
| A25 | schedule | REJECT | ACCEPTED | 7 | passed | 2/2 | **no** |
| A26 | semantic | ACCEPT | ACCEPTED | 7 | passed | 2/2 | yes |
| A27 | semantic | ACCEPT | ACCEPTED | 7 | passed | 2/2 | yes |
| A28 | semantic | ACCEPT | ACCEPTED | 10 | passed | 3/3 | yes |

## Part B: end-to-end lineage

Chains closed from the last delivered message back to the submitted prescription text: 6/6.

| Link | Present / applicable | Missing in |
|---|---:|---|
| T1 Prescription row carries the submitted prescription text | 7/7 | — |
| T2 A stored row names the model and prompt version that produced the prescription and its drafts | 0/7 | B1, B2, B3, B4, B5, B6 |
| T3 Draft's prescription_id is the prescription its LLM prescription_ref named | 15/15 | — |
| T4 A schedule_state row names the draft | 15/15 | — |
| T5 Approved slot's source_nudge_id is a Workflow A draft of the same prescription | 14/14 | — |
| T6 The approved schedule records which clinician approved it, and when | 0/14 | B1, B2, B3, B4, B5, B6 |
| T7 For every field the clinician changed, both the LLM value and the approved value remain stored | 3/4 | B4 |
| T8 Approved behaviour resolves by behaviour_key to an approved envelope naming its approving clinician | 8/8 | — |
| T9 Dated occurrence names its slot and that slot's prescription | 56/56 | — |
| T10 Submitted delivery has a reservation ID and provider message ID on its occurrence's state row, and the occurrence is marked sent | 12/12 | — |
| T11 Status callback stored as a delivery event naming the occurrence | 12/12 | — |
| T12 Inbound reply stored as an interaction event with its interaction_id and source nudge_id | 6/6 | — |
| T13 Interaction decision persisted with a decision_id that carries the same interaction_id | 6/6 | — |
| T14 Decision behaviour_key resolves to an approved envelope carrying the taxonomy triple | 6/6 | — |
| T15 Model recommendation and policy outcome persisted as separate rows sharing the evaluation_key | 6/6 | — |
| T17 Prepared next message names a persisted adaptation decision | 6/6 | — |
| T18 Prepared next message resolves to an active prescription | 6/6 | — |
| T19 Tracked media link names the prepared next message | 6/6 | — |

| Case | Reply | Decision on the reply | Frequency policy (current → recommended) | Deliveries | Chain closed |
|---|---|---|---|---|---|
| B1 | "Send fewer messages" | outside_envelope (explicit_request_guarded: frequency_outside_envelope) | 3 → 3 | 2 | yes |
| B2 | "Thanks, done!" | applied (least_recently_used_rotation: no explicit preference; rotated approved media) | 2 → 2 | 2 | yes |
| B3 | "Send fewer messages" | outside_envelope (explicit_request_guarded: frequency_outside_envelope) | 2 → 2 | 2 | yes |
| B4 | "Send fewer messages" | outside_envelope (explicit_request_guarded: frequency_outside_envelope) | 2 → 2 | 2 | yes |
| B5 | "Send fewer messages" | outside_envelope (explicit_request_guarded: frequency_outside_envelope) | 1 → 1 | 2 | yes |
| B6 | "Send more messages" | applied (explicit_request: explicit request fitted approved envelope) | 2 → 2 | 2 | yes |

Outbound requests refused: 0.
