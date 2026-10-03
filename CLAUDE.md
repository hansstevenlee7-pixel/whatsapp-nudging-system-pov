# System POV research handoff

Read `INSTRUCTIONS.md` before changing code, infrastructure, data, research language, or the clinician workflow. It is the canonical operating contract for this repository; this file is the short entry point for Claude Code and other coding agents.

## Purpose

This is the isolated **System POV** implementation of Hans Lee's Monash Master's research prototype. It converts clinician-approved lifestyle prescriptions into scheduled WhatsApp messages, supplies approved media, observes delivery and interaction events, and makes bounded, auditable changes to later messages.

The research acceptance outcome is **request fulfilled**:

```text
patient or clinician signal
  -> structured interpretation
  -> deterministic envelope validation
  -> recorded decision
  -> observable change to a subsequent message
```

Delivery, reads, link visits, replies, and their latencies are system exposure or interaction evidence. They are never adherence, behaviour completion, or clinical improvement.

## Hard boundaries

- Preserve the original `../Whatsapp Nudging System` project unchanged and paused for later PhD work.
- Work only in this isolated repository unless the user explicitly changes scope.
- Never expose taxonomy, prescription interpretation, or internal behaviour labels in the simplified Monitoring UI.
- Never run an LLM in delivery, status-callback, redirect, or immediate inbound-webhook paths.
- Never adapt outside the clinician-approved envelope.
- Missing read evidence is `unknown`, never `unread`.
- Silence can rotate approved media; it cannot reduce frequency or imply failure/non-adherence.
- `STOP` is immediate and prevents future sends and adaptation.
- Preserve sent history and append-only events. Edits affect future unsent occurrences only.
- Never commit credentials, `.env*`, `.vercel`, service-account JSON, or copied n8n state.

## Runtime map

- **Vercel:** clinician portal and APIs at `https://whatsapp-nudging-system-pov.vercel.app`.
- **Railway/n8n:** isolated intake, delivery, discovery, and adaptation workers.
- **Supabase (Sydney):** authentication plus operational media/adaptation state.
- **Google Sheets:** clinical schedule and idempotent research/audit exports.
- **Twilio Sandbox:** controlled WhatsApp delivery, signed callbacks, and inbound replies.

## Verification links

Use these saved links for future eye-checks. They were verified as reachable on 4 September 2026. Dashboard links require the relevant signed-in account. Do not paste credentials, secrets, full phone numbers, or health information into notes or screenshots.

**Important shared-infrastructure warning:** the Google Sheet ID below (`1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo`) is also referenced by the paused legacy `../Whatsapp Nudging System` project. It is therefore **not verified as an isolated System POV patient database**. Until a separate copy is provisioned and the deployed `GOOGLE_SHEETS_SPREADSHEET_ID` values are checked, treat this workbook as shared legacy infrastructure and do not use it as proof of repository isolation.

### Patient database and clinician UI

- Shared/legacy Patient Database reference (not verified isolated): https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit
- Backup created before cleanup (4 September 2026): https://docs.google.com/spreadsheets/d/1QFRCY38IjMdJ_gBVFcdwCMjxDdVVVpJUaXLmEnLZxgc/edit
- Clinician Monitor: https://whatsapp-nudging-system-pov.vercel.app/monitor.html
- Clinician sign-in: https://whatsapp-nudging-system-pov.vercel.app/login.html
- Patient intake: https://whatsapp-nudging-system-pov.vercel.app/input.html

Current Google Sheet contract in code: `user`, `questionnaire`, `prescriptions`, `nudges`, `weekly_schedule`, `schedule_state`, `delivery_events`, `media_assignments`, `interaction_events`, `adaptation_decisions`, `patient_adaptation_state`, and `patient_adaptation_timeline`.

Verified source-workbook tabs on 4 September 2026: `user`, `media_assignments`, `interaction_events`, `adaptation_decisions`, `patient_adaptation_state`, `media_pool`, `weekly_schedule`, `patient_adaptation_timeline`, `prescriptions`, `nudges`, `schedule_state`, and `inbound_messages`. The required `questionnaire` and `delivery_events` tabs were not present in that eye-check.

Cleanup candidates identified from the code trace: `media_pool` (superseded by Supabase `media_candidates`/`media_assets`) and `inbound_messages` (superseded by normalised `interaction_events`). They remain in the source workbook until the blocked browser edit can be completed; do not delete them from the backup.

Direct audit tabs:

- `media_pool`: https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit?gid=767588262#gid=767588262
- `interaction_events`: https://docs.google.com/spreadsheets/d/1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo/edit?gid=1599528909#gid=1599528909

### Authoritative media and interaction database (Supabase)

- Approved media URLs/assets (`media_assets`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17542?schema=public
- Discovered candidate URLs (`media_candidates`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17526?schema=public
- Media population jobs (`media_search_jobs`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17512?schema=public
- Normalised app-user interactions (`interaction_events`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17607?schema=public
- Adaptation decisions (`adaptation_decisions`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17623?schema=public
- Tracked redirect links and visits (`tracked_links`): https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor/17648?schema=public
- Supabase project/table-editor root: https://supabase.com/dashboard/project/dmvfudxhqcbusyircmsq/editor

### Delivery and workflow evidence

- Railway-hosted n8n: https://n8n-production-db630.up.railway.app/
- Twilio messaging logs: https://console.twilio.com/us1/monitor/logs/sms
- Public Vercel origin: https://whatsapp-nudging-system-pov.vercel.app/
- Source repository: https://github.com/hansstevenlee7-pixel/whatsapp-nudging-system-pov

For a single message, correlate `nudges.nudge_id` -> `schedule_state.wa_message_id` -> Twilio status -> Supabase `interaction_events` -> Supabase `adaptation_decisions` -> the subsequent schedule row. For media, also correlate `media_assignments.media_asset_id` -> `media_assets.asset_id` -> `tracked_links.asset_id`.

No isolated System POV patient-database link is currently verified. Provision a separate workbook, update the Vercel and Railway `GOOGLE_SHEETS_SPREADSHEET_ID` values, run a non-participant read/write verification, and replace the shared/legacy link above before participant use. The final local implementation baseline was not deployed at the thesis handoff, and live Workflow C/automatic schedule application were not demonstrated. Treat the Vercel, Railway, and Twilio links as inspection surfaces, not proof of current production behaviour.

Deploy from `landing`, never from the repository root. A root deployment can be `READY` while omitting the API functions. For `/api/internal/media-worker`, an unauthenticated `403 invalid_worker_secret` proves that the route exists; a `404` indicates the wrong deployment root.

## Before editing

1. Read `INSTRUCTIONS.md` and the relevant migration document.
2. Run `git status --short` and preserve unrelated or user-owned changes.
3. Confirm whether the claim being made is local, deployed, or live WhatsApp evidence.
4. Keep schema, migration, fixture, API, UI, workflow, and export changes aligned.

## Validation

```sh
cd landing
npm test
npm run check
```

Also run `git diff --check` from the repository root. Local tests do not prove live delivery. A live claim requires correlated evidence across the scheduled row, Twilio Message SID/status, Supabase/Sheets events, and the Monitor.

See `INSTRUCTIONS.md`, `docs/SYSTEM_POV_MIGRATION.md`, `docs/ADAPTIVE_MEDIA_MIGRATION.md`, and `docs/PATIENT_ADAPTATION_DATA_DICTIONARY.md`.
