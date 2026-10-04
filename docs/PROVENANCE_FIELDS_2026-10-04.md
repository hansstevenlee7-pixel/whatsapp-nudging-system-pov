# Provenance fields (4 October 2026)

The RQ1 translation-to-feedback trace (`scripts/translation-trace/`, `output/translation_trace_2026-10-04*`) showed complete *lineage*: every record links to the one it came from. *Provenance* was incomplete. No record named the model and prompt that translated a prescription or the clinician who approved a schedule, and a prescription correction erased the value it replaced. These fields close those gaps. Nothing here is deployed yet.

## Columns and tab

| Sheet | Field | Written by | Meaning |
|---|---|---|---|
| `prescriptions`, `nudges` (Workflow A rows) | `translation_model` | Workflow A *Validation Gate* | Gemini's `modelVersion`, else the model named in *Build Gemini Prompt*, which also drives the request URL |
| same | `translation_prompt_sha256` | same | SHA-256 of the prompt template (enums and rules, not patient context); changes whenever the prompt changes |
| same | `translation_response_id` | same | Gemini's `responseId`, for correlation with provider logs |
| same | `translated_at` | same | Gate time |
| `prescriptions` | `translation_normalised` | *Normalize Known Enum Drift* via the gate | What the LLM returned for any pillar or category the drift map corrected, e.g. `category: " Increase " -> increase` |
| `weekly_schedule` | `approved_by`, `approved_at` | `saveSchedule`, from the authenticated clinician in `api/approve.js` and `api/schedule.js` | Who last approved the slot, and when. Never read from the request body. A policy write keeps the attribution and names its own decision in `adaptation_decision_id`; a slot the policy creates has no clinician attribution |
| `prescription_revisions` (new tab) | `revision_id`, `prescription_id`, `user_id`, `changed_at`, `changed_by`, `field`, `previous_value`, `new_value`, `previous_source`, `reason` | `prescription-store.js` edit, archive and reactivate, in the same batch as the prescription write and then confirmed | Append-only history. `previous_source` is `workflow_a:<model>` when the replaced value came from the LLM, otherwise `clinician` |

## Migration

**Columns.** These need no manual step. `loadClinicalData` adds missing headers on first authenticated access, as for earlier columns, and `prescription_revisions` is created with its headers by `ensureTabs` on the first prescription edit.

**Ordering.** The intake API loads clinical data before it calls Workflow A. On the deployed Sheet, the translation columns therefore exist before the first Workflow A append that writes them. Google Sheets writes only columns present in the header row.

**Deployment.** All of the following are needed before any live claim:

- update the n8n Workflow A definition;
- redeploy the portal from `landing/`;
- run a non-participant intake, approval and edit.

## Tests

- `landing/tests/translation-trace-harness.test.js`: Workflow A provenance; the provenance link checks.
- `landing/tests/adaptive-schedule.test.js`: approval attribution; policy writes keep it; the body cannot set it.
- `landing/tests/prescription-api.test.js`: revision history; the LLM's value is kept; no revision for an unchanged value.
