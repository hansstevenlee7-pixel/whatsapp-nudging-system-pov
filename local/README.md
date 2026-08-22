# Running n8n locally (development)

Production-like always-on hosting now runs on Railway. See
`docs/RAILWAY_DEPLOYMENT.md`. This local setup is retained for isolated
development and rollback only; never leave its active Workflow B scheduler
running alongside Railway.

Runs n8n on your Mac in Docker with a public tunnel so the landing page and
provider webhooks can reach n8n. Twilio Sandbox is the current outbound
development path; the existing Meta workflows remain available separately.
This setup is not always-on and is not suitable for production participants.

## 1. Configure

```bash
cp local/n8n.env.example local/n8n.env
openssl rand -hex 16          # paste result into N8N_ENCRYPTION_KEY
```

Fill in `local/n8n.env` (gitignored). You can start with just the timezone +
encryption key and add the API keys as each workflow needs them.
Generate `N8N_PROXY_SECRET` with `openssl rand -hex 32`; the identical value must
be configured in Vercel. It is required by the intake, review, approval, and
patient-assignment webhooks.

## 2. Start

```bash
./local/run-n8n.sh
```

First run pulls the image. n8n prints a **tunnel URL** (e.g.
`https://abc123.hooks.n8n.cloud`) — note it; it **changes on every restart**.
Open the editor at **http://localhost:5678** and create the local owner account.

## 3. Import workflows

Workflows → **Import from File** → import the required files from
`workflows/*.json`.

There are two separate Workflow B files:

- `workflow_b_delivery_twilio.json` — active development version; Twilio Sandbox,
  Melbourne Schedule Trigger every five minutes and Twilio quick-reply Content messages.
- `workflow_b_delivery.json` — preserved Meta version; do not replace it with the
  Twilio workflow.

## 4. Credentials — Google Sheets (OAuth2)

The OAuth callback runs in your browser on localhost, so the tunnel URL does
**not** matter here.

1. Google Cloud Console → create an OAuth 2.0 Client (Web application).
2. Authorized redirect URI: `http://localhost:5678/rest/oauth2-credential/callback`
3. In n8n, create a **Google Sheets OAuth2** credential with that client ID/secret,
   click **Connect**, approve.
4. Assign the credential to **every** Google Sheets node in each imported workflow
   (they import with a placeholder credential).

## 5. Twilio Sandbox delivery test

1. Join the Sandbox from the recipient WhatsApp account.
2. Confirm `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_WHATSAPP_FROM=whatsapp:+14155238886`, and
   `GOOGLE_SHEETS_SPREADSHEET_ID` in `local/n8n.env`.
3. Import `workflow_b_delivery_twilio.json` and assign the Google Sheets OAuth2
   credential to every Sheets node.
4. Approve a generated `schd_` nudge for today within the next five minutes.
5. Keep n8n running and verify both Twilio delivery and these Sheet writes:
   `nudges.status=sent` and `schedule_state.wa_message_id=<Twilio Message SID>`.

The manual send was verified end to end on 2026-07-27. The bounded prototype now
polls every five minutes in `Australia/Melbourne`; it ignores source rows and
overdue backlogs. Production still requires an approved Content Template, status
callbacks, and inbound/STOP handling.

## 6. Wire the webhooks (use the tunnel URL)

Activate the workflow so its **production** path (`/webhook/...`) is live —
the `/webhook-test/...` path only works while you click "Listen".

- **Workflow C (WhatsApp replies, currently Meta only):** Meta dashboard →
  WhatsApp → Configuration → Webhooks. Callback
  `https://<tunnel>/webhook/whatsapp-webhook`, verify token = your
  `VERIFY_TOKEN`, subscribe to **messages**. Meta sends a GET with
  `hub.challenge` to verify — handle it (see the Workflow C sticky note).
- **Workflow A and E:** set the tunnel origin as Vercel's server-only
  `N8N_BASE_URL`. Browsers call Vercel `/api/*`; Vercel forwards intake, review,
approval, and assignment with `x-n8n-proxy-secret`. Keep A and E published while
testing the deployed portal.
Workflow E also handles patient detail updates and reversible disable/reactivate
through `/webhook/update-patient`; this route uses the same shared-secret gate.

Workflow C now expects Twilio inbound fields and quick-reply payloads. Before
activating it, add `response_wa_id` to `schedule_state`, import the updated JSON,
and configure the Sandbox inbound webhook. Add `X-Twilio-Signature` validation
before participant use.

## 7. Test order (per CLAUDE.md)

1. **Implemented locally:** Twilio Workflow B quick-reply Content Template send + Sheet status/SID updates.
2. **Done:** Workflow E all-patient read and bounded recurrence approval against
   the live Sheet.
3. **Workflow A** from a real landing-page payload.
4. Import and test Twilio **Workflow C**, including DONE / IN_PROGRESS / NOT_YET /
   STOP; signature validation remains a production gate.
5. Delivery-status callback and approved Content Template tests.
6. The bounded prototype Schedule Trigger is active; complete the production
   template/callback/STOP gates before participant use.

## Gotchas

- **Tunnel URL changes each restart** → re-enter the Meta callback URL each
  session. (A reserved ngrok domain avoids this, but it's paid.)
- **Twilio Sandbox is temporary:** every tester must join it, and free-form sends
  depend on the open 24-hour service window.
- Keep Twilio secrets out of workflow item data and committed files. Before
  production, store authentication in an n8n credential rather than constructing
  an Authorization header in the workflow.
- The built-in `--tunnel` is dev-only and can be flaky; fine for testing, not
  for production. The active always-on instance is Railway.
- Env vars in `local/n8n.env` are what the workflows' `$env.*` references read.
- A tunnel is still reachable from the internet. The shared-secret gates are
  mandatory even though the URL itself is no longer present in frontend code.
