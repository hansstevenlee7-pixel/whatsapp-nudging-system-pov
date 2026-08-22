# WhatsApp Nudging System — System POV

Monash Master's research prototype for converting clinician-approved lifestyle prescriptions into scheduled WhatsApp nudges and observing the delivery system's behaviour.

## Scope

```text
Prescription → clinician review → approved weekly schedule → Twilio send
                                                          ↓
                         scheduled → queued → sent → delivered/read/failed
```

This project evaluates system reliability and traceability. It does not collect progress, commitment, barriers, or adherence, and it does not adapt future schedules from patient replies. A Twilio-signed inbound endpoint remains only so `STOP` can immediately opt a recipient out.

## Runtime

- Vercel hosts the authenticated clinician portal and same-origin APIs.
- Google Sheets stores patients, prescriptions, approved schedules, current delivery state, and append-only delivery events.
- Railway-hosted n8n runs Workflow A for intake and Workflow B for scheduled Twilio delivery.
- Twilio posts signed status callbacks to `/api/whatsapp-status`.

Active workflows:

- `workflows/workflow_a_intake.json`
- `workflows/workflow_b_delivery_twilio.json`

Feedback, follow-up, adaptation, Meta delivery, and retired review workflows were intentionally removed from this fork. Their complete history remains in the original `Whatsapp Nudging System` project and in this repository's baseline commit `134f5d8`.

## Local validation

```sh
cd landing
npm ci
npm test
npm run check
```

See `docs/SYSTEM_POV_MIGRATION.md` before connecting a Sheet, Twilio account, Railway service, or Vercel project.
