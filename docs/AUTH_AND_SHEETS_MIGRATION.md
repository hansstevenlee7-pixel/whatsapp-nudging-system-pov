# Authentication and Google Sheets migration

## 1. Supabase

The prototype project currently runs in South Asia (Mumbai). The migration in
`supabase/migrations/001_clinician_auth.sql` has been applied, public signup is
disabled, and the production `set-password.html` redirect is allowed. Reassess
institutional data-residency requirements before real participant use.

Run `scripts/bootstrap-admins.mjs` once to invite:

- Hans Lee — `hlee0189@student.monash.edu`
- David Taniar — `david.taniar@monash.edu`

Invitations establish each password and generate an immutable `doctor_id`.

Configure custom SMTP under Authentication → Emails → SMTP Settings before
clinician testing. Supabase's built-in provider allows only two auth emails per
hour for the whole project, so invitations and password recovery otherwise
interfere with each other.

Keep the public Site URL pointed at the production origin. The landing page
forwards Supabase `invite` and `recovery` fragments to `set-password.html`, so
older or provider-normalized links that return to `/` still reach password setup.

## 2. Google Sheets

Add a `doctor_id` column to the `user` tab. Do not rename or reorder existing
headers. After Hans's profile exists, assign both current rows to his generated
doctor ID through `admin.html`:

- `ec9b32bd-5224-4fcc-a642-692a4e98ff72` (Hans)
- `unit_20260727_codex_002` (UNIT TEST Alice Walker)

The user row is canonical ownership. `prescriptions.doctor_id` remains the
prescriber recorded when the prescription was created and is not rewritten when
an administrator transfers a patient.

The existing `user_status` column is also the reversible-delete flag. The monitor
sets it to `disabled` and keeps every linked row; reactivation sets it back to
`active`. Do not remove patient rows from Sheets. Phone values must be unique and
stored in E.164 form (for example `+61412345678`).

## 3. n8n

Set the same random `N8N_PROXY_SECRET` in local n8n and Vercel for Workflow A.
Workflow E is retired: authenticated Vercel APIs now read and update the Monitoring
tabs directly through a Google service account. Configure
`GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` in Vercel, then share the spreadsheet with
the service-account email as an editor.

Direct Workflow A calls without `x-n8n-proxy-secret` must fail. Do not put n8n or
Google service-account secrets into tracked frontend JavaScript.

## 4. Acceptance check

Hans must see both migrated patients. David must see all patients because he is
an administrator, but a newly invited doctor with no assignments must see zero.
A doctor must receive HTTP 403 when attempting to approve another doctor's
patient, even if the browser payload is manually altered.
Duplicate intake must return HTTP 409 without writing new rows. A clinician who
owns the existing patient is redirected to the monitor editor; a different
doctor receives no patient identifier. Disable and reactivate must preserve all
prescription, nudge, and schedule rows.
