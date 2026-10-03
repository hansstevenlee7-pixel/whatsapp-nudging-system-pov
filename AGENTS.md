# AGENTS.md — AI-Powered Personalised Lifestyle Nudging System

## What this project is
Research prototype for Monash FIT5126 (Master's research, supervisor: David Taniar).
A closed-loop system that converts a **real doctor's lifestyle prescription** into a
schedule of personalised behavioural nudges delivered via **WhatsApp**, with user
feedback adapting future nudges.

Thesis framing: addresses the "integration gap" between behavioural guidance and
real-world execution. Grounded in COM-B, JITAI, Self-Determination Theory.
Methodology: Design Science Research. The novelty is the adaptive personalisation
framework — the LLM is a component, not the contribution.

## Architecture (do not deviate without flagging it)
Pipeline: INPUT → INTERPRETATION → ACTION GENERATION → NUDGE → FEEDBACK

1. **INPUT** — doctor's free-text prescription arrives (Google Form → Google Sheets).
2. **INTERPRETATION + ACTION GENERATION (the only LLM step)** — ONE LLM call at
   prescription intake parses free text into canonical prescription objects and
   expands them into a full dated schedule of pre-written nudge messages.
   The LLM NEVER runs in the delivery path.
3. **NUDGE** — n8n Schedule Trigger (cron) reads due rows from Google Sheets and
   sends via **Meta WhatsApp Cloud API direct** (NO Twilio, NO BSP).
4. **FEEDBACK** — user WhatsApp replies arrive via Meta webhook → n8n → feedback
   tab in Sheets. Replies reset the free 24-hour service window.

n8n workflows:
- **Workflow A (intake):** Sheets trigger → LLM call → validation gate → write schedule rows
- **Workflow B (delivery):** cron → read due nudges → WhatsApp send → mark sent
- **Workflow C (feedback):** WhatsApp webhook trigger → parse reply → append feedback

## Hard constraints
- **Flat JSON only.** The schema (`lifestyle_nudging_schema.json`) has five flat
  layers: user, questionnaire, prescriptions, nudges, schedule_state. Deep nesting
  breaks n8n Set/IF/Code nodes. Never introduce nested objects.
- **Structured enumerations, no free text** in prescription objects:
  - Six pillars: nutrition, physical_activity, sleep, stress_management,
    substance_use, social_connection
  - Five categories: increase, reduce, maintain, avoid, establish
  - Four nudge types (see schema)
  - The ONLY free-text field the LLM may populate is the nudge message body.
- **Validation gate is mandatory:** after the LLM call, a Code node must validate
  output against the enumerations and reject anything outside them before writing
  to Sheets. This gate is an academically documented design decision.
- Phone numbers: E.164 format (+614…), no spaces.
- LLM provider: Gemini API free tier for now, but keep the contract model-agnostic
  (input: prescription text + user profile; output: JSON conforming to schema).
  Demand JSON-only output in the prompt.

## WhatsApp Cloud API specifics
- Direct Meta Cloud API. Dev uses the free test number (max 5 verified recipients).
- Business-initiated messages outside a 24-h window MUST be approved templates.
  Production template: `health_plan_reminder`, category **Utility** (US$0.0113/msg
  to AU numbers), body: "Reminder from your health plan: {{1}}. Reply DONE when
  completed, or SKIP to skip today." LLM nudge text goes into {{1}}.
- Free-form sends are allowed (and free) inside an open 24-h service window.
- Permanent token comes from a Meta System User (the API Setup token expires ~24 h
  — if sends suddenly 401, this is why).
- Env vars (never hardcode, never commit): WHATSAPP_TOKEN, PHONE_NUMBER_ID,
  WABA_ID, VERIFY_TOKEN, GEMINI_API_KEY.

## Build order (test-first, in this sequence)
1. Workflow B with **Manual Trigger** + hand-filled Sheets rows + hello_world template
2. Free-form sends inside an open window (text the test number first to open it)
3. Workflow A: Gemini prescription parsing + validation gate
4. Swap Manual Trigger → Schedule Trigger
5. Workflow C feedback webhook
6. Submit utility template for approval (early — review takes up to 48 h)

## Style preferences
- Concise. No redundancy. Consolidate rather than repeat.
- When generating anything academic-adjacent (comments, README, docs), map to the
  research framing above.
- Document non-obvious decisions briefly — they feed the thesis design chapter.
