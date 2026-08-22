# Two-stage nudge feedback — migration, templates, and deployment

Stage 1 asks **"Will you do this?"** (Yes / No) at nudge time. A Yes arms exactly
one delayed stage 2, **"Were you able to complete it?"** (Done / Not yet), sent
`followup_delay_hours` after the initial message was delivered.

## Why two stages

A single Done / Not yet prompt sent at nudge time measures *intention*, because
the patient has not had the opportunity to act yet. Splitting the exchange
separates intention (`commitment_response`) from execution (`outcome_response`),
which is the COM-B opportunity/capability gap the thesis is about. The two values
are never merged into one field: a YES that later goes unanswered is a materially
different observation from a NO, and a silence is not a self-reported failure.

Nothing here is an LLM call. Both stages are pre-written templates and
deterministic rules, so the batch-only LLM rule is unchanged.

---

## 1. Google Sheet migration (required before deploy)

`api/_lib/clinical-data.js` **asserts** these headers. Until they exist, every
Monitoring handler returns HTTP 500 naming the missing columns. That is
deliberate: `rowData()` writes only keys that have a header, so without the
assert a clinician's follow-up setting would silently vanish on save.

Add these columns to the canonical spreadsheet
(`1Z0FKM3bVxM1wiDrli3wperdmZmj9b0nFDjecTbVmqzo`). Order does not matter; spelling
does. Add them to the header row only — leave every existing cell untouched.

### `nudges` — add 2 columns
| Column | Value on existing rows |
|---|---|
| `followup_enabled` | leave blank (reads as off) |
| `followup_delay_hours` | leave blank |

### `weekly_schedule` — add 2 columns
| Column | Value on existing rows |
|---|---|
| `followup_enabled` | leave blank (reads as off) |
| `followup_delay_hours` | leave blank |

### `schedule_state` — add 11 columns
| Column | Value on existing rows |
|---|---|
| `parent_nudge_id` | leave blank |
| `delivered_at` | leave blank |
| `followup_enabled` | leave blank |
| `followup_delay_hours` | leave blank |
| `commitment_response` | leave blank |
| `commitment_responded_at` | leave blank |
| `followup_due_at` | leave blank |
| `followup_sent_at` | leave blank |
| `followup_wa_id` | leave blank |
| `outcome_response` | leave blank |
| `outcome_responded_at` | leave blank |

Blank is the correct value everywhere. A blank `followup_enabled` reads as off,
so every existing nudge keeps the current single-stage Done / In progress / Not
yet behaviour with no other change.

**No back-fill script is provided and none is needed.** Do not run
`seed-weekly-schedule.js`.

---

## 2. Twilio Content Templates (must be created manually)

Two new quick-reply templates are required. They cannot be created from this
repository — build them in the Twilio Console under **Messaging → Content
Template Builder**, then set the resulting SIDs as n8n environment variables.

### Template A — commitment (stage 1)

- **Name:** `nudge_commitment_check`
- **Type:** `twilio/quick-reply`
- **Language:** `en`
- **Body:**
  ```
  Hi {{1}} — {{2}}

  Will you do this?
  ```
- **Variables:** `{{1}}` patient name, `{{2}}` the clinician-approved nudge body
- **Buttons:** `Yes` (id `YES`), `No` (id `NO`)
- **Env var:** `TWILIO_COMMITMENT_CONTENT_SID`

### Template B — outcome check (stage 2)

- **Name:** `nudge_outcome_check`
- **Type:** `twilio/quick-reply`
- **Language:** `en`
- **Body:**
  ```
  Hi {{1}} — earlier you said you'd do this:

  {{2}}

  Were you able to complete it?
  ```
- **Variables:** `{{1}}` patient name, `{{2}}` the slot's `action_text`
- **Buttons:** `Done` (id `DONE`), `Not yet` (id `NOT_YET`)
- **Env var:** `TWILIO_OUTCOME_CONTENT_SID`

Both must be **submitted for WhatsApp approval** before any business-initiated
delivery outside the 24-hour customer-service window. In Sandbox they can be
tested in-session once the tester has joined and the window is open.

### Created templates (2026-08-10)

Both templates exist in the Twilio console. SIDs are identifiers, not secrets,
so they are recorded here the same way the spreadsheet ID is recorded in
`CLAUDE.md`.

| Template | SID | Env var |
|---|---|---|
| `nudge_commitment_check` | `HXec5cc1dd85f35bfe277910ea46ac87e8` | `TWILIO_COMMITMENT_CONTENT_SID` |
| `nudge_outcome_check` | `HX7b88b3fececb68a50019eb7b861eb29f` | `TWILIO_OUTCOME_CONTENT_SID` |

