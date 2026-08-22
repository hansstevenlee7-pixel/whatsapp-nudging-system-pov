# System POV project handoff

## Purpose

This is the independent system-POV fork of the WhatsApp nudging prototype. Preserve the existing clinician workflow and UI. It adds taxonomy-driven media discovery and explainable adaptation inside a clinician-approved envelope. Delivery, reads, links, and replies are observable system events, never adherence outcomes.

## Architecture

1. Workflow A creates prescription and draft nudge rows.
2. The authenticated Vercel Monitor reads and writes Google Sheets directly.
3. The clinician edits and approves a recurring schedule.
4. Workflow B selects due generated rows and submits a send-only Content Template to Twilio.
5. Twilio calls the signed public `/api/whatsapp-status` endpoint.
6. The endpoint appends `delivery_events` and updates the matching `schedule_state` row.
7. Workflow C searches trusted media and processes queued interaction events outside the callback path.
8. Workflow B asks the signed preparation endpoint for one approved, rotated resource immediately before sending.
9. The Monitor presents delivery, media, and request-fulfilment traces.

`POST /api/whatsapp-inbound` validates signed Twilio requests, processes `STOP` immediately, and stores ordinary replies exactly once for asynchronous interpretation.

## Non-negotiable boundaries

- No patient response data is an adherence outcome.
- `delivered` and `read` are provider states, not evidence a behaviour occurred.
- Do not add an LLM to delivery or callback paths; Gemini is allowed only in asynchronous discovery/classification workers.
- Never adapt outside a clinician-approved envelope or infer adherence from system events.
- Do not restore the old commitment, barrier, or outcome workflows. Workflow C in this fork is adaptive media only.
- Do not point this fork at the current production Vercel project or Sheet.
- Never commit credentials, `.env` files, `.vercel`, service-account JSON, or local n8n state.
- Preserve sent records and append-only delivery events.

## Verification

Run `npm test` and `npm run check` from `landing`. Local success does not establish live delivery. Live verification requires one controlled message and evidence across Workflow B, Twilio SID/status, `schedule_state`, `delivery_events`, and the Monitor timeline.

Deployment and migration details are in `docs/SYSTEM_POV_MIGRATION.md`.
