# Iteration 2: provenance fields (4 October 2026)

This iteration uses the same protocol (`translation-trace-v1`, SHA-256 `39fca63e…`) and the same cases as the first run (`../translation_trace_2026-10-04/`) and iteration 1 (`../translation_trace_2026-10-04_iteration1/`). Both earlier runs are kept unchanged. `results.json` reproduces byte for byte (`09f7d7a2…`).

No WhatsApp send, deployment, cloud write or Gemini call was made.

## Why

After iteration 1, lineage was complete, but three provenance links were absent:

- T2: model and prompt, 0/7;
- T6: approving clinician, 0/14;
- T7: the LLM value after a prescription correction, 3/4.

Hans approved adding the fields on 4 October 2026.

## Change

Specified in `docs/PROVENANCE_FIELDS_2026-10-04.md`:

- **Workflow A** (repository definition; the live n8n workflow is not updated) stamps every prescription and draft row with:
  - `translation_model`;
  - `translation_prompt_sha256` (a hash of the prompt template);
  - `translation_response_id`;
  - `translated_at`;
  - on prescriptions, `translation_normalised`, recording any drift the gate corrected.

  *Build Gemini Prompt* names the model once, and the request URL uses that name.
- **Weekly slots** record `approved_by` and `approved_at`, set from the authenticated clinician in `approve.js` and `schedule.js` and never from the request body. A policy write keeps them.
- **Prescription changes** (edit, archive and reactivate) append to a new `prescription_revisions` tab with the previous value, its source (`workflow_a:<model>` or `clinician`), who changed it and when. The append is written in the same batch as the change, then confirmed.
- **Fixture.** The test Sheet (`sheets-fixture.js`) gains the new columns and tab, as the self-healing headers add them to the live Sheet.
- **Link checker** (`links.js`):
  - T7 now also looks for the replaced value in the new revision history;
  - T6 now also requires the approval time named in its definition ("and when"), which makes it stricter. Before, both parts were absent.

  The harness tests check both rules against planted positive and negative records.

The full suite passes 241/241 (`full_suite.log`): the earlier 236 plus 5 provenance and checker tests.

## Results (REPORT.md)

- **Part A** is unchanged from iteration 1: 25/28 agree, 18 refused with 0 rows written, and A23–A25 still accepted by design.
- **Part B**: 6/6 chains close, and every protocol link type is complete except T16:
  - T2 7/7, T6 14/14, T7 4/4;
  - T16 stays at 3/4 for the reason given in iteration 1: in B3 the untouched second behaviour's slot doesn't name the decision, and no changed slot lacks it.

  In B4 the revision row reads `category: reduce → increase`, changed by the synthetic clinician, previous source `workflow_a:gemini-2.5-flash`.
- **Benchmark rerun** (`../adaptation_benchmark_2026-10-04_provenance/`): every case outcome is identical to `_translationfix`, and trace completeness is 25/25.
