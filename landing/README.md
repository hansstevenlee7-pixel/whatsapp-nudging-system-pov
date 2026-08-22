# Clinician portal — System POV

This Vercel application retains the existing authenticated patient, prescription, behaviour, scheduling, and approval interface. It adds a read-only system delivery view and exposes two Twilio-signed public endpoints:

- `/api/whatsapp-status` records outbound provider status callbacks.
- `/api/whatsapp-inbound` handles `STOP` only; other replies are ignored.

Required server environment variables are documented in `../docs/SYSTEM_POV_MIGRATION.md`.

Run:

```sh
npm ci
npm test
npm run check
```
