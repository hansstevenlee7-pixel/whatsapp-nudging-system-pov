# Clinician portal

Static HTML frontend plus Vercel serverless APIs for the INPUT and human-review
stages. The public landing page remains open; all clinical pages require an
invitation-only Supabase account.

## Pages

- `index.html` — public navigation hub.
- `login.html`, `forgot-password.html`, `set-password.html` — email/password lifecycle.
- `input.html` — protected patient intake; ownership comes from the signed-in clinician.
- `monitor.html` — protected, automatically loaded doctor-scoped patient read/update,
  reversible disable/reactivate, schedule editing, and approval.
- `admin.html` — admin-only account invitations, disabling, roles, and patient assignment.

## Security boundary

Browsers call only `/api/*` on the same Vercel origin. Every protected API checks
the Supabase bearer token, active profile, role, and patient ownership. Monitoring
APIs access Google Sheets with a server-only service account; credentials are never
sent to the browser. Workflow A intake still calls n8n with `N8N_PROXY_SECRET`.
A doctor-supplied `doctor_id` is ignored and replaced by the authenticated profile's
immutable value.

Patient phone numbers are unique in E.164 format. `/api/intake` rejects a
duplicate with HTTP 409 and only returns the existing `user_id` when the caller
is authorized to access that patient. `/api/patient` updates patient details;
soft delete uses `user_status=disabled`, never removal of linked Sheet rows.

Required Vercel variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_APP_URL`, `N8N_BASE_URL`,
`N8N_PROXY_SECRET`, `GOOGLE_SHEETS_SPREADSHEET_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
Share the spreadsheet with the service-account email as an editor. Store the private
key with escaped newlines (`\\n`) or as a multiline Vercel secret.

## Local validation

```bash
cd landing
npm test
npm run check
```

Use `vercel dev` for end-to-end local testing against real services, because
plain static file servers do not run the `/api` functions.

To exercise the two-stage nudge feedback flow without any live service, run the
localhost harness from the repository root instead:

```bash
node local/dev-server.js
# Monitor    http://127.0.0.1:4010/monitor.html
# Simulator  http://127.0.0.1:4010/simulator.html
```

It serves these pages and the real `/api/*` handlers against an in-memory
spreadsheet, and drives the real Workflow B/C/F Code nodes with a simulated
WhatsApp and a settable clock. No Google Sheets, Supabase, Twilio or n8n is
contacted and nothing persists. See `docs/TWO_STAGE_FEEDBACK.md`.

The linked Vercel project's Root Directory is `landing/`. Keep
`landing/lifestyle_nudging_schema.json` byte-identical to the canonical schema.
