# System POV migration and deployment boundary

## Create an independent data surface

Do not reuse the adaptive prototype's live Sheet or Vercel project. Copy the spreadsheet, use a dedicated sheet-scoped service account, and connect a new Vercel project only after local validation.

Add a `delivery_events` tab with this exact header row:

```text
event_id,event_at,wa_message_id,nudge_id,user_id,status,error_code,error_message,channel_to,raw_payload
```

The fork tolerates legacy feedback columns already present in copied tabs, but it neither requires nor writes them.

## Vercel variables

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_APP_URL`
- `N8N_BASE_URL`
- `N8N_PROXY_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

## Railway/n8n variables

- `GOOGLE_SHEETS_SPREADSHEET_ID`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- `TWILIO_SEND_ONLY_CONTENT_SID`
- `PORTAL_BASE_URL` — the new Vercel origin, without a trailing slash

Workflow B sends `StatusCallback=<PORTAL_BASE_URL>/api/whatsapp-status` on every Twilio request. Create and approve a send-only WhatsApp Content Template with two variables: recipient name and clinician-approved message text. Do not reuse the quick-reply or commitment templates from the adaptive prototype.

## Twilio safety webhook

Point the WhatsApp inbound webhook to:

```text
https://NEW_PROJECT_ORIGIN/api/whatsapp-inbound
```

The endpoint validates `X-Twilio-Signature`, ignores ordinary replies, and processes only `STOP` by setting `user.user_status=opted_out` and cancelling future unsent rows.

## Acceptance test

1. Create a dedicated test recipient in the copied Sheet.
2. Approve one nudge due within a controlled five-minute window.
3. Confirm Workflow B selects exactly that generated `schd_` row.
4. Confirm Twilio returns a Message SID and the row becomes queued or sent.
5. Confirm signed callbacks append `delivery_events` without duplicates.
6. Confirm `schedule_state` reaches delivered, read, failed, or undelivered.
7. Reload the Monitor and compare its timeline with Twilio.
8. Send `STOP`; confirm the user is opted out and future approved rows are canceled.

Do not describe the project as live-verified until all eight checks pass against the new deployment.
