# Adaptive media migration

This project searches media from the behaviour-owned triple `(action_text, pillar, category)`. It never includes patient identity, questionnaire answers, or raw prescription text in provider queries.

## Data migration

1. Apply `supabase/migrations/001_clinician_auth.sql`, `002_adaptive_media.sql`, `003_clinician_media_uploads.sql`, and `004_patient_adaptation_dictionary.sql` to the new Sydney Supabase project. The third migration creates the private clinician-media bucket; the fourth adds global fallback state and longitudinal decision snapshots.
2. Run `node scripts/migrate-adaptive-sheet.mjs` with the new Sheet service-account variables. The script is idempotent: it appends missing columns to the operational and audit tabs, then creates `patient_adaptation_state` and `patient_adaptation_timeline` for the dictionary export.
3. Set `ADAPTIVE_MEDIA_ENABLED=true` only after all migrations succeed.

The monitor opens on the current Melbourne Monday-to-Sunday week. Saving from a selected week sends `scope_week_start`; this updates only that week's unsent dated occurrences while the intake-generated recurring rows remain the baseline for later weeks. Any occurrence with delivery history stays immutable. Clinician uploads are private, must belong to an approved media envelope, and are attached only through signed URLs and tracked redirects. `CLINICIAN_MEDIA_BUCKET` is optional and defaults to `clinician-media`.

The clinician header includes `Populate media`. It queues one trusted search per behaviour triple. The Railway media worker then searches allowlisted YouTube channels and Europe PMC, and Gemini prepares validated plain-language paper summaries asynchronously. The button never sends patient identifiers or raw prescription text to search providers, and the proposed pool still requires one clinician approval.

Supabase is authoritative for search jobs, candidate metadata, approved envelopes, interaction processing, link tokens, and current adaptive state. Google Sheets remains the clinical schedule, receives append-only media-assignment, interaction, and decision exports, and maintains a current patient-state dictionary plus append-only timeline for research analysis.

## Trusted source configuration

- `YOUTUBE_API_KEY`
- `YOUTUBE_TRUSTED_CHANNEL_IDS` — comma-separated channel IDs; search is performed once per trusted channel.
- `GEMINI_API_KEY`
- `GEMINI_SUMMARY_MODEL` — defaults to `gemini-2.5-flash`, but remains configurable.

Europe PMC search requires no project API key. Only open-access results with abstracts enter the proposed pool. A failed summary never blocks the source: the verified title and URL remain, without generated prose.

## Railway workflows

- Import the updated Workflow B. It calls `/api/internal/prepare-delivery` before Twilio and receives either the original message or an idempotently prepared media message.
- Import and activate Workflow C after Vercel is reachable. It polls the signed discovery and adaptation endpoints every two minutes.
- Railway needs `PORTAL_BASE_URL` and the same `N8N_PROXY_SECRET` as Vercel.
- Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` on the isolated n8n service because the imported workflows resolve their signed endpoint and provider settings from Railway environment variables.
- Set `TWILIO_SANDBOX_MODE=true` only for the controlled Sandbox gate. Sandbox delivery uses a button-free free-form `Body` inside the participant-initiated 24-hour window because custom Content templates are not supported there. Registered senders leave this `false` and use `TWILIO_SEND_ONLY_CONTENT_SID`.

## Acceptance boundary

`read` means Twilio reported a provider read state; missing means unknown. Link visits and replies are interactions. None of these fields is adherence or a health outcome. An automatic change is allowed only inside the clinician-approved envelope; an outside-envelope request is recorded without changing the plan.

Run `node scripts/generate-adaptation-fixture.js` from the repository root to produce a deterministic, synthetic interaction trace for UI and adaptation testing. The fixture is labelled synthetic, performs no database writes, and covers read exposure, explicit format and length requests, an allowed later time, link visits, silence rotation, and guarded outside-envelope requests.
