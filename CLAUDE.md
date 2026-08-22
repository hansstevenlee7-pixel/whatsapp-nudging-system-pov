# CLAUDE.md — AI-Powered Personalised Lifestyle Nudging System

## What this project is
Research prototype for Monash FIT5126 (Master's research, supervisor: David Taniar).
A closed-loop system that converts a **real doctor's lifestyle prescription** into a
schedule of personalised behavioural nudges delivered via **WhatsApp**, with user
feedback adapting future nudges.

Thesis framing: addresses the "integration gap" between behavioural guidance and
real-world execution. Grounded in COM-B, JITAI, Self-Determination Theory.
Methodology: Design Science Research. The novelty is the adaptive personalisation
framework — the LLM is a component, not the contribution.

## Current handoff status (2026-07-29 — read this first)

- **Direct-Sheets migration is complete and live in production.** PR #2 merged to
  `main`, Vercel deployed, and the acceptance test (load → approve → remove Sunday
  → save → reload) passes against the real spreadsheet. The Monitoring & Review
  portal is now independent of Workflow E: authenticated Vercel APIs read and
  update Google Sheets directly through a service account.
- **Workflow E is retired and archived in n8n.** Nothing in the codebase calls its
  webhooks. Handler chain is `approve/schedule/patient/admin` →
  `api/_lib/clinical-data.js` → `api/_lib/google-sheets.js`. The only remaining n8n
  call from the portal is `api/intake.js` → `/webhook/intake` (Workflow A), which is
  intended. Do not reactivate Workflow E or reintroduce a webhook data path.
- **Service account:** `682440469905-compute@developer.gserviceaccount.com`, holding
  Editor on the spreadsheet (read and write both verified). The key JSON lives at
  `local/lifestyle-medicine-503112-11b80b5c98f0.json`, ignored via `.gitignore`
  (`local/*.json`). It has never been committed; never commit one.
  Note this is the project's *default Compute Engine* service account, so it
  carries broad project privileges. Replace it with a dedicated, sheet-scoped
  account before any real participant data is involved.
- **Vercel env vars:** `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, and `GOOGLE_SHEETS_SPREADSHEET_ID` are set
  in **Production and Development only**. The private key is stored in escaped
  `\n` single-line form; `api/_lib/google-sheets.js` converts it back.
- **Preview environment is not functional and never was.** It lacks every
  server-side secret — `SUPABASE_*`, `N8N_PROXY_SECRET`, `PUBLIC_APP_URL`, and now
  the three `GOOGLE_*` vars. Only `N8N_BASE_URL` spans all three environments. A
  failing preview deployment is expected, not a regression. Populate Preview before
  relying on it for review apps.
- **The reply path left n8n (2026-08-11). Needs 1 Sheet tab and a Twilio webhook
  repoint.** Workflow C is retired in favour of `POST /api/whatsapp-inbound`, and
  Workflow F is now a 2-node cron calling `POST /api/followup-tick`. Every inbound
  reply is appended to the new **`inbound_messages`** tab *before* it is
  interpreted, so a reply that fails to resolve still leaves a record — the exact
  blindness that made a missing live Yes undiagnosable. The endpoint is public and
  authenticated by **Twilio request signature** (closes build-order step 3). Cutover
  is: add the tab → deploy → repoint the Twilio Sandbox webhook → archive C in n8n →
  import the 2-node F. Rollback is repointing the webhook back. New Vercel vars
  needed: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`,
  `TWILIO_OUTCOME_CONTENT_SID`, `FOLLOWUP_TICK_SECRET`. New n8n vars:
  `PORTAL_BASE_URL`, `FOLLOWUP_TICK_SECRET`. See `docs/REPLY_PATH_MIGRATION.md`.
- **Behaviour-taxonomy migration is implemented but NOT deployed — it needs 2 Sheet
  columns first (2026-08-10).** `pillar` and `category` moved down from the
  prescription to the target behaviour, so a behaviour is the triple
  `(action_text, pillar, category)` and **one prescription may span pillars**. The
  Monitor's separate "Taxonomy" trace step is gone: each behaviour row in the trace
  card now carries its own pillar and category selects, and the weekly slot's Action
  became a dropdown over that list. The migration is **`category` on `nudges` and on
  `weekly_schedule`, blank on every existing row** — `pillar` is already populated
  everywhere, so nothing changes for a patient until a clinician re-files a
  behaviour. `clinical-data.js` asserts both columns, so **the portal 500s on every
  request until they exist**; confirm with the read-only
  `node scripts/verify-followup-migration.mjs`, which now checks both migrations and
  currently reports them MISSING. Three gates were deleted: the slot-pillar-must-
  match-prescription check, `pillarLock`, and the pillar cascade onto source nudges.
  Workflow A is untouched. See `docs/BEHAVIOUR_TAXONOMY_MIGRATION.md`.
- **Action-taxonomy Sheet migration is DONE and verified against the live Sheet
  (2026-08-03).** `nudges` and `weekly_schedule` both carry `action_text`, and
  `loadClinicalData()` passes every header contract, so the `missing required
  columns` guard is no longer a deploy blocker. Current live state: 10 source
  nudges / 11 active weekly slots, with `action_text` **blank on all of them** —
  this is Case A as designed. The read path fills them from
  `prescriptions.target_behavior` via `resolveActionText`, which currently resolves
  cleanly for all three prescriptions (`processed_food_reduction` → "Reduce
  processed food", `daily_steps_7500` → "Walk 7,500 steps", `sleep_7_to_9_hours` →
  "Sleep 7–9 hours"). The blanks are written for real on the next clinician save.
  Do NOT run `seed-weekly-schedule.js` against this Sheet — that script is for
  unmigrated Sheets only and would duplicate portal-created slots. See
  `docs/ACTION_TAXONOMY_MIGRATION.md`.
- **Prescription CRUD is implemented** (`api/prescription.js`,
  `api/_lib/prescription-store.js`, `tests/prescription-api.test.js`). The
  `prescriptions` header contract is now the full 11 columns in **both**
  `clinical-data.js` and `tests/sheets-fixture.js` — they must change together or
  every handler 500s. Two fixture caveats to remember: its `batchWrite` stores rows
  verbatim (production's `rowData` silently drops keys missing from `headers`), and
  it preserves JS types, whereas Sheets returns FORMATTED_VALUE strings — live
  `frequency_per_week` reads back as `"3"`, not `3`. Every read-back comparison
  must `String()`-normalize or it will 409 in production while passing in tests.
- **Two-stage nudge feedback is implemented but NOT deployed (2026-08-06).**
  A clinician can switch **Send outcome follow-up** on per weekly slot with an
  **Ask after** delay of 1-72 whole hours. Stage 1 turns the initial message into
  "Will you do this?" (Yes/No); a Yes arms exactly one delayed stage 2, "Were you
  able to complete it?" (Done / Not yet). `Not yet` opens the existing barrier
  question unchanged. A window that closes unanswered is `NO_FEEDBACK`, **never**
  `NOT_YET`. New `workflows/workflow_f_followup.json` sends the delayed check and
  expires stale windows; it ships **inactive**. Not yet deployed. The Sheet
  migration is **15 new columns** (`nudges` +2, `weekly_schedule` +2,
  `schedule_state` +11) — verify it with the read-only
  `node scripts/verify-followup-migration.mjs`, which runs the same header
  asserts the live handlers do. Both Twilio Content Templates now exist
  (`nudge_commitment_check` `HXec5cc1dd85f35bfe277910ea46ac87e8`,
  `nudge_outcome_check` `HX7b88b3fececb68a50019eb7b861eb29f`) but are approved
  for **WhatsApp user-initiated only** — Sandbox testing inside the 24-hour
  window works; production-initiated delivery needs WhatsApp approval first.
  See `docs/TWO_STAGE_FEEDBACK.md` for the migration, the template specs, the
  localhost harness, and the Sandbox checklist.
  - `followup_enabled` / `followup_delay_hours` are clinician config on
    `weekly_schedule` (authoritative), copied to dated `nudges` at
    materialization, then snapshotted onto `schedule_state` by Workflow B at send
    time so re-planning cannot rewrite what a delivered message promised.
  - `followup_due_at` is computed **once, at delivery** (`delivered_at || sent_at`
    + delay), never when the patient replies. That is what makes a late Yes
    immediately eligible instead of restarting the clock.
  - Follow-up is refused on a non-actionable nudge type: only `reminder` and
    `challenge` may ask for a commitment, so an affirmation or reflection never
    does. Both the server and the Monitor enforce this.
  - `followup_sent_at` / `followup_wa_id` are the scheduler's claim check, so a
    duplicate Workflow F execution sends nothing.
  - Timestamps in this flow are ISO 8601 **with an explicit offset** and are
    always compared through `Date.parse`, never string-compared — Melbourne moves
    between +10:00 and +11:00 and a naive sort would mis-order a DST-straddling
    pair.
- **Localhost harness:** `node local/dev-server.js` serves the real Monitor and
  the real `/api/*` handlers — including `/api/whatsapp-inbound` and
  `/api/followup-tick` — against an in-memory sheet, with a simulated WhatsApp at
  `http://127.0.0.1:4010/simulator.html`. Replies are signed exactly as Twilio
  signs them and posted to the real handler, so the walkthrough exercises
  signature validation, the `inbound_messages` log and the resolver rather than a
  local re-implementation. Only Workflow B's Code nodes are still lifted from
  JSON. `/__sim/tick?at=…` moves the clock, gated on `ALLOW_TICK_TIME_TRAVEL`,
  which no deployment sets. It contacts no Google Sheets, Supabase,
  Twilio or n8n and persists nothing. Use it to walk the whole flow before
  deploying.
- **Validation:** `cd landing && npm test` passes 159 tests in the working tree
  (`workflow-feedback.test.js`, `action-list.test.js` and
  `prescription-api.test.js` are still untracked, see the working-tree warning
  below); `npm run check` passes and now also covers `review-state.js`.
  Tests cover approve → remove Sunday → save, retry idempotency, future unsent
  cancellation, sent-history preservation, patient CRUD, assignment, rejection,
  ownership, false-success prevention, the behaviour taxonomy (out-of-enum pillar
  and category rejection, blank/oversized action rejection, **one prescription
  persisting slots in two pillars**, category inherited when a slot omits it,
  differing actions per slot, exact preservation of the whole triple through
  materialization, prescription-anchored custom nudges, adaptation-proof actions,
  and legacy token migration), and the curated behaviour list (prescription scoping,
  the canonical/source fallback, self-healing suppression, zero-match renames, the
  four-step taxonomy fallback chain, unsaved additions keeping their chosen
  taxonomy, `mixed` on disagreement, and `applyActionTaxonomy`'s scoping and
  zero-return), and prescription CRUD (atomic create, immediate schedulability, no
  half-create on batch failure, **the default pillar staying editable and not
  cascading**, the archive cascade with sent history preserved,
  archived-cannot-approve-but-can-reject, non-restoring reactivate, and
  ownership), and the two-stage feedback flow (`followup-flow.test.js`: config
  save/reload, delay validation across missing/fractional/zero/negative/>72,
  informational types refused, template selection, due-time anchoring, Yes arms
  one follow-up, duplicate Yes idempotent both by SID replay and by second tap,
  No arms none, not-before-due, late-Yes eligibility, duplicate scheduler
  execution, Done→DONE, Not yet→NOT_YET plus barrier, both NO_FEEDBACK expiries,
  correlation via `followup_wa_id`, the STOP cascade, Twilio `OptOutType=STOP`
  without a second confirmation, and the untouched single-stage contract).
  The workflow assertions run the real `jsCode` extracted from the workflow JSON,
  so Workflows B/C/F are covered as executed rather than only as inspected.
  **Not covered: any DOM behaviour.** There is no jsdom, so the trace card's
  focus/click/rebuild handling is only verified by manual browser smoke.
- **Working tree warning:** there are unrelated uncommitted research/workflow
  changes in `README.md`, both schema copies, `local/README.md`, and Workflows
  B/C/D/E, plus untracked `.Rhistory` and `workflow-feedback.test.js`. These predate
  this work and are deliberately preserved. Do not stage, discard, or overwrite them.

## Architecture (do not deviate without flagging it)
Pipeline: INPUT → INTERPRETATION → ACTION GENERATION → NUDGE → FEEDBACK → ADAPT

1. **INPUT** — doctor's free-text prescription arrives (Google Form → Google Sheets).
2. **INTERPRETATION + ACTION GENERATION (LLM, at intake)** — ONE LLM call at
   prescription intake parses free text into canonical prescription objects and
   expands them into a full dated schedule of pre-written nudge messages.
3. **NUDGE** — n8n reads due rows from Google Sheets and sends through the
   currently selected WhatsApp provider. **Twilio Sandbox is the active development
   path; the existing Meta implementation is preserved as a separate version.**
4. **FEEDBACK** — Twilio WhatsApp quick replies and typed fallbacks arrive at the
   authenticated Vercel endpoint `/api/whatsapp-inbound`, are appended to
   `inbound_messages` **before** interpretation, then resolved and applied to
   `schedule_state`. No n8n involvement; the request signature is the auth.
5. **ADAPT (LLM, weekly batch)** — weekly cron feeds the LLM the prescription +
   feedback history + barrier tags + adherence stats → it regenerates the NEXT
   week's schedule (intensity, frequency, timing, tone, message wording — never
   `action_text`). Output passes the same validation gate as intake.

**LLM rule: batch-only.** The LLM runs at exactly two points — prescription intake
(Workflow A) and weekly adaptation (Workflow D). It NEVER runs in the delivery or
reply path. Anything requiring a per-message LLM is future work, not this build.

n8n workflows:
- **Workflow A (intake):** Sheets trigger → LLM call → validation gate → write schedule rows
- **Workflow B (Meta delivery, preserved):** `workflow_b_delivery.json`; keep intact
  for the future Meta/production path.
- **Workflow B (Twilio delivery, active dev):**
  `workflow_b_delivery_twilio.json`; every 5 minutes in `Australia/Melbourne` →
  read active users and generated approved nudges due in the current five-minute
  window → join phone by `user_id` → Twilio WhatsApp send → mark the
  nudge sent and store the Twilio Message SID in `schedule_state.wa_message_id`.
- **Workflow C (retired — the reply path is now `/api/whatsapp-inbound`):**
  `workflows/workflow_c_feedback.json` is kept as recoverable history, exactly as
  Workflow E is. **Do not reactivate it**; its webhook path would also collide
  with nothing, since Twilio now posts to the portal. Same behaviour, in JS:
  parse quick-reply payloads or typed text → resolve the reply to one row **and
  one conversation stage** by correlating `OriginalRepliedMessageSid` against
  `followup_wa_id` (stage 2), `barrier_followup_wa_id`, then `wa_message_id`
  (stage 1 or single-stage) → store `YES`/`NO` in `commitment_response`,
  `DONE`/`NOT_YET` in `outcome_response`, or the unchanged
  `DONE`/`IN_PROGRESS`/`NOT_YET` in `response` for a single-stage nudge,
  idempotently → send a deterministic confirmation; `NOT_YET` asks why, `STOP`
  opts out immediately and cancels every open stage, and Twilio
  `OptOutType=STOP` is persisted without a second confirmation because Twilio has
  already replied. See `docs/REPLY_PATH_MIGRATION.md`.
- **Workflow F (outcome follow-up scheduler) is now 2 nodes:** Schedule Trigger
  (every 5 minutes, `Australia/Melbourne`) → HTTP Request to
  `/api/followup-tick`. n8n is the clock only; it holds no credentials and
  touches no spreadsheet. The tick sends outcome checks whose `followup_due_at`
  has passed and closes commitment/outcome windows that expired unanswered as
  `NO_FEEDBACK`. It writes **only** `schedule_state` — the delayed check is a
  feedback event, never a clinician-approved nudge, so it never creates a
  `nudges` row. Ships inactive. The 16-node original is preserved at
  `docs/archive/workflow_f_followup_n8n_native.json`.
- **Workflow D (adaptation):** weekly cron → aggregate feedback + barriers + streaks
  per user → LLM re-plans next week's schedule → validation gate → overwrite
  upcoming (not past) schedule rows
- **Workflow E (retired, archived in n8n):** `workflows/workflow_e_review.json` is
  kept in place purely as recoverable history; it is not part of the runtime. The
  portal must not call its review, approval, assignment, or patient-update webhooks.
  Equivalent CRUD now lives in authenticated Vercel APIs backed directly by Sheets.

## Clinician authentication and ownership

- The public landing page remains open. `input.html`, `monitor.html`, and
  `admin.html` are protected by invitation-only Supabase email/password accounts.
- Browser code calls same-origin Vercel `/api/*` functions, never n8n or Google
  Sheets directly. Server-only Monitoring APIs use the Google service account.
- Vercel validates the Supabase access token and active `profiles` row before any
  clinical action. Roles are `doctor` and `admin`; both have immutable `doctor_id`.
- `user.doctor_id` is canonical patient ownership. Doctors see and approve only
  matching rows; admins see all and can invite, disable, or reassign.
- Monitor patient CRUD uses reversible deletion: update `user.user_status` to
  `disabled`, keep all linked Sheet rows, and allow reactivation to `active`.
  Never hard-delete clinical rows through the portal.
- `weekly_schedule` is the canonical recurring-plan source. Monitoring responses
  include source rows in `nudges`, generated delivery/history rows in
  `schedule_nudges`, and active canonical rows in `weekly_schedule`. Once any
  canonical row/tombstone exists, never infer the current week from sent or dated
  delivery rows.
- **Prescription CRUD is direct-Sheets, never n8n.** `api/prescription.js` →
  `_lib/prescription-store.js` → `_lib/clinical-data.js`. Workflow A owns intake;
  every correction after that belongs to the clinician, because the LLM parse is a
  draft. Create is **atomic**: the `prescriptions` row, one source `nudges` row and
  its `schedule_state` row are appended in one `batchWrite`, so a new prescription
  is schedulable immediately and a failed batch leaves nothing behind. A
  prescription with no source nudge is unschedulable by construction — never add
  one alone. All IDs are server-generated; the client may never supply
  `prescription_id`, `nudge_id` or `doctor_id`. A prescription inherits `doctor_id`
  from its patient, so an admin acting on another clinician's patient does not
  rewrite ownership — but note there is no `created_by` column, so which admin
  acted is not recorded.
- **Prescription archive is a reversible cascade.** `status → archived`, its
  `weekly_schedule` rows → `inactive`, its unsent future approved `schd_` nudges and
  their `schedule_state` rows → `rejected`; sent history is preserved.
  **Reactivation restores only the prescription, never its schedule** — the week
  must be rebuilt and re-approved, and the UI says so. Archived prescriptions leave
  `patient.prescriptions` *and* `patient.nudges` (they move to
  `archived_prescriptions`) so `seedWeekFromNudges` cannot rebuild a week from an
  archived plan, but they stay in `prescriptionById` so legacy `target_behavior`
  still resolves. `saveSchedule` refuses to approve a slot on an archived
  prescription; rejection still works.
- Prescription mutations re-seed the week, discarding unsaved slots, so the trace
  card's Edit/Archive/Reactivate/Add controls are **disabled while
  `state.scheduleDirty`**.
- Treat E.164 phone numbers as unique patient identifiers at the API boundary.
  Duplicate intake must not write. The intake page must not download JSON; it
  shows a duplicate-phone dialog offering a different number or the existing
  patient's Monitor edit view only when the signed-in clinician is authorized to
  see that patient.
- Intake must ignore any forged browser doctor ID and inject ownership from the
  authenticated profile. Admins may explicitly choose another active clinician.
- Workflow A requires `x-n8n-proxy-secret`; Workflow E is no longer called. Never expose
  `N8N_BASE_URL`, `N8N_PROXY_SECRET`, or `SUPABASE_SERVICE_ROLE_KEY` in frontend code.
  Also never expose `GOOGLE_SERVICE_ACCOUNT_EMAIL` or
  `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` to browser code.
- Workflow A keeps strict enum validation, but its `Normalize Known Enum Drift`
  node deterministically repairs narrow Gemini errors in `category`: case and
  spacing drift, and a leftover retired action token emitted in that field.
  Unknown values still reject the entire batch before any Sheet write. The node
  never rewrites `action_text`.
- Supabase setup and Sheet migration are documented in
  `docs/AUTH_AND_SHEETS_MIGRATION.md`.
- Supabase's built-in SMTP is limited to two auth emails per hour across the
  project. Configure custom SMTP before multi-user testing; do not present a 429
  reset response as though an email was sent.
- `index.html` must forward Supabase `invite` and `recovery` URL fragments to
  `set-password.html` without altering them. This covers emails that return to
  the configured Site URL instead of the requested redirect path.

## Hard constraints
- **Flat JSON only.** The schema (`lifestyle_nudging_schema.json`) has five flat
  layers: user, questionnaire, prescriptions, nudges, schedule_state. Deep nesting
  breaks n8n Set/IF/Code nodes. Never introduce nested objects.
- **Structured enumerations, no free text** for every taxonomy value. These are the
  locked enums; they live on the *behaviour*, not on the prescription:
  - Six pillars: nutrition, physical_activity, sleep, stress_management,
    substance_use, social_connection
  - Five categories: increase, reduce, maintain, avoid, establish
  - Four nudge types (see schema)
  - `target_behavior` is RETIRED. It is no longer written; it survives only so
    legacy rows migrate. Do not reintroduce a fixed action catalogue. The Monitor
    trace card's "Target behaviour" step is a UI label for the clinician's
    free-text `action_text` list — it is not a revival of this enum.
  - Barrier enum (feedback layer): stress, fatigue, time, goal_too_hard,
    life_event, environment, social, other
  - Progress responses (Workflow C): DONE, IN_PROGRESS, NOT_YET; legacy SKIP is
    normalized to NOT_YET. STOP remains the mandatory ethics opt-out and halts
    all future sends immediately.
  - Two-stage responses: `commitment_response` is YES / NO / NO_FEEDBACK and
    `outcome_response` is DONE / NOT_YET / NO_FEEDBACK. They are **separate
    columns and must stay separate** — a YES that later goes unanswered is a
    different research observation from a NO. NO_FEEDBACK means a window closed
    unanswered and must never be written as NOT_YET.
  - The only free-text fields the LLM may populate are the nudge message body and
    the nudge `action_text` draft.
- **A target behaviour is the triple `(action_text, pillar, category)`, owned by the
  row that carries it** — a weekly slot or a source nudge, never the prescription.
  `action_text` is clinician free text: required on source nudges, weekly slots and
  dated nudges; trimmed, non-empty, max 1024 chars. `pillar` and `category` stay
  locked enums but sit beside it on the same row, so **one prescription may span
  several pillars** — a doctor's note is not a single behaviour. Materialization
  copies the whole triple to every dated delivery, so Workflow B's row is
  self-describing. The server checks each field against its enum independently and
  rejects a slot whose source row belongs to a different prescription; it does
  **not** require a slot to agree with its prescription. Only a clinician may change
  an action: Workflow D's gate restores the stored value and its Sheets writer does
  not map the column. See `docs/BEHAVIOUR_TAXONOMY_MIGRATION.md`, and
  `docs/ACTION_TAXONOMY_MIGRATION.md` for the legacy token → label conversion.
- **`prescriptions.pillar` / `.category` are defaults, not a lock.** They seed a new
  behaviour and are the read-path fallback for a row whose own value is blank —
  which after the migration means `category` only, since `pillar` is populated on
  every live row. Every prescription field is editable at any time; changing a
  default touches no existing behaviour and triggers no cascade. Precedence is
  defined once, in `ReviewState.behaviourTaxonomy`, and used by both `collectActions`
  and `slotFromNudge` so the trace card and the schedule cannot drift. **Never invert
  it**: prescription-first would overwrite each slot's own pillar on every reload and
  persist it on the next save.
- **The clinician curates a per-prescription behaviour list in the Monitor trace
  card** ("Target behaviour": add, rename, re-file, delete — one merged step; there
  is no separate "Taxonomy" step). It is a *client-side view* over the live weekly
  slots plus unsaved additions — derived, never stored. There is no behaviour CRUD
  endpoint, so a behaviour reaches Sheets only by being attached to a slot and saved;
  one that is never scheduled does not survive reload, and the UI says so
  (`not scheduled`). Deleting is blocked while any slot still uses it. Identity is
  compared trimmed and case-insensitively, and every operation is scoped by
  `prescription_id` — two prescriptions may legitimately carry identical action text.
  Rows disagreeing about one behaviour are surfaced as `mixed`, never silently
  arbitrated. Pure logic lives in `landing/review-state.js` (`behaviourTaxonomy`,
  `collectActions`, `actionTexts`, `findBehaviour`, `applyActionTaxonomy`,
  `countActionSlots`, `applyActionRename`, `validateActionEdit`) so it is unit-tested
  in Node.
- **The weekly slot picks a behaviour; it does not retype one.** The slot's Action is
  a `<select>` over the prescription's list, and picking adopts the whole triple. A
  stored action missing from the list is pinned verbatim and preselected — without
  that, a `<select>` snaps to its first option and changes what the slot sends merely
  by being rendered. Rewording moved to the trace card, where it follows every slot.
- Blank-status defaults are deliberately opposite where they appear:
  `isArchivedPrescription` treats blank as *active* (fail open, so legacy rows stay
  visible). Any new blank-status default must justify its direction against that one.
- **`frequency_per_week` is advisory.** Only Workflow A range-checks it (1-7) at
  generation and Workflow D passes it to the LLM as context. Nothing requires the
  weekly slot count to match it, and live data does not. The trace card surfaces a
  mismatch as a warning chip — do not turn it into a hard gate.
- `prescriptions.status` gained `"archived"` in both schema copies. Workflow D still
  filters on strict `p.status === 'active'`, so a blank-status prescription is
  visible to the portal but invisible to adaptation. Latent, since D is not live.
- **Custom nudges attach to an explicitly selected prescription.** Never fall back
  to the "closest" match. The Add-nudge dialog picks its behaviour from that
  prescription's curated list rather than accepting free text, and shows the
  *behaviour's* pillar and category rather than the prescription's.
- **Validation gate is mandatory:** after the LLM call, a Code node must validate
  output against the enumerations and reject anything outside them before writing
  to Sheets. This gate is an academically documented design decision.
- Phone numbers: E.164 format (+614…), no spaces.
- LLM provider: Gemini API free tier for now, but keep the contract model-agnostic
  (input: prescription text + user profile; output: JSON conforming to schema).
  Demand JSON-only output in the prompt.

## WhatsApp provider strategy

### Current development path: Twilio Sandbox
- Use `workflow_b_delivery_twilio.json`; do not overwrite or repurpose the Meta
  Workflow B.
- Sandbox sender: `whatsapp:+14155238886`.
- The tester must join the Sandbox and keep the 24-hour customer-service window
  open. Workflow B sends the quick-reply Content Template identified by
  `TWILIO_CONTENT_SID`.
- The bounded prototype workflow is active every five minutes in
  `Australia/Melbourne`. It sends only generated `schd_` rows within the current
  five-minute window, preventing source-row duplicates and overdue backlog flushes.
- Required env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_FROM`, and `GOOGLE_SHEETS_SPREADSHEET_ID`.
- Before production, move authentication into an n8n credential, use an approved
  Twilio Content Template for business-initiated messages, add delivery-status
  callbacks, and migrate Workflow C to Twilio payloads/signature validation.

### Preserved Meta path
- `workflow_b_delivery.json` remains the Meta WhatsApp Cloud API version. Keep it
  intact until the production provider decision is made.
- Meta env vars remain `WHATSAPP_TOKEN`, `PHONE_NUMBER_ID`, `WABA_ID`, and
  `VERIFY_TOKEN`. A permanent production token comes from a Meta System User.

## Verified development state (2026-07-27)
- Separate n8n workflow imported as **Workflow B — Nudge Delivery (Twilio)**.
- Live n8n-originated Sandbox send succeeded; Twilio Message SID
  `SM8434a80f5c08ea5082f6869a1c245f03` reached status `read` with no error.
- The matching `nudges` row was updated to `sent` and the same SID was written to
  `schedule_state.wa_message_id`.
- Historical only: Workflow E previously read the live Sheet and completed a
  bounded approval. It is now archived and must not be restored as the portal
  data layer.
- Sheet (single canonical spreadsheet, used by development and production alike):
  `https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit`
  Tabs: `user`, `weekly_schedule`, `questionnaire`, `prescriptions`, `nudges`,
  `schedule_state`.
- This proves outbound Sandbox delivery, Sheet write-back, review reads, and
  approval expansion. It does not prove production templates, scheduled delivery,
  inbound replies, or STOP handling.

## Railway deployment state (2026-07-28)

- The always-on n8n instance is the official `n8nio/n8n:latest` image at
  `https://n8n-production-beb2c.up.railway.app`.
- Railway volume `n8n-volume` is mounted at `/home/node/.n8n`. Keep both
  `RAILWAY_RUN_UID=0` and `N8N_USER_FOLDER=/home/node`; without the latter, n8n
  reads an empty `/root/.n8n` database.
- The migrated database contains six workflows and the original encrypted
  credential. Workflow E is archived; keep it that way. Workflow A and the
  selected delivery/feedback workflows remain the n8n runtime surface.
- `N8N_PORT=5678`, `N8N_PROTOCOL=https`, `N8N_WEBHOOK_URL`, `WEBHOOK_URL`, and
  `N8N_EDITOR_BASE_URL` point at the Railway HTTPS origin. Timezone remains
  `Australia/Melbourne`.
- Vercel `N8N_BASE_URL` now points to Railway in production, preview, and
  development. The production alias is `https://whatsapp-nudging-system.vercel.app`.
- Verified: `/healthz` returns 200, and the production portal serves Monitoring
  from Google Sheets directly. The old protected review webhook is retired; a
  request to it now correctly returns "not registered".
- Keep local Docker n8n stopped while Railway is active to prevent duplicate
  Workflow B schedule execution. See `docs/RAILWAY_DEPLOYMENT.md`.

## Build order (test-first, in this sequence)
1. **Implemented locally:** Twilio Workflow B quick-reply Content Template send
   with Melbourne Schedule Trigger, `sent` update, and Message SID write-back.
2. **Implemented locally:** Workflow C parses Twilio `From`, `Body`, `ButtonText`,
   `ButtonPayload`, `MessageSid`, and `OriginalRepliedMessageSid`; import it and
   verify `DONE` / `IN_PROGRESS` / `NOT_YET` / `STOP` end to end.
3. **Signature validation done** — `/api/whatsapp-inbound` verifies every inbound
   request against `TWILIO_AUTH_TOKEN` before anything is written. Delivery-status
   callbacks remain outstanding.
4. **Done and live in production:** direct-Sheets Monitoring CRUD and
   approval-to-dated-schedule expansion (commit `605bf4f`, merged via PR #2).
   Service-account variables are set in Production; Workflow E is archived.
5. Create the quick-reply Content Template for Sandbox and obtain WhatsApp
   approval for production-initiated delivery.
6. Confirm institutional account ownership, ethics, consent, privacy, and incident
   handling before enrolling real participants.
7. **Done for the bounded prototype:** Melbourne Schedule Trigger with a narrow
   five-minute window; do not treat this as production messaging readiness.
8. Add streak counters, reflective variants, Workflow D adaptation, and the weekly
   summary in that order.

## Cheap wins (build these; each is < half a day)
- **Streak/adherence counters** in schedule_state (done_count, skip_count,
  current_streak, last_response_at). Pure Code-node arithmetic; feeds the
  reflective rule, Workflow D, and the evaluation chapter.
- **Reflective nudge variant:** rule = streak just broke after ≥7 adherent days →
  send autonomy-supportive pre-written variant ("You were consistent for X days —
  what changed?") instead of the standard reminder. No LLM. Maps to SDT.
- **Frequency back-off rule:** 3 consecutive SKIP/ignored on a nudge → halve its
  frequency until Workflow D re-plans. Prevents nudge fatigue; JITAI-aligned.
- **Reply→nudge correlation:** WhatsApp webhook payloads include the replied-to
  message ID (context.id). Store the WhatsApp message ID when sending in B; match
  it in C so every feedback row links to a specific nudge_id. Essential for the
  evaluation metrics, nearly free to implement.
- **Tone variants for evaluation:** at intake, generate each nudge body in 2 tones
  (e.g. encouraging vs neutral-informational), alternate sends, log which tone the
  user responds to; Workflow D uses the winner. Free at generation time, gives the
  thesis a personalisation-effect measurement.
- **Weekly summary message:** rule-computed adherence recap ("5/7 this week"),
  sent via template or open window. SDT competence support; zero LLM.
- **Evaluation logging:** every send/reply row carries timestamp, delivery status,
  response latency. Columns only — but they ARE the results section.

## Style preferences
- Concise. No redundancy. Consolidate rather than repeat.
- When generating anything academic-adjacent (comments, README, docs), map to the
  research framing above.
- Document non-obvious decisions briefly — they feed the thesis design chapter.
