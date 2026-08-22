# AI-Powered Personalised Lifestyle Nudging System

**Monash University FIT5126 — Master's Research**
Supervisor: David Taniar | Student: Steven Lee Hans

---

## Research Context

Most preventive health failures are not knowledge failures — people generally know what to do. The gap is **behavioural**: converting a clinical recommendation into consistent real-world action. This system targets the *intention–action gap* (also framed in the thesis as the *integration gap*) by translating a doctor's lifestyle prescription into a schedule of personalised, adaptive nudges delivered over WhatsApp.

Theoretical grounding:
- **COM-B** — barriers are Capability/Opportunity deficits; the system identifies and adapts to them rather than simply pushing motivation.
- **JITAI** (Just-In-Time Adaptive Intervention) — nudges are tailored and timed to the user's current context.
- **Self-Determination Theory** — feedback is autonomy-supportive and reflective, not guilt-inducing.

Methodology: Design Science Research (DSR). The novel contribution is the *adaptive personalisation framework*; the LLM is a component, not the contribution.

---

## System Architecture

```
INPUT → INTERPRETATION → ACTION GENERATION → NUDGE → FEEDBACK → ADAPT
```

| Stage | Description |
|---|---|
| **Input** | Authenticated doctor's free-text lifestyle prescription → n8n → Google Sheets |
| **Interpretation + Action Generation** | Single LLM call at intake: parses prescription into canonical objects and expands them into a full dated schedule of pre-written nudge messages |
| **Nudge** | n8n reads due nudges and sends through the selected provider. Twilio Sandbox is the active development path; the Meta version is preserved separately. |
| **Feedback** | Twilio quick-reply buttons capture `DONE`, `IN_PROGRESS`, and `NOT_YET`; typed replies remain supported and `STOP` opts out immediately. |
| **Adapt** | Weekly cron feeds the LLM the prescription + feedback history + barrier tags + adherence stats → regenerates next week's schedule (intensity, frequency, timing, tone) |

**LLM rule — batch-only.** The LLM runs at exactly two points: prescription intake (Workflow A) and weekly adaptation (Workflow D). It never runs in the delivery or reply path.

### n8n Workflows

| Workflow | Trigger | Responsibility |
|---|---|---|
| **A — Intake** | Protected POST webhook (`/intake`) | Authenticated Vercel API injects doctor ownership → Gemini **vision** parse of Rx → validation gate → write all 5 layers |
| **B — Meta Delivery** | Preserved version | `workflow_b_delivery.json`; retained unchanged for the possible Meta production path |
| **B — Twilio Delivery** | Every 5 minutes (`Australia/Melbourne`) | `workflow_b_delivery_twilio.json`; send an approved quick-reply Content Template for generated rows due in the current five-minute window → mark sent + store `wa_message_id` |
| **C — Feedback** | Twilio WhatsApp webhook | Prefer button payloads, accept typed fallbacks, update progress idempotently, send confirmations, open the barrier flow on `NOT_YET`, and honour `STOP` immediately |
| **D — Adaptation** | Weekly cron | Aggregate feedback + barriers + streaks → LLM re-plans next week → validation gate → overwrite upcoming rows |
| **E — Review** | Protected review, approve, assignment webhooks | Sheet join; doctor-scoped Vercel API; validates and expands approved weekly slots; supports admin patient reassignment |

---

## Data Schema

See `lifestyle_nudging_schema.json` for the full JSON Schema definition.

Five flat layers (no nested objects — required for n8n Set/IF/Code node compatibility):

| Layer | Purpose |
|---|---|
| `user` | Patient profile, contact, and canonical primary `doctor_id` ownership |
| `questionnaire` | Baseline lifestyle assessment |
| `prescriptions` | Canonical prescription objects — the doctor's note. Its `pillar × category` are the defaults a new target behaviour starts from, not a lock: one prescription may span pillars |
| `nudges` | Pre-written messages with scheduled date/time, plus the target behaviour this delivery commits the patient to — `action_text × pillar × category` |
| `schedule_state` | Delivery status, outbound `wa_message_id`, deduplication `response_wa_id`, patient responses, barrier tags, and streak counters |
| `inbound_messages` | Append-only log of every inbound reply, written *before* it is interpreted. A log, not state — it exists so an unresolved reply still leaves a record, and so response latency (`received_at` − `sent_at`) is measurable |

