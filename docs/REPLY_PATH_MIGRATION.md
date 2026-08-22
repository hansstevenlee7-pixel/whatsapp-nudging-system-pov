# Reply-path migration: Workflow C and F move into JS

The deterministic reply path leaves n8n. Patient replies now arrive at a Vercel
function, are recorded in an append-only log **before** they are interpreted, and
are then resolved and applied by ordinary tested JavaScript. Workflow F becomes a
two-node cron that calls the portal.

```text
before   Twilio ──► n8n /webhook/whatsapp-webhook ──► 31 nodes ──► Sheets
after    Twilio ──► /api/whatsapp-inbound ──► inbound_messages (log)
                                          └─► feedback-store ──► schedule_state

before   n8n cron ──► 16 nodes ──► Sheets
after    n8n cron ──► /api/followup-tick ──► followup-scheduler ──► schedule_state
```

This is the same move `docs/ACTION_TAXONOMY_MIGRATION.md`-era Workflow E made, and
it is documented as an architecture change in `CLAUDE.md`.

## Why

**1. A reply left no trace until it was successfully understood.** When a live
patient's Yes did not land, nothing in the study record showed whether Twilio had
delivered it. Diagnosis meant the Twilio console and the n8n execution list —
neither of which is data. Ingest-then-interpret fixes this permanently, and the
same table gives the evaluation chapter response latency
(`received_at − schedule_state.sent_at`) for free.

**2. The complexity sat where nothing could test it.** Workflow C was 31 nodes but
only **242 lines of JS**; the other **75 items were IF conditions and Sheets
column mappings**. The test suite extracted `jsCode` strings and ran them through
`Function()`, so those 75 were invisible. The bug found immediately before this
migration — the STOP cascade writing `commitment_response = NO_FEEDBACK` over an
already-answered `YES` — lived in a column mapping. Structural, not bad luck.

**3. Two copies of the reply vocabulary.** `COMMITMENT_MAP` and `OUTCOME_MAP` were
duplicated byte-for-byte between `landing/api/_lib/followup.js` and Workflow C's
`Classify Reply`, hand-synced. Now there is one.

## The migration — 1 tab

New Sheet tab **`inbound_messages`**, 17 columns, append-only:

```
inbound_id · received_at · from_phone · to_phone · wa_message_id · context_wa_id
body · button_text · button_payload · opt_out_type
user_id · matched_nudge_id · stage · classification · applied · note · raw_payload
```

`context_wa_id` is the load-bearing one: it holds Twilio's
`OriginalRepliedMessageSid`, which is what resolves a reply to **one nudge and one
stage** rather than guessing from recency. Without it logged, an unresolved reply
cannot be diagnosed after the fact.

It is a **log, not state**. `schedule_state` remains the state machine and the
only thing the schedulers read. Nothing reads `inbound_messages` at runtime, so it
is excluded from `loadClinicalData`'s default tab set.

Verify with the read-only `node scripts/verify-followup-migration.mjs`.

## What runs where now

| Piece | Lives in |
|---|---|
| `POST /api/whatsapp-inbound` | Vercel — public, Twilio-signature authenticated |
| `_lib/feedback-store.js` | parse → resolve → apply → confirm (was Workflow C) |
| `_lib/inbound-log.js` | the append-then-patch event log |
| `_lib/twilio.js` | signature validation + REST send |
| `POST /api/followup-tick` | Vercel — shared-secret authenticated |
| `_lib/followup-scheduler.js` | the tick's three jobs (was Workflow F) |
| Workflow F (2 nodes) | n8n — Schedule Trigger → HTTP Request, nothing else |

Workflows A, B and D are untouched. The clocks stay in n8n because Vercel's Hobby
tier caps cron at once per day and the two-stage window needs five-minute
resolution.

### One structural gain worth naming

Every write is now a read-modify-write of the **whole row** (`Object.assign` onto
the existing row), so a column the code does not mention keeps its value. n8n's
`defineBelow` mapping wrote every mapped column, which is exactly why a blank
expression there silently cleared stored data. **That failure mode cannot occur in
this shape.**

### Security

The inbound endpoint is necessarily public — Twilio cannot present a Supabase
token — so the **request signature is the authentication**: HMAC-SHA1 over the
full URL plus sorted POST fields, compared with `timingSafeEqual`. A request that
fails is rejected with 403 and **not logged**, because an unverified request is
not evidence a patient sent anything. This closes build-order step 3.

The signed URL is rebuilt from `x-forwarded-proto` / `x-forwarded-host`: Vercel
terminates TLS upstream, so `req.url` is a bare path and signing that would never
match what Twilio signed.

## Environment

Add to Vercel **Production**: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_FROM`, `TWILIO_OUTCOME_CONTENT_SID`, `FOLLOWUP_TICK_SECRET`.
`FOLLOWUP_OUTCOME_WINDOW_HOURS` is optional (defaults to 24).

Add to n8n (Railway): `PORTAL_BASE_URL`, `FOLLOWUP_TICK_SECRET` — the latter must
match Vercel's. Twilio credentials are no longer needed there for F.

`local/n8n.env` configures the **local Docker** n8n only; Railway and Vercel each
need their own copy.

## Cutover order

Nothing is destructive until step 3, and step 3 reverses in one field.

1. Add the `inbound_messages` tab. `clinical-data.js` asserts it, so this comes first.
2. Deploy. Nothing calls the new endpoints yet; Workflow C keeps running.
3. **Repoint the Twilio Sandbox webhook** to
   `https://whatsapp-nudging-system.vercel.app/api/whatsapp-inbound`.
   *Rollback: put the n8n URL back.*
4. Archive Workflow C in n8n. `workflows/workflow_c_feedback.json` stays in the
   repo as recoverable history, exactly as Workflow E is kept.
5. Import the 2-node Workflow F, set `PORTAL_BASE_URL` and `FOLLOWUP_TICK_SECRET`,
   activate. The 16-node original is preserved at
   `docs/archive/workflow_f_followup_n8n_native.json`.

## Verification

```bash
cd landing && npm test        # 159
cd landing && npm run check
node scripts/verify-followup-migration.mjs
node local/dev-server.js      # http://127.0.0.1:4010/simulator.html
```

The harness now calls the **real handlers** — it signs a Twilio-shaped body and
posts it to `/api/whatsapp-inbound`, and its tick calls `/api/followup-tick` — so
a local walkthrough exercises signature validation, the log and the resolver
rather than a local re-implementation. `/__sim/tick?at=…` can move the clock,
gated on `ALLOW_TICK_TIME_TRAVEL`, which no deployment sets.

A full local walkthrough, verified:

```
deliver              → awaiting_commitment, due 00:01
tap YES              → awaiting_followup, commit=YES, due STILL 00:01
tick before due      → sent=0
tick after due       → sent=1, followup_sent_at + followup_wa_id claimed
tick again           → sent=0
answer Done          → done, outcome=DONE, commit=YES preserved
inbound_messages     → 4 rows, including the two unmatched probes as
                       applied=FALSE note=no_match
```

Against production after step 3:

- A real Sandbox reply appears in `inbound_messages` **within seconds**, whether
  or not it resolved.
- `node scripts/watch-followup-state.mjs` reports no contract violations.
- Yes then STOP: `commitment_response` stays `YES`, `outcome_response` becomes
  `NO_FEEDBACK`.
- A replayed `MessageSid` adds a log row with `applied=FALSE, note=duplicate` and
  leaves `schedule_state` untouched.
