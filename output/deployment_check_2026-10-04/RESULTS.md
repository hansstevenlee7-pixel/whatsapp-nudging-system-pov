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

## Re-run of the intake check after Hans re-imported Workflow A (5 October 2026)

**Procedure.** Hans imported `workflows/workflow_a_intake.json` (SHA-256 `7e8a2385…`), attached the Sheets credential and activated it. A second synthetic patient was submitted through the portal intake form: "Synthetic provenance check 2", ACMA fictitious mobile +61491570156, `user_id` `5d190e28-090c-4083-b05a-6909bc8a8378`. No plan was approved.

**Observed.**

- `POST /api/intake` returned success: the form redirected to the Monitor, which it does only on a 2xx response. So the workflow reached *Respond Success* after its five Sheets appends.
- The patient and its rows are **not** in the workbook the portal reads: `/api/patients` returns two patients, neither of them this one.
- The local `n8n.env` sets `GOOGLE_SHEETS_SPREADSHEET_ID` to the shared legacy workbook named in `CLAUDE.md`. The workflow's Sheets nodes write to `$env.GOOGLE_SHEETS_SPREADSHEET_ID`.

**Interpretation.** The re-imported Workflow A most likely writes to a different spreadsheet from the one the deployed portal reads. That points to a Railway-versus-Vercel `GOOGLE_SHEETS_SPREADSHEET_ID` mismatch, or a spreadsheet the old workflow had set directly in its nodes. This is the resource-isolation risk Part 2 already names. It cannot be confirmed from here: Railway variables and n8n executions are not visible to this check.

**Not yet verified in production:** translation provenance.

**Safety.** No schedule was approved, so the second synthetic patient has no deliverable occurrence, whichever workbook holds its draft rows.

## Correction after reading the n8n executions (5 October 2026)

Hans signed in to n8n (`n8n-production-db630.up.railway.app`); the executions were read only.

**Workflow A runs.**

| Run | Started (AEDT) | Duration | Outcome |
|---|---|---|---|
| 40713 | 00:15:04 | 269 ms | **Error** in *Call Gemini Vision*: "The service is receiving too many requests from you" (Gemini rate limit) |
| 40704 | 00:05:08 | 1.264 s | **Error**; its details would not load, but the duration fits the same early failure |
| 40710 | 00:11:50 | 44 ms | Success: the unauthenticated probe answered 401 |

Runs 40713 and 40704 match intake checks 3 and 2.

**Corrected interpretation.** The spreadsheet-mismatch explanation given above was wrong. Intake checks 2 and 3 never reached the Sheets nodes: Workflow A failed at the Gemini call, so the new patients were never written anywhere.

**Two findings.**

1. **Silent intake failure (defect).** The portal reported success for both failed intakes: the form redirected as if the patient existed. A failed n8n execution must not reach the clinician as a created patient.
2. **Quota.** The production Gemini key was rate-limited. The free tier allows 20 requests per day per project per model, and the live-fidelity runs of 4 October very likely used the same project's quota (first key in `n8n.env`). This is an evaluation side effect on the deployed system, reported here.

**Translation provenance in production remains unverified.** Check again after the quota resets, or with another key.

## Fix for the silent intake failure (5 October 2026, repository only, not yet deployed)

**Cause.** `landing/api/intake.js` passed on whatever n8n answered whenever the HTTP status was 2xx. When Workflow A stopped before any Respond node, the portal got a 2xx with no confirmation. The intake page then redirected using the `user_id` it had generated itself (`out.user_id || payload.user.user_id`), so a patient that was never written looked created.

**Change.**

- `landing/api/intake.js`: an intake succeeds only when Workflow A's *Respond Success* returns `status: "ok"` with the submitted `user_id`. Any other answer becomes HTTP 502 `intake_not_confirmed`, with a message telling the clinician to check the Monitor before resubmitting. This covers an empty 2xx, a missing status, another patient's id, n8n errors, an inactive webhook and a proxy-secret mismatch. A mismatch is no longer passed on as 401, which would have made the browser refresh its session and submit again. *Respond Rejected* (422, before any Sheets write) becomes `intake_rejected`, "nothing was saved".
- `landing/input.html`: redirects only on `status: "ok"` naming the submitted patient; the fallback to the browser-generated id is removed.
- `landing/tests/intake-api.test.js`: 10 tests. Against the previous code, 9 fail; the success case passes either way. Full suite: 251/251 pass.

**Deployment.** Hans deployed from `landing/` at about 00:58 AEDT on 5 October: deployment `whatsapp-nudging-system-b688o0kzt-stevenleehans-projects.vercel.app`, aliased to `whatsapp-nudging-system-pov.vercel.app`.

Checked read-only at 00:59:
- the production `input.html` is byte-identical to the repository file (SHA-256 `6ad6ccdf…`);
- it carries the confirmation check and no longer has the fallback;
- `POST /api/intake` without a session answers 401.

The server-side behaviour on an unconfirmed intake is verified only by the tests so far. The scheduled re-test checks it in production.

**Spreadsheet setting.** On 5 October Hans confirmed that Railway's `GOOGLE_SHEETS_SPREADSHEET_ID` equals Vercel's. Workflow A and the portal therefore use the same workbook. He had changed the setting earlier, following the wrong diagnosis above.

## Intake re-check after the Gemini daily reset (5 October 2026, 19:47 AEDT)

