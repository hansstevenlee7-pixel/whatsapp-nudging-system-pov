# Research and implementation instructions

## Current handoff

For the thesis-writing continuation, begin with:

- `docs/HANDOFF_THESIS_WRITING.md` for the exact implementation, evidence, deployment, and pending-work boundary;
- `docs/THESIS_WRITING_PLAN.md` for the Part 2 outline, word budget, evidence map, and claim language; and
- `../THESIS_SCOPE_LOCK_2026-08-28.md` for the frozen research scope.

The implementation baseline is local commit `2961495`. It was not pushed or deployed in the final implementation turn. At the handoff, `origin/main` remained at `929a81d`; the updated Workflow C JSON had not been applied to live n8n; and no live automatic schedule change had been demonstrated. Do not push or deploy from a thesis-writing session without a separate explicit instruction because the prepared Vercel and Supabase demo gates could enable future schedule application after deployment.

## 1. Research identity

This repository is the independent **System POV** version of Hans Lee's Monash Master's research prototype. The artifact is evaluated using a Design Science Research perspective: build a traceable messaging system, demonstrate that it behaves safely and reliably, and evaluate whether bounded requests are fulfilled.

The contribution is the integration and traceability of:

```text
clinician-approved prescription
  -> weekly message plan
  -> WhatsApp delivery
  -> delivery and interaction evidence
  -> bounded decision
  -> changed subsequent message
```

The LLM is a constrained component, not the contribution and not an autonomous clinical decision-maker.

### Primary research outcome

**Request fulfilled:** the system received an explicit signal, produced an auditable decision inside the approved envelope, and changed a subsequent message accordingly.

### Permitted secondary analysis

The project may analyse planned and actual frequency, media selection, send-to-read/visit/reply latency, repeated visits, typed replies, and changes over time. These measures describe system exposure and interaction only.

A future thesis extension may study whether recurring interaction patterns—such as long send-to-read gaps or repeated absence of observable interaction—can improve delivery-time selection. Frame this as timing or engagement adaptation, not health adherence. Absence of evidence remains unknown and may reflect disabled receipts, access, connectivity, attention, or other unobserved causes.

## 2. Repository and infrastructure isolation

The original project is paused and retained for later PhD work:

```text
../Whatsapp Nudging System
```

Do not edit, reset, deploy, reconnect, or clean that project while working here.

The active repository is:

```text
Whatsapp Nudging System - System POV
```

Its infrastructure must remain separate:

- Private GitHub repository for this checkout.
- Vercel project `whatsapp-nudging-system-pov`.
- Production alias `https://whatsapp-nudging-system-pov.vercel.app`.
- Railway project `whatsapp-nudging-system-pov`; n8n service at `https://n8n-production-db630.up.railway.app`.
- Supabase project ref `dmvfudxhqcbusyircmsq` in the Sydney region.
- Google Sheet `Patient Database`: `https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit`.

Do not reconnect any paused PhD resource. Never copy credentials into documentation, source, tests, logs, prompts, or commits.

## 3. Runtime architecture

### Vercel

Hosts the authenticated clinician portal and same-origin APIs. Browser code must not call Google Sheets, Supabase service-role APIs, n8n, or Twilio directly.

Deploy from the app directory:

```sh
cd landing
vercel --prod
```

Never deploy this repository from its root. The root lacks the app-level `vercel.json`; a root deployment can replace the production alias with a build that has no API routes.

### Railway and n8n

- Workflow A: patient intake and initial prescription/message generation.
- Workflow B: due-message selection, signed delivery preparation, Twilio send, and delivery-state persistence.
- Workflow C: asynchronous media discovery and reply/adaptation workers.

Workflow C calls signed Vercel worker endpoints. Railway must use the new production alias as `PORTAL_BASE_URL`, the same `N8N_PROXY_SECRET` as Vercel, and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.

### Supabase

Supabase is authoritative for operational adaptation:

- `media_search_jobs`
- `media_candidates`
- `media_assets`
- `adaptation_envelopes`
- `patient_adaptation_state`
- `user_adaptation_state`
- `interaction_events`
- `adaptation_decisions`
- `tracked_links`

Apply migrations in order. Do not enable adaptive media until required tables, policies, and storage are present.