Controlled enumerations (locked, and carried by the **behaviour** rather than the prescription):
- **Pillars (6):** `nutrition`, `physical_activity`, `sleep`, `stress_management`, `substance_use`, `social_connection`
- **Categories (5):** `increase`, `reduce`, `maintain`, `avoid`, `establish`
- **Nudge types (4):** `reminder`, `reflection`, `challenge`, `affirmation`
- **Tone variants (2):** `encouraging`, `neutral_informational`
- **Progress responses:** `DONE`, `IN_PROGRESS`, `NOT_YET`; legacy typed `SKIP` is normalized to `NOT_YET`
- **Opt-out:** `STOP` is mandatory and halts all future sends immediately
- **Barrier tags (8):** `stress`, `fatigue`, `time`, `goal_too_hard`, `life_event`, `environment`, `social`, `other`

Deliberately **not** enumerated: `action_text`, the concrete step the patient performs.
It is drafted by the LLM at intake, revised freely by the clinician at review, and held
per recurring weekly slot, so one prescription may carry different actions on different
weekdays. Weekly adaptation can change wording, timing, tone, and nudge type — never the
action. The retired fixed-action enum (`target_behavior`) survives only to migrate old
rows; see `docs/ACTION_TAXONOMY_MIGRATION.md`.

A validation gate (n8n Code node) rejects any LLM output that violates these enumerations
before writing to Sheets. `action_text` passes the same gate on presence and length.

---

## WhatsApp Delivery

### Current development path: Twilio Sandbox

- Workflow: `workflows/workflow_b_delivery_twilio.json`
- Sender: `whatsapp:+14155238886`
- The recipient must join the Sandbox and open the 24-hour service window.
- The workflow sends the `twilio/quick-reply` Content Template configured by
  `TWILIO_CONTENT_SID`, with Done, In progress, and Not yet buttons. It remains
  active on a five-minute Melbourne schedule and ignores overdue backlogs.
- Verified on 2026-07-27: an n8n-originated message reached Twilio status `read`;
  the nudge became `sent`, and its SID was written to
  `schedule_state.wa_message_id`.

Workflow C now parses Twilio button and typed replies, but this remains a
development proof. Before participant use, add `response_wa_id` to the live
`schedule_state` Sheet, configure the inbound webhook, validate Twilio request
signatures, add delivery callbacks, approve the Content Template, and resolve
ethics/consent/account-ownership decisions.

### Preserved Meta path

`workflows/workflow_b_delivery.json` remains the separate Meta WhatsApp Cloud API
implementation. Do not overwrite it while Twilio is used for development.

---

## Build Order

1. **Done:** Twilio Workflow B scheduled Sandbox send + Sheet status/SID write-back
2. **Implemented locally:** Twilio Workflow C for DONE / IN_PROGRESS / NOT_YET / STOP; import, configure, and test it end to end
3. Add Twilio signature validation and delivery-status callbacks
4. **Done:** complete the all-patient review backend and approval-to-schedule expansion
5. Approve the production Twilio Content Template and settle research ownership,
   ethics, consent, privacy, and incident handling
6. **Done for the bounded prototype:** activate Melbourne-time scheduling with a
   five-minute delivery window; production templates and callbacks remain gates
