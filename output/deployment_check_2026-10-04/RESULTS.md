# Production deployment check (4 October 2026)

**Deployment.** The portal was deployed from `landing/` by Hans at 23:52 AEDT:

- deployment `whatsapp-nudging-system-loh8mc96w-stevenleehans-projects.vercel.app`, aliased to `whatsapp-nudging-system-pov.vercel.app`;
- source = branch `thesis-evidence-2026-10-04`, the same files as commit `e7957d5` under `landing/`;
- Hans reported updating Workflow A in n8n himself.

## Unauthenticated route checks

| Request | Result |
|---|---|
| `/login.html`, `/monitor.html`, `/input.html` | 200 |
| `/api/patients`, `/api/me`, `POST /api/approve` without a session | 401 |
| `POST /api/internal/{media-worker,frequency-worker,prepare-delivery}` without the worker secret | 403 `invalid_worker_secret` (routes exist) |

## Non-participant check

Run with Hans's clinician session; he signed in himself. The patient is synthetic: "Synthetic provenance check", ACMA fictitious mobile +61491570006, `synthetic.provenance.check@example.com`, prescription text marked "SYNTHETIC TEST, not a real patient". `user_id` `509aa29f-0477-4e15-bc82-c787db2ab544`, `prescription_id` `rx_e7326eb5-fb05-44e6-b17c-a66dac43e035`.

| Step | Path | Observed | Verdict |
|---|---|---|---|
| 1 Intake | Portal intake form, then n8n Workflow A (one live Gemini call) | One prescription (`physical_activity/increase`, 2 per week) and 2 drafts written. The `translation_model`, `translation_prompt_sha256`, `translation_response_id`, `translated_at` and `translation_normalised` columns **exist** in the live Sheet (portal self-healing headers) but are **empty** on the new rows | Translation provenance **not written in production**. The n8n Workflow A that served the intake did not run the updated gate, or its values were not mapped |
| 2 Approval | Monitor UI, schedule 19 Oct – 1 Nov | 2 slots, each with `approved_by` = the signed-in clinician's auth ID and `approved_at` 2026-10-04T12:58:12.501Z; 4 dated occurrences, the first on 22 Oct | Approval attribution **verified in production** |
| 3 Correction | `PATCH /api/prescription` (no UI control exists) | `category` increase → establish; `status: ok, persisted: true`. The endpoint returns only after confirming the revision row in the Sheet | Revision history **verified in production**. `previous_source` will read `clinician`, because the row lacked translation provenance |
| 4 Archive | `DELETE /api/prescription` (no UI control exists) | Prescription archived; 2 slots deactivated; 4 future occurrences rejected; 0 active slots remain | Cleanup complete; nothing will be sent |

## Findings

1. The production translation-provenance path is not yet working. In n8n, check:
   - *Build Gemini Prompt* contains `prompt_template_sha256`;
   - *Validation Gate* contains `translation_model`;
   - the *Call Gemini Vision* URL contains `{{ $json.model }}`;
   - the workflow is saved and active;
   - no older Workflow A is also active on `/webhook/intake`.
2. Prescription correction and archiving exist in the API but not in the clinician UI.
3. The test rows stay in the shared Sheet, labelled as synthetic and archived.
