# RQ1 translation-to-feedback trace: protocol v1

Written on 4 October 2026, before any run. The runner records this file's SHA-256 in its manifest. Changes after the first run go into a labelled amendment; they are never edited in place.

## Why

RQ1 asks how the system preserves traceability from a clinician-approved prescription through taxonomy mapping, message selection or generation, scheduling, delivery and feedback capture.

The existing RQ1 evidence starts at an inbound reply on a pre-built schedule: the benchmark trace audit (`scripts/adaptation-benchmark/trace-completeness.js`). Nothing yet measures the front of the chain:

- how the prescription text is translated by the LLM layer (Workflow A) into the locked taxonomy and draft messages;
- how a clinician approves or corrects those drafts;
- how approved behaviours become scheduled and delivered messages.

This protocol measures the whole chain once, from the prescription text to the adapted next message.

## What runs

**Unmodified project code:**

- Workflow A and Workflow B. Their Code nodes are executed from `workflows/*.json` exactly as stored, and their IF, HTTP and Google Sheets nodes are emulated from the parameters declared in the same files.
- The portal APIs: `intake`, `approve`, `prescription`, the `plan` envelope approval, `internal/prepare-delivery`, `whatsapp-status` and `whatsapp-inbound`.
- The adaptation worker (`processInteraction`) and the frequency worker in apply mode.

**Declared stand-ins, with no network access:**

| External service | Stand-in |
|---|---|
| Gemini | The case's recorded LLM response. These are authored synthetic fixtures, not live model output |
| Google Sheets | The test fixture `landing/tests/sheets-fixture.js`. n8n Sheets nodes write only columns present in its declared headers, so a field missing from the sheet cannot count as a link |
| Supabase | The benchmark PostgREST emulator, with primary-key and timestamp column defaults emulated from `supabase/migrations` |
| Twilio REST | Returns a deterministic `SM…` identifier |
| Media discovery | A seeded candidate pool per behaviour |
| n8n runtime | `$json`, `$()`, `$env` and `$now` (a Luxon-compatible subset in Australia/Melbourne, the deployed `GENERIC_TIMEZONE`) |

The clock is fixed. Any other outbound request fails the run.

## Part A: the translation gate under faulty LLM output

Each case sends one intake through the portal intake API into Workflow A, with one declared fault in the LLM response. The expected outcome follows Workflow A's own contract: the prompt rules in *Build Gemini Prompt* and the comments in *Validation Gate* and *Normalize Known Enum Drift*. A rule is in scope when breaking it would break a trace link or the locked taxonomy. Template choice and message wording are out of scope.

- **REJECT**: the intake is refused, and no row of any kind is written. The gate's own comment: "Any violation rejects the WHOLE batch (no partial writes)".
- **NORMALISE**: a known enum drift is corrected to the canonical token and the intake is accepted.
- **ACCEPT**: the intake is accepted and every written row equals the gate's output.

| Case | Class | Fault | Expected |
|---|---|---|---|
| A01 | control | Valid single prescription | ACCEPT |
| A02 | control | Valid two prescriptions in different pillars | ACCEPT |
| A03 | parse | Response is not JSON | REJECT |
| A04 | parse | JSON wrapped in a markdown fence | REJECT |
| A05 | parse | Truncated JSON | REJECT |
| A06 | shape | Empty `nudges` array | REJECT |
| A07 | taxonomy | Pillar outside the enumeration | REJECT |
| A08 | taxonomy | Category outside the enumeration | REJECT |
| A09 | taxonomy | Draft pillar differs from its prescription's pillar | REJECT |
| A10 | drift | Category with case and spacing drift (`" Increase "`) | NORMALISE to `increase` |
| A11 | drift | Retired action token as category (`daily_steps_10000`) | NORMALISE to `increase` |
| A12 | bounds | Missing `action_text` | REJECT |
| A13 | bounds | `action_text` of 1,025 characters | REJECT |
| A14 | bounds | `nudge_type` outside the enumeration | REJECT |
| A15 | bounds | `scheduled_time` `25:00` | REJECT |
| A16 | bounds | `scheduled_date` not ISO (`05/10/2026`) | REJECT |
| A17 | bounds | `frequency_per_week` 0 | REJECT |
| A18 | bounds | `duration_weeks` 60 | REJECT |
| A19 | bounds | Missing `message_body` | REJECT |
| A20 | referential | Draft names `prescription_ref` `p9`; only `p1` and `p2` exist (same pillar) | REJECT (rule 3) |
| A21 | referential | Draft has no `prescription_ref`; two prescriptions exist (same pillar) | REJECT (rule 3) |
| A22 | referential | A prescription has no draft at all | REJECT (rule 4) |
| A23 | schedule | Draft date outside `week1_dates` | REJECT (rule 4) |
| A24 | schedule | Two drafts of one prescription on the same date | REJECT (rule 4) |
| A25 | schedule | Number of drafts differs from `frequency_per_week` | REJECT (rule 4) |
| A26 | semantic | Valid tokens, wrong meaning (walking prescription mapped to `reduce`) | ACCEPT (no deterministic gate can know; clinician review is the defence) |
| A27 | semantic | `action_text` unrelated to the prescription text | ACCEPT (same) |
| A28 | semantic | An extra valid prescription not present in the text | ACCEPT (same) |

