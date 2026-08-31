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
