# Adaptive media migration

This project searches media from the behaviour-owned triple `(action_text, pillar, category)`. It never includes patient identity, questionnaire answers, or raw prescription text in provider queries.

## Data migration

1. Apply `supabase/migrations/001_clinician_auth.sql`, then `002_adaptive_media.sql` to the new Sydney Supabase project.
2. Run `node scripts/migrate-adaptive-sheet.mjs` with the new Sheet service-account variables. The script is idempotent: it appends missing columns to `nudges`, `weekly_schedule`, and `schedule_state`, then creates the three append-only audit tabs.
3. Set `ADAPTIVE_MEDIA_ENABLED=true` only after both migrations succeed.

Supabase is authoritative for search jobs, candidate metadata, approved envelopes, interaction processing, link tokens, and current adaptive state. Google Sheets remains the clinical schedule and receives append-only media-assignment, interaction, and decision exports.

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

## Acceptance boundary

`read` means Twilio reported a provider read state; missing means unknown. Link visits and replies are interactions. None of these fields is adherence or a health outcome. An automatic change is allowed only inside the clinician-approved envelope; an outside-envelope request is recorded without changing the plan.