### Google Sheets

Sheets is the clinical schedule and research-friendly export surface. Relevant audit tabs include:

- `media_assignments`
- `interaction_events`
- `adaptation_decisions`
- `patient_adaptation_state`
- `patient_adaptation_timeline`
- `media_pool`

Operational adaptation state comes from Supabase. Sheet audit exports must be idempotent, append-only where historical, and safe to retry.

### Twilio

- Validate `X-Twilio-Signature` on status and inbound webhooks.
- Store inbound replies idempotently using the inbound Message SID.
- Persist `submitted`, `sent`, `delivered`, `read`, `failed`, and `undelivered` when reported.
- A missing read receipt stays unknown.
- Process typed `STOP` before any other interpretation, opt the user out, and prevent future sends.
- Acknowledge ordinary replies immediately and interpret them asynchronously.

## 4. Monitoring UI contract

The Monitoring workspace is intentionally simple and clinician-facing:

- Select/search a patient, then show a compact identity and status header.
- Open on the current Australia/Melbourne Monday-to-Sunday week.
- Support multiple intake-generated nudges on the same day.
- Show start and stop dates compactly above the week.
- Use one `Save schedule` action.
- Do not show taxonomy, taxonomy selectors, prescription interpretation, raw prescription controls, or internal behaviour labels.
- Do not provide `Add nudge` or deletion controls. Intake remains the source of schedule entries.
- Historical sends are immutable; schedule edits affect only future unsent occurrences.

Each nudge supports:

- Weekday, time, and patient-facing text edits.
- `Auto`, `Text only`, or one exact clinician-selected approved resource.
- Latest sent/delivered/read/failed/visited/replied evidence.
- Expandable occurrence history.
- An inline media picker and one `Approve media set` action when approval is pending.
- Clinician-only drag-and-drop upload for video or files, constrained to the approved behaviour envelope.

Hidden action, pillar, category, prescription, source, and behaviour identifiers must survive every simplified UI edit unchanged.

## 5. Media discovery and approval

Search providers receive only the behaviour-owned triple:

```text
(action_text, pillar, category)
```

Never send patient names, phone numbers, questionnaire responses, raw prescriptions, or interaction histories to YouTube, Europe PMC, or Gemini.

### YouTube allowlist

`YOUTUBE_TRUSTED_CHANNEL_IDS` is configured in Vercel Production and Preview with:

```text
UC07-dOwgza1IguKA86jqxNA,UCiMg06DjcUk5FRiM3g5sqoQ,UCf3BkFTwI4G1vMc6W-NpQNw
```

These are WHO, CDC, and the Australian Government Department of Health, Disability and Ageing. Keep the allowlist institutional for the first release. Do not add influencers or individual clinicians without an explicit source-governance decision.

### Search and generation rules

- Search each trusted YouTube channel through the official YouTube Data API.
- Search open-access papers through Europe PMC/PubMed.
- Cache by taxonomy-triple hash for 30 days in normal operation.
- Rank deterministically using source trust, taxonomy overlap, accessibility, patient suitability, recency, and duplicate status.
- Gemini may summarise only retrieved, validated paper content in an asynchronous worker.
- Validate structured output and the original URL. If generation fails, retain only the verified title and source link.
- Initial media approval is mandatory. Store external media at its trusted URL; use Supabase Storage only for authorised/open-access copies or clinician uploads.

The approved pool should contain the best available video, a plain-language paper summary, and another accessible reading/paper resource. Search may produce more candidates, but delivery can select only approved assets.

## 6. Adaptation dictionary and rules

Behaviour-specific state takes precedence. Patient-wide state is a fallback and must not silently rewrite every behaviour.

The approved envelope controls permitted formats, summary lengths, tones, delivery window, minimum/maximum frequency, and action alternatives. Safe defaults keep time and frequency fixed and allow only the current action until a clinician expands them.

Decision order:

1. Apply an explicit patient request when deterministic validation confirms it fits the envelope.
2. Use repeated visits and positive/negative replies to adjust scores for formats already shown.
3. Record read receipts as exposure only; never use a read alone as preference, success, or failure.
4. With no clear preference, rotate the least-recently-used approved resource.
5. Record an outside-envelope request without applying it.
6. Silence may rotate media and may support a one-step frequency decrease only in the explicitly allowlisted demonstration policy after two closed 24-hour windows. It can never raise frequency or support a claim of non-adherence.

