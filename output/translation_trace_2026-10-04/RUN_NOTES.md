# Run notes: translation-trace v1 (4 October 2026)

This is the recorded first run of `scripts/translation-trace/PROTOCOL.md` (SHA-256 `39fca63e…`, hashed before any harness code was written). `results.json` reproduces byte for byte: a second run produced the same SHA-256, `5555da7a…`.

## Harness debugging before this run

Two debug runs went to a scratch folder before this one. They changed harness mechanics only; the protocol, cases and expected outcomes did not change, and the protocol hash is the same.

1. The first harness called `processInteraction` directly and ran the frequency worker two minutes after the reply. At that point no 24-hour window had closed, so the worker step was vacuous ("idle"). The harness now matches the protocol's "the adaptation worker runs, then the frequency worker" and the deployed Workflow C cadence:
   - it calls the real adaptation worker endpoint, routing its WhatsApp acknowledgement to the Twilio stand-in;
   - it ticks both workers just after the reply and again just after the first delivery's 24-hour window closes, interleaving due deliveries in time order.
2. Report formatting only.

The harness's own checks are in `landing/tests/translation-trace-harness.test.js`:

- Melbourne time across the daylight-saving change;
- n8n expressions;
- Workflow A routing and no writes on refusal;
- link checks that fail on a planted broken link.

## What this run found (details in REPORT.md)

- **Part A.** 22 of 28 verdicts agree. Refused intakes wrote 0 rows, so the mandatory criterion holds. Six contract violations were silently accepted:
  - A20, A21: a draft whose `prescription_ref` names no prescription is linked to the first prescription by fallback. The link is fabricated.
  - A22: a prescription with no draft is written, so its chain never starts.
  - A23–A25: week-1 date, distinct-date and count rules are enforced by the prompt only.
- **Part B.** 6 of 6 chains close from the last delivered message back to the submitted text. 15 of 18 link types are complete; three are absent or partial:
  - T2: no stored row names the translating model or prompt version (0/7);
  - T6: the approved schedule does not record which clinician approved it (0/14). The envelope approval does (T8, 8/8);
  - T7: a clinician's correction of a prescription field overwrites the LLM's value (B4: category `reduce` → `increase` leaves no trace of `reduce`). Draft-level edits keep the LLM text (3/3).
- **Defects visible only in the full chain:**
  - The first explicit frequency request is computed from the envelope minimum, not the approved plan, because nothing initialises `preferred_frequency` (`adaptive-core.js` `insideEnvelope`). "Send fewer messages" at 3 a week was refused as outside the envelope (B1, B3, B4). "Send more messages" at 2 a week was recorded as applied with a target of 2, so nothing changed (B6), although the patient was told "your request will be used". The benchmark did not see this because its seed sets `preferred_frequency`.
  - That acknowledgement is also sent after an ordinary reply ("Thanks, done!", B2), because a routine media rotation counts as an applied decision.
