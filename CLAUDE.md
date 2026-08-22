# System POV project handoff

## Purpose

This is the independent send-and-observe fork of the WhatsApp nudging prototype. Preserve the existing clinician workflow and UI. The research boundary ends at auditable provider delivery state; do not reintroduce adherence, commitment, barrier, follow-up, or adaptive scheduling features.

## Architecture

1. Workflow A creates prescription and draft nudge rows.
2. The authenticated Vercel Monitor reads and writes Google Sheets directly.
3. The clinician edits and approves a recurring schedule.
4. Workflow B selects due generated rows and submits a send-only Content Template to Twilio.
5. Twilio calls the signed public `/api/whatsapp-status` endpoint.
6. The endpoint appends `delivery_events` and updates the matching `schedule_state` row.
7. The Monitor presents those rows as the system delivery view.

`POST /api/whatsapp-inbound` is safety-only: it accepts signed Twilio requests, ignores ordinary replies, and processes only `STOP`.

## Non-negotiable boundaries

- No patient response data is an adherence outcome.
- `delivered` and `read` are provider states, not evidence a behaviour occurred.
- Do not add an LLM to delivery or callback paths.
- Do not restore Workflows C, D, E, or F in this project.
- Do not point this fork at the current production Vercel project or Sheet.
- Never commit credentials, `.env` files, `.vercel`, service-account JSON, or local n8n state.
- Preserve sent records and append-only delivery events.

## Verification

Run `npm test` and `npm run check` from `landing`. Local success does not establish live delivery. Live verification requires one controlled message and evidence across Workflow B, Twilio SID/status, `schedule_state`, `delivery_events`, and the Monitor timeline.

Deployment and migration details are in `docs/SYSTEM_POV_MIGRATION.md`.