Every decision must preserve:

- Original signal and exact reply text where applicable.
- Structured interpretation.
- Rule and reason.
- Scope (`global` or `behaviour`).
- Source (`patient`, `clinician`, or `system`).
- Previous and next state.
- Changed fields, effective time, and state version.
- Before/after frequency and media snapshots.
- Next selected message/resource.

### Frequency definitions

- `planned_frequency`: active scheduled messages for the behaviour per week.
- `delivered_frequency`: messages Twilio confirms as delivered or read.
- `requested_frequency`: latest explicit patient frequency request.
- `observed_frequency`: link visits and typed replies per week; never adherence.

Per-message snapshots must retain planned frequency, selection mode, actual media kind/asset, scheduled/sent/delivered/read/visited/replied times, and send-to-event latencies. Later edits must never rewrite historical snapshots.

### Explainable communication-response model boundary

Any learning component is an exploratory system-policy model, not “the LLM learning the patient.” Start with pooled, regularised logistic regression using one row per confirmed-delivered message. A defensible target is ordinary interaction within 24 hours: a tracked-link visit or an ordinary typed reply.

Exclude control and unsafe labels (`STOP`, `PAUSE`, `MORE`, `LESS`), read receipts, delivery failures, future/post-send fields, names, phone numbers, and raw prescriptions. Use expanding-window validation and report calibration/Brier score and PR-AUC against a constant-rate baseline. Compare fixed, deterministic-rule, and model-plus-safety policies.

Keep four layers separate in code and analysis:

```text
model recommendation
  -> deterministic safety policy
  -> clinician decision where required
  -> actual scheduled send
```

Run the model in shadow mode until delivery, callback, assignment, and interaction joins are reliable and there is enough data for a meaningful estimate. A practical minimum planning gate is approximately 200–300 confirmed deliveries, at least 30 positive ordinary interactions, calibration better than a constant-rate baseline, clean replay, and zero post-`STOP` leakage. Before that gate, apply mode requires both the environment switch and an explicit `automatic_schedule_apply` flag on the synthetic/demo behaviour envelope. Silence never raises frequency; uncertain recommendations hold; increases require two recent ordinary interactions and must remain inside the clinician-approved envelope.

## 7. Research language and evidence standards

Use precise labels:

- `scheduled`, `submitted`, `sent`, `delivered`, `read`, `failed`, `undelivered`
- `visited`, `replied`, `request received`, `decision applied`
- `unknown` when evidence is absent

Do not claim:

- adherence or non-adherence
- behaviour completion
- clinical benefit or health improvement
- preference from one read receipt
- live delivery from local tests
- production correctness from a successful deployment alone

Always distinguish:

- **Implemented:** present in source.
- **Locally verified:** tests/checks pass in this checkout.
- **Deployed:** Vercel/Railway reports a ready deployment.
- **Integration verified:** the relevant cloud services exchanged the expected records.
- **Live WhatsApp verified:** a controlled message and its Twilio/Sheet/Supabase/Monitor evidence were inspected end to end.

## 8. Required APIs and security

Retain these public/signed interfaces:

- `POST /api/whatsapp-status`
- `POST /api/whatsapp-inbound`
- `GET /api/r/[token]`

Retain authenticated/internal operations for media population, plan approval, interaction history, delivery preparation, the patient dictionary, and worker polling.

Security rules:

- Clinician pages and patient data APIs require authenticated active profiles.
- Doctors see only their assigned patients; admins may manage assignments.
- Redirect tokens must be high-entropy, expire or be revocable, log idempotently, and redirect only to validated HTTPS targets.
- Service-role keys and provider secrets stay server-side.
- Public webhooks fail closed when signatures/secrets are missing or invalid.

## 9. Verification gates

### Local gate

From `landing`:

```sh
npm test
npm run check
```

From the repository root:

```sh
git diff --check
```

Cover taxonomy query generation, trusted-source filtering, summary validation, pool approval, scoring, envelope enforcement, duplicate callbacks/replies, tracked redirects, `STOP`, weekly UI rendering, hidden metadata preservation, immutable history, and adaptation-dictionary derivations.