7. Add streak rules, reflective variants, **Workflow D**, and weekly summaries

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `WHATSAPP_TOKEN` | Meta System User permanent token |
| `PHONE_NUMBER_ID` | WhatsApp sender phone number ID |
| `WABA_ID` | WhatsApp Business Account ID |
| `VERIFY_TOKEN` | Webhook verification secret |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier for the active Sandbox path |
| `TWILIO_AUTH_TOKEN` | Twilio API secret; keep only in the gitignored local env |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp sender, currently `whatsapp:+14155238886` |
| `TWILIO_CONTENT_SID` | `twilio/quick-reply` Content Template SID used by Workflow B; approval is required for production-initiated messages outside the 24-hour window |
| `GEMINI_API_KEY` | Gemini API (free tier) |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Target spreadsheet |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account for Sheets access |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Service account private key |
| `N8N_WEBHOOK_URL` | n8n instance base URL |
| `N8N_API_KEY` | n8n API key |
| `N8N_BASE_URL` | Server-side n8n base URL used by Vercel; never exposed to browsers |
| `N8N_PROXY_SECRET` | Shared Vercel-to-n8n webhook secret |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public Auth API key returned by `/api/config` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for profiles and invitations |
| `PUBLIC_APP_URL` | Production portal origin used in invitation redirects |

> **Note:** The Meta API Setup token expires ~24 h. Use a System User permanent token for production. If sends return 401, this is the first thing to check.

## Always-on n8n hosting

The active n8n instance is deployed from the official `n8nio/n8n:latest` image on
Railway at `https://n8n-production-beb2c.up.railway.app`. Its persistent volume is
mounted at `/home/node/.n8n`; `N8N_USER_FOLDER=/home/node` is mandatory because
Railway runs this non-root image with `RAILWAY_RUN_UID=0` for volume access.

Railway uses `N8N_PORT=5678`, HTTPS webhook/editor URLs, and
`Australia/Melbourne` for both `GENERIC_TIMEZONE` and `TZ`. Vercel's server-only
`N8N_BASE_URL` points to the Railway origin. Keep the same `N8N_ENCRYPTION_KEY`
when moving an existing database or stored credentials cannot be decrypted.

Deployment, migration, verification, and rollback details are in
`docs/RAILWAY_DEPLOYMENT.md`. Do not run the local Docker scheduler at the same
time as Railway: active Workflow B instances would both send due Twilio rows.

## Clinician authentication

The public landing page is separate from the invitation-only clinician portal.
Supabase provides email/password accounts and immutable clinician identities.
Vercel APIs validate active roles and patient ownership before forwarding requests
to secret-protected n8n webhooks. The monitor provides patient read/update,
reversible disable/reactivate (soft delete), schedule editing, and approval.
For approved patients it reloads active generated `schd_` rows from Google
Sheets rather than rebuilding the editor from the original source-row time;
approval writes are followed by an immediate Sheet refetch.
Phone numbers are unique: duplicate intake is rejected and, when authorized, the
doctor sees a choice to enter a different number or open the existing patient in
Monitor. Intake submits directly to the protected API and does not download a
local JSON file. Admins can invite/disable
accounts and reassign patients; doctors cannot see or approve another doctor's patient. Setup and Sheet
migration instructions are in `docs/AUTH_AND_SHEETS_MIGRATION.md`.

Password reset email depends on Supabase Auth email delivery. Its built-in
prototype mailer permits only two auth emails per hour project-wide; configure
custom SMTP before clinician testing. The UI reports HTTP 429 honestly and the
set-password page shows expired or invalid-link errors instead of a dead form.

---

## Research Framing

This system is a *behaviour change system that happens to use LLMs*, not an LLM application looking for a problem. The system is designed as a closed loop:

```
Observe (feedback) → Interpret (barrier tagging) → Intervene (adapted nudge) → Measure (adherence) → Adapt (weekly re-plan)
```

This contrasts with existing habit trackers, which are open-loop logging systems (goal → reminder → ignore → repeat).

**Research question:** Can adaptive scheduled nudging (barrier-aware, weekly re-planned) outperform static reminders on adherence and engagement?

Evaluation metrics: adherence rate, response rate, barrier-resolution over time, per-user adaptation trace.