Both are `twilio/quick-reply`, English (EN), and currently show **WhatsApp
user-initiated: eligible** but **WhatsApp business-initiated: not yet approved**.
That is sufficient for Sandbox testing inside the 24-hour customer-service window
the tester opens by messaging the Sandbox. It is **not** sufficient for
production-initiated delivery — submit both for WhatsApp approval before any
scheduled nudge needs to reach a patient who has not messaged first.

This matters for the two-stage flow specifically: a stage-2 outcome check sent
4+ hours after the initial nudge can easily fall outside the window if the
patient never replied to anything in between. Until business-initiated approval
lands, keep test delays short and keep the window warm.

### Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `TWILIO_CONTENT_SID` | Workflow B | Single-stage Done / In progress / Not yet template. Required **only when a single-stage nudge is in the current batch**. |
| `TWILIO_COMMITMENT_CONTENT_SID` | Workflow B | Required **only when a two-stage nudge is in the current batch**. |
| `TWILIO_OUTCOME_CONTENT_SID` | Workflow F | Workflow F throws if it is missing. |
| `FOLLOWUP_OUTCOME_WINDOW_HOURS` | Workflow F | Optional, default `24`. How long stage 2 stays open before the silence is recorded as `NO_FEEDBACK`. |

Both Content SID checks in Workflow B are **conditional on what the batch
actually contains**. An all-two-stage batch never references the single-stage
template and is not blocked by a missing `TWILIO_CONTENT_SID`; an all-single-stage
batch is not blocked by a missing `TWILIO_COMMITMENT_CONTENT_SID`. A mixed batch
needs both. Account-level credentials (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_FROM`) stay unconditional.

The guard order is also a free diagnostic. Account credentials are checked first,
then `TWILIO_WHATSAPP_FROM`, then the template SIDs — so reaching a
"missing SID" error proves `$env` access works inside Code nodes and that only
that one variable is absent or malformed on the instance.

The button **ids** matter more than the labels: Twilio sends the id as
`ButtonPayload`, which Workflow C prefers. The visible label is accepted as a
fallback, and typing `yes` / `no` / `done` / `not yet` works too, so the flow
stays usable for anyone who cannot tap a button.

---

## 3. Workflow F — Outcome Follow-up Scheduler

New file: `workflows/workflow_f_followup.json`. It ships **inactive**.

It runs every 5 minutes in `Australia/Melbourne` and does three things:

1. **Sends due outcome checks** — `status=awaiting_followup`,
   `commitment_response=YES`, `followup_due_at <= now`, `followup_sent_at` empty,
   patient still `active`.
2. **Expires unanswered commitments** → `no_feedback` /
   `commitment_response=NO_FEEDBACK`.
3. **Expires unanswered outcomes** → `no_feedback` /
   `outcome_response=NO_FEEDBACK`.

### Why a separate workflow rather than folding it into B

Workflow B's responsibility is *clinician-approved dated nudges due now*. The
outcome check is neither approved content nor dated — it is a feedback event
whose timing derives from a delivery that already happened. Folding it into B
would make B read `schedule_state` as a second trigger source and would blur the
invariant the review portal depends on: **everything Workflow B sends was
approved by a clinician.** Workflow F writes only to `schedule_state` and never
creates a row in `nudges`; a test asserts this.

### Exactly-once delivery

`followup_sent_at` / `followup_wa_id` are the claim check. A row that has either
is skipped, so a duplicate or overlapping scheduler execution sends nothing.
Unlike Workflow B there is **no five-minute window** — a due follow-up stays
eligible until it is actually sent, so a missed tick delays it rather than
dropping it.

### Late Yes

`followup_due_at` is computed once by Workflow B from the delivery timestamp, not
from the moment the patient answers. A Yes arriving *after* the due time makes
the row eligible on the very next tick; a Yes arriving before it waits. This is
the whole reason the due time is not recomputed on reply.

---

## 4. State machine

```
approved
  ├─ followup_enabled = FALSE ──> sent ──> done | in_progress | not_yet   (unchanged)
  └─ followup_enabled = TRUE  ──> awaiting_commitment
         ├─ Yes ──────────> awaiting_followup ──> (Workflow F sends check)
         │                       ├─ Done ─────> done         outcome_response = DONE
         │                       ├─ Not yet ──> not_yet      outcome_response = NOT_YET  ──> barrier question
         │                       └─ silence ──> no_feedback  outcome_response = NO_FEEDBACK
         ├─ No ───────────> declined          followup_due_at cleared
         └─ silence ──────> no_feedback       commitment_response = NO_FEEDBACK
any open stage + STOP ──> opted_out, followup_due_at cleared, user_status = opted_out
```

`NO_FEEDBACK` is never `NOT_YET`. Silence is not a self-report, and merging them
would inflate the barrier data with people who simply never answered.

---

## 5. Local testing before deploying

A localhost harness runs the real Monitor, the real `/api/*` handlers, and the
real Workflow B/C/F Code nodes against an in-memory spreadsheet and a simulated
WhatsApp. It contacts no Google Sheets, Supabase, Twilio or n8n.

```bash
node local/dev-server.js
# Monitor    http://127.0.0.1:4010/monitor.html
# Simulator  http://127.0.0.1:4010/simulator.html
```

Log in with any email and password — auth is stubbed locally.

Suggested walkthrough:

1. **Monitor** → pick Ada Lovelace → expand a nudge in the week editor → turn
   **Send outcome follow-up** on → set **Ask after** to 4 hours → Approve.
   (Schedule it for tomorrow; a slot whose Melbourne time has already passed
   today is deliberately not materialized.)
2. **Simulator** → set the clock to tomorrow 09:00 → **Deliver due nudges**.
   The handset shows the commitment question with Yes / No.
3. Tap **Yes**. `schedule_state` moves to `awaiting_followup` and shows
   `followup_due_at` at 13:00.
4. **Run scheduler tick** — nothing happens, it is not due.
5. Advance the clock **+4h** → **Run scheduler tick**. The outcome check arrives
   with Done / Not yet.
6. Run the tick again — nothing is sent a second time.
7. Tap **Done**, or **Not yet** to see the barrier question.

Also worth exercising: tapping Yes twice (stays one follow-up), **No** (no check
ever), typed **STOP** (cancels every open stage, one confirmation), **STOP via
Twilio opt-out** (persisted, no confirmation), and advancing the clock past a due
time without replying (records `NO_FEEDBACK`).

Nothing persists — restart the server, or press **Reset sheet**, to start over.

---

## 6. Deployment checklist (Sandbox)

Do these in order. Steps 1–3 are manual and are **not** performed by this
repository.

- [ ] **1. Migrate the Sheet.** Add the 15 columns in section 1 (2 + 2 + 11).
      Verify with `node scripts/verify-followup-migration.mjs` — it is read-only
      and runs the same header asserts the live handlers do, so a pass means the
      portal will boot.
- [ ] **2. Create both Content Templates** (section 2) in the Twilio Console.
- [ ] **3. Set env vars in n8n:** `TWILIO_COMMITMENT_CONTENT_SID`,
      `TWILIO_OUTCOME_CONTENT_SID`, optionally `FOLLOWUP_OUTCOME_WINDOW_HOURS`.
- [ ] **4. Deploy the portal** (Vercel). No new Vercel env vars are required.
- [ ] **5. Re-import Workflow B** (`workflow_b_delivery_twilio.json`) and
      **Workflow C** (`workflow_c_feedback.json`). Re-attach the Google Sheets
      credential — every node ships with `REPLACE_AFTER_IMPORT`.
- [ ] **6. Import Workflow F** (`workflow_f_followup.json`) and attach the same
      credential. **Leave it inactive** until steps 1–3 are confirmed.
- [ ] **7. Join the Twilio Sandbox** from the test handset and keep the 24-hour
      window open.
- [ ] **8. Configure one test nudge** in the Monitor with the follow-up on and a
      **1-hour** delay, scheduled a few minutes ahead.
- [ ] **9. Activate Workflow F.** Confirm the initial message arrives with
      Yes / No.
- [ ] **10. Tap Yes.** Check `schedule_state`: `status=awaiting_followup`,
      `commitment_response=YES`, `followup_due_at` one hour ahead.
- [ ] **11. Wait for the outcome check.** Confirm it arrives once, with
      Done / Not yet, and that `followup_sent_at` and `followup_wa_id` are set.
- [ ] **12. Tap Done.** Confirm `outcome_response=DONE` and `status=done`.
- [ ] **13. Repeat with Not yet** and confirm the barrier question still works.
- [ ] **14. Test STOP** on a second nudge with an open commitment. Confirm the
      patient is opted out, every open row is cancelled, and no follow-up
      arrives afterwards.

Only after all of the above should Workflow D or any participant enrolment be
considered. Delivery-status callbacks (build order step 3) remain outstanding;
until they land, `delivered_at` stays blank and the due time anchors to
`sent_at`.
