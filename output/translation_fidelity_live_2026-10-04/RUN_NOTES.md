# Run notes: live translation fidelity, first run (4 October 2026)

**Protocol.** `scripts/translation-trace/FIDELITY_PROTOCOL.md` (SHA-256 `2b89e841…`) with gold labels in `fidelity-cases.js` (`d81c0960…`). Both were hashed at 09:02:59 UTC, before the runner was written and before any call. One dry run went to a scratch folder first, as the protocol allows; it is not reported.

**Calls.** 36 calls to `gemini-2.5-flash` between 09:04:49 and 09:08:54 UTC.

- Every response has a `responseId`, also stored in the rows as `translation_response_id`.
- Only synthetic prescription texts and synthetic patient details were sent.
- The key was read from the git-ignored `n8n.env` and appears in no output file (scanned).

## Runner pacing defect

Calls were spaced 7 seconds apart. The free tier allows 5 requests per minute per model: every 429 names `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` with `quotaValue` 5.

As declared, the 13 calls refused with HTTP 429 and one with HTTP 503 were not retried. As a result:

- F12 received no response;
- F08–F11 received one each;
- M9 (consistency) could only be judged for the seven texts with at least two responses.

`FIDELITY_AMENDMENT_1.md` (hashed at 09:09:50 UTC, before any further call) completes only those 14 calls at a slower pace. Its results are in `../translation_fidelity_live_2026-10-04_completion/`. This run is kept unchanged.

## What this run shows (REPORT.md)

- **Gate.** All 22 responses passed the intake gate.
- **Taxonomy.** Against the author's gold labels:
  - pillar 23/24; category 19/24 exact, 23/24 counting the declared alternatives;
  - frequency 23/24; duration 23/24.
- **Wrong pillar.** F09 ("Avoid sugary soft drinks") was classed as `substance_use`, not `nutrition`. The gate cannot catch this; it is left to clinician review, and if corrected, the revision history keeps the LLM's value.
- **Draft count.** Twice (F04-r2, F05-r3) the model wrote fewer drafts than its own `frequency_per_week`. The gate accepted both, as the translation trace predicted for case A25: the count rule is enforced only by the prompt.
- **Consistency.** The seven texts with two or more responses received identical labels each time.
- **Full chain.** All 11 chains run on real output closed.
