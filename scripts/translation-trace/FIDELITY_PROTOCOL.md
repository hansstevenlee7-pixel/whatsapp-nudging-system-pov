# Live LLM translation fidelity: protocol v1

Written on 4 October 2026 before any live call. Hans authorised the live Gemini calls the same day. The runner records this file's SHA-256 and the SHA-256 of `fidelity-cases.js` (the gold labels) in its manifest.

## Why

The translation-to-feedback trace (`PROTOCOL.md`) used authored LLM responses. It tests the system *around* the LLM, not what the deployed model actually produces. This protocol sends synthetic prescription texts through the same harness, but makes a real call to the model Workflow A names. It measures:

1. whether real outputs pass the intake gate;
2. how closely they map to the locked taxonomy and the requested frequency and duration;
3. whether they keep Workflow A's own prompt rules;
4. how consistent repeated calls are;
5. whether a real output closes the full chain from text to adapted next message.

## What runs

- The harness of `PROTOCOL.md`, unchanged. The portal intake API calls Workflow A, whose *Build Gemini Prompt* node builds the prompt exactly as deployed.
- *Call Gemini Vision* is the one live request. It goes to `generativelanguage.googleapis.com` with the model, temperature (0.4), output limits and response type that *Build Gemini Prompt* sets. Any other outbound request still fails the run.
- The key is read from the git-ignored `n8n.env` and is never printed or stored. Recorded request URLs show `key=[redacted]`.
- **Inputs:** the 12 synthetic prescription texts and gold labels in `fidelity-cases.js`. The patient details are synthetic. No real person's data is sent.
- **Calls:** each text is sent 3 times, 36 calls in all, at least 7 seconds apart.
  - Hard cap: 45 attempts. Zero retries.
  - A failed or quota-limited call is recorded as such and not replaced.
  - If the quota stops the run, the results cover only the calls made.

Every response is saved verbatim (candidates, `modelVersion`, `responseId`, usage metadata) and passes through *Normalize Known Enum Drift* and the *Validation Gate*.

## Gold labels

Each text has gold prescriptions: pillar, category, `frequency_per_week` and `duration_weeks`. `frequency_per_week` means reminders per week, the number of drafts the prompt asks for. Where a category or frequency is genuinely ambiguous, acceptable alternatives are declared here, before the run. These labels are the author's, not a clinician's; that is a stated limitation.

**Matching:**

- Each gold prescription is matched to at most one output prescription with the same pillar, preferring the same category.
- Unmatched gold prescriptions are misses.
- Unmatched output prescriptions are extras.

## Measures (per call, then per text and overall)

| Measure | Definition |
|---|---|
| M1 Call | HTTP 200 with a candidate |
| M2 Gate | Accepted, normalised-then-accepted, or refused (with stage). Refused calls write no row |
| M3 Count | Number of output prescriptions equals the gold count |
| M4 Pillar | Matched gold prescriptions with the gold pillar, over all gold prescriptions |
| M5 Category | Exact, and exact or a declared alternative |
| M6 Frequency | Exact, and exact or a declared alternative |
| M7 Duration | Exact |
| M8 Prompt rules | Per accepted call: draft count equals each prescription's `frequency_per_week`; every date within week 1; dates distinct within a prescription; `action_text` at most 120 characters; both message bodies at most 180 characters |
| M9 Consistency | Per text, whether all successful calls produce the same pillar, category, frequency and duration set |
| M10 Chain | For the first accepted call of each text, the `PROTOCOL.md` Part B chain (approve unchanged, reply "Send fewer messages"), with chain closure and link coverage T1–T19 |

Action wording is reported verbatim for inspection, not scored.

## Criteria

Descriptive only, except that no row may be written for a refused call. A model or prompt change suggested by these results is out of scope here and would need its own protocol.

## Before the live run

To debug the runner without spending calls, one dry run was allowed into a scratch folder. It replaced the live call with a response built from the gold labels. Its results are not reported.
