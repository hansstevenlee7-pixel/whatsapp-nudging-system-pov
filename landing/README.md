# Clinician portal — System POV

This Vercel application retains the existing authenticated patient, prescription, behaviour, scheduling, and approval interface. It adds system delivery and adaptive-media views, plus two Twilio-signed public endpoints:

- `/api/whatsapp-status` records outbound provider status callbacks.
- `/api/whatsapp-inbound` handles `STOP` immediately and stores ordinary replies idempotently for asynchronous interpretation.

The consolidated `/api/adaptive` function stays within Vercel Hobby limits and is exposed through rewrites for plan approval, signed workers, delivery preparation, and tracked links. See `../docs/ADAPTIVE_MEDIA_MIGRATION.md`.

Required server environment variables are documented in `../docs/SYSTEM_POV_MIGRATION.md`.

Run:

```sh
npm ci
npm test
npm run check
```