**Measures:**

- verdict agreement with the expected outcome;
- **rows written on a refused intake (mandatory: 0)**;
- for accepted intakes, whether every draft is linked to the prescription its `prescription_ref` named.

A contract violation that the gate accepts is reported as a *silent acceptance*, by class.

## Part B: end-to-end lineage of accepted translations

Each case runs the full chain:

1. A clinician intake submitted through the portal goes through Workflow A with the recorded LLM response.
2. The clinician reviews the drafts and approves them through the approve API, with the edits the case declares. A prescription correction uses the prescription API.
3. Draft envelopes are created.
4. The seeded media pool is approved through the plan API, with an envelope of one to three messages a week and automatic application enabled. This is the clinician's dual-gate opt-in; the server gate is on.
5. Workflow B runs at the first occurrence's due time.
6. A signed `delivered` status callback arrives.
7. A signed reply quotes the delivered message's identifier.
8. The adaptation worker runs, then the frequency worker.
9. Workflow B runs at the next occurrence's due time, with its callback.

| Case | Prescription text (synthetic) | LLM response | Clinician review | Reply |
|---|---|---|---|---|
| B1 | Sleep: in bed by 10:30 pm, 3 nights a week, 8 weeks | Correct: sleep/establish, 3 drafts | Approves unchanged | "Send fewer messages" |
| B2 | Walk 30 minutes after dinner, twice a week, 6 weeks | Correct: physical_activity/increase, 2 drafts | Rewords the action and moves one draft from 18:00 to 19:00 | "Thanks, done!" |
| B3 | Cut sugary drinks (twice a week) and 10 minutes of breathing (once a week), 8 weeks | Correct: two prescriptions | Approves unchanged | "Send fewer messages" |
| B4 | Increase walking to 30 minutes a day; two reminders a week; 6 weeks | Semantic error: category `reduce` | Corrects the prescription category to `increase` and approves the drafts with it | "Send fewer messages" |
| B5 | Sleep: no screens after 9:30 pm and in bed by 10:30 pm, twice a week, 8 weeks | Correct: one prescription, two different actions | Approves unchanged | "Send fewer messages" |
| B6 | Walk 20 minutes, 3 times a week, 6 weeks | Correct: 3 drafts | Approves only two of the three drafts | "Send more messages" |

**Links.** A link counts only when an explicit identifier or stored value connects the two records in the persisted stores. Inference from timing or position does not count. Each link is evaluated wherever it applies:

| Link | Stage | Present when |
|---|---|---|
| T1 prescription → source text | translation | The prescription row carries the submitted prescription text |
| T2 prescription → translation provenance | translation | A stored row names the model and prompt version that produced the prescription and its drafts |
| T3 draft → prescription | translation | The draft's `prescription_id` is the prescription its LLM `prescription_ref` named |
| T4 draft → delivery state | translation | A `schedule_state` row names the draft |
| T5 approved slot → draft | approval | The slot's `source_nudge_id` is a Workflow A draft of the same prescription |
| T6 approval → clinician | approval | The approved schedule records which clinician approved it, and when |
| T7 correction → LLM proposal | approval | For every field the clinician changed, both the LLM value and the approved value remain stored |
| T8 behaviour → envelope | approval | The behaviour key of each approved behaviour resolves to an approved envelope that names its approving clinician |
| T9 occurrence → slot | scheduling | Each dated occurrence names its slot and prescription |
| T10 delivery → occurrence | delivery | Each submitted delivery has a reservation ID and provider message ID on its occurrence's state row, and the occurrence is marked sent |
| T11 callback → occurrence | delivery | Each status callback is stored as a delivery event naming the occurrence |
| T12–T19 | feedback and adaptation | The eight benchmark definitions in `trace-completeness.js` (`evaluateStep`), applied unchanged |

**Measures:**

- links present over applicable, per link and per case;
- **chain closure** per case: whether the last delivered message can be walked back to the submitted prescription text through present links only.

## Criteria

- Mandatory: zero rows written on any refused intake in Part A, and zero outbound network requests.
- Everything else is descriptive.

A defect revealed here may be repaired in a labelled iteration and re-run into a new output folder; the first run is kept unchanged. A missing link that needs a schema change is reported rather than repaired in this protocol.