### Deployment gate

- Deploy from `landing`.
- Verify authentication and the weekly Monitor on mobile and desktop.
- Confirm `/api/internal/media-worker` exists: unauthenticated access should be rejected, not return a Vercel 404.
- Confirm the signed n8n worker completes a queued job.

### Twilio Sandbox gate

For one controlled message, correlate:

```text
scheduled row
  -> prepared message/resource
  -> Twilio Message SID
  -> delivery/read state when available
  -> visit or typed reply
  -> adaptation decision
  -> changed next message
```

Then verify `STOP` prevents future sends. Duplicate callbacks and replies must produce one event and one decision.

### Adaptation acceptance gate

At minimum verify:

- “I prefer videos” makes the next approved resource a video.
- “Please make it shorter” selects a short summary.
- “Send it later” changes time only within the approved window.
- A valid frequency request changes future planned frequency and preserves history.
- Repeated silence rotates media without reducing frequency.
- An outside-envelope request is recorded but not applied.
- Behaviour-specific state overrides the patient-wide fallback.

## 10. Recorded deployment evidence

Treat every item below as dated evidence and reverify live state before repeating it as current.

Captured 23 August 2026:

- The production alias is backed by a deployment created from `landing`.
- The internal media route exists and rejects a request without the n8n secret with `403 invalid_worker_secret`.
- `YOUTUBE_TRUSTED_CHANNEL_IDS` exists in both Vercel Production and Preview.
- A synthetic, non-patient physical-activity discovery job completed through Workflow C with six video candidates and three paper candidates.
- That test returned WHO and CDC videos. The Australian channel is allowlisted but produced no match for that particular query.
- Candidate generation is verified; clinician approval and delivery of those candidates are separate gates.

Captured 25 August 2026:

- A clinician-controlled manual media fallback was implemented for proposed `video`, `paper`, or `reading` HTTPS resources and deployed from `landing`.
- The corresponding working tree passed 155 local tests, `npm run check`, and `git diff --check` at that time.
- External persistence, clinician approval, delivery preparation, and an actual Workflow B send were not verified. Do not describe the manual resource as live until those stages are observed.

Do not generalise this synthetic result into participant, clinical, or end-to-end WhatsApp validation.

## 11. Working-tree discipline

- Run `git status --short` before editing.
- Preserve user-owned and unrelated changes; never reset, discard, overwrite, or stage them automatically.
- At the time this document was created, changes already existed in `landing/api/_lib/adaptive-handlers.js`, `landing/monitor.html`, and `landing/tests/action-taxonomy.test.js`, plus untracked `landing/tests/manual-media.test.js`. Treat them as user-owned unless provenance is established.
- Use small, reviewable changes.
- When a schema field changes, update migrations, server validation, Sheet headers/export, fixtures, tests, and UI together.
- Store timestamps in UTC and display them in `Australia/Melbourne`.
- Never log or echo secret values during diagnosis.

## 12. Immediate research priorities

1. Verify that a clinician-added manual resource persists, appears in the proposed pool, can be approved, and is prepared for Workflow B.
2. Review and approve a real automatically discovered media set in the clinician UI.
3. Verify that an approved asset is used through a tracked redirect in a controlled Twilio Sandbox message.
4. Generate and inspect the synthetic three-week adaptation trace covering media, frequency, timing, clinician overrides, interactions, silence, and outside-envelope requests.
5. Confirm patient-dictionary exports populate the current-state and append-only timeline Sheet tabs idempotently.
6. Only after those gates and sufficient data, begin a bounded shadow-mode timing/frequency experiment using exposure/interaction evidence—not adherence labels.

## 13. Reference documents

- `README.md`
- `docs/HANDOFF_THESIS_WRITING.md`
- `docs/THESIS_WRITING_PLAN.md`
- `docs/SYSTEM_POV_MIGRATION.md`
- `docs/ADAPTIVE_MEDIA_MIGRATION.md`
- `docs/PATIENT_ADAPTATION_DATA_DICTIONARY.md`
- `supabase/migrations/`
- `workflows/workflow_a_intake.json`
- `workflows/workflow_b_delivery_twilio.json`
- `workflows/workflow_c_adaptive_media.json`