This was scheduled for 18:07 AEDT, after the free-tier daily quota reset at midnight Pacific. It waited for Hans to sign in to the portal himself.

**Pre-checks.**
- The intake fix is deployed: the production `input.html` carries the confirmation check.
- Hans confirmed that Railway's `GOOGLE_SHEETS_SPREADSHEET_ID` equals Vercel's.
- The portal session had expired; Hans signed in at 19:46.

**Intake.** One synthetic intake was submitted through the portal form at 19:47:
- name "Synthetic provenance check 4", ACMA fictitious mobile +61491570158, `synthetic.provenance.check4@example.com`;
- prescription text "SYNTHETIC TEST, not a real patient. Walk 20 minutes after dinner, twice a week, for 6 weeks.";
- prescriber Hans Lee.

This made one Gemini call, with no retry.

| Step | Observed | Verdict |
|---|---|---|
| Form outcome | Redirected to the Monitor with `user_id` `9b7680a2-6d0f-4b75-94b5-94ca302792e6`. Since the fix, the page redirects only when Workflow A answers `status: "ok"` with the submitted id | Workflow A confirmed this patient. The confirmed-success path is verified in production; the failure path is not |
| `/api/patients` | The patient exists in the workbook the portal reads. One prescription, `rx_43ca5d41…`: `physical_activity/increase`, 2 per week, 6 weeks. Two drafts (`needs_review`) on 5 and 7 October at 19:00 | Workflow A and the portal share the workbook |
| Translation provenance, on the prescription and both drafts | `translation_model` `gemini-2.5-flash`; `translation_response_id` `GGTDaqGcE_me_uMP0KuR4QI`; `translated_at` 2026-10-05T08:47:22.402Z; **`translation_prompt_sha256` empty**; `translation_normalised` empty | Model, response id and time **verified in production**. Prompt hash **not recorded** (below). An empty `translation_normalised` means nothing was normalised; that is correct for this text, but it cannot be told apart from an unrecorded value |
| Correction | `PATCH /api/prescription`, category increase → establish: HTTP 200, `persisted: true`. The endpoint returns only after confirming the revision row | Revision written. `previous_source` is set by code from the row's `translation_model`, so it is `workflow_a:gemini-2.5-flash`; the tab itself was not read, because the Sheet needs a Google sign-in |
| Archive | `DELETE /api/prescription`: HTTP 200. Prescription archived; 0 active prescriptions, 0 active slots, 0 dated occurrences | Cleanup complete. No plan was approved and nothing will be sent |
| n8n execution | Not read: Hans was not signed in to n8n (optional) | — |

**Why the prompt hash is empty.**
- Workflow A's *Build Gemini Prompt* node computes the hash with `require('crypto')` inside `try`, and records `''` if that throws.
- Production n8n lets Code nodes load Node built-in modules only when `NODE_FUNCTION_ALLOW_BUILTIN` permits them. The local harness allowed `crypto`, so the gap appeared only in production.
- The fallback hid the failure.

**Fix options (Hans's decision):**
- set `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on Railway; or
- compute the hash without a built-in module.

**Not verified in production:**
- the prompt-template hash;
- the failure path of the intake fix: Gemini answered, so the "did not confirm" message was not exercised live.

## Intake re-check after enabling `crypto` in n8n (5 October 2026, 19:53 AEDT)

**Change.** Hans set `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on the Railway n8n service and redeployed it. At 19:53 n8n `/healthz` answered 200.

**Intake.** One synthetic intake was submitted through the portal form, with one Gemini call and no retry:
- name "Synthetic provenance check 5", ACMA fictitious mobile +61491570159, `synthetic.provenance.check5@example.com`;
- the same prescription text and prescriber as check 4.

| Step | Observed | Verdict |
|---|---|---|
| Form outcome | Redirected to the Monitor with `user_id` `f32fe145-66b4-41ce-9897-10295e98364e` | Workflow A confirmed the patient |
| `/api/patients` | One prescription, `rx_3378b824…`: `physical_activity/increase`, 2 per week, 6 weeks. Two drafts (`needs_review`) | Same translation as check 4 |
| Translation provenance, on the prescription and both drafts | `translation_model` `gemini-2.5-flash`; `translation_prompt_sha256` `1f34b557576949f51651e037d79fc575ae0473ac16e3403de209f7c42a419c9a`; `translation_response_id` `nGXDarGZDNi2_PUPrvL60Ao`; `translated_at` 2026-10-05T08:53:50.224Z; `translation_normalised` empty, because nothing was normalised | **All translation provenance fields are verified in production** |
| Prompt hash against the repository | Identical to the hash on all 191 rows of `output/translation_trace_2026-10-04_iteration2/results.json`, produced by the repository's Workflow A (`7e8a2385…`) | The deployed Workflow A uses the repository's prompt template |
| Correction | `PATCH /api/prescription`, category → establish: HTTP 200, `persisted: true`, revision row confirmed by the endpoint | `previous_source` follows from code: `workflow_a:gemini-2.5-flash`. The tab was not read |
| Archive | `DELETE /api/prescription`: HTTP 200. Archived; 0 active prescriptions, 0 active slots, 0 dated occurrences | Nothing approved or sent |

**Still not verified in production:**
- the intake fix's failure path;
- `previous_source`, read directly from the Sheet tab.

**Gemini use.** Two calls were made on 5 October after the daily reset (checks 4 and 5).
