# Fidelity protocol, amendment 2: completing the remaining calls with a second key

Written on 4 October 2026, after the completion run (`output/translation_fidelity_live_2026-10-04_completion/`) and before any further call. The runner records this file's SHA-256.

## What happened

Under amendment 1, 12 of the 14 repeated calls were refused. The refusal named the daily free-tier quota of the first key's project (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue` 20). Still without a response:

- F03-r3, F04-r3 and F06-r3;
- F08-r2, F08-r3, F09-r2 and F09-r3;
- F10-r1 and F11-r2;
- F12-r1, F12-r2 and F12-r3.

## Amendment

Hans authorised this on 4 October 2026.

- **Key.** These 12 calls, and only these, are made once more with the second Gemini key in the git-ignored `n8n.env`: the second `GEMINI_API_KEY` line. Neither key is printed or stored. The manifest records only which line was used.
- **Unchanged.** Model, prompt, settings, harness, texts, repetition numbers, gold labels, measures and matching rules all stay the same. Free-tier quotas apply per project, so the second key may belong to a different quota pool; the provider's own quota messages will show this.
- **Pacing and retries.** Calls are at least 13 seconds apart. The cap is 12 attempts, with zero retries; a call that fails again stays failed.
- **Chains.** The full chain (M10) is run for any text that still had no accepted output.
- **Records.** Earlier runs are kept unchanged. This run goes to `output/translation_fidelity_live_2026-10-04_completion2/`.
- **Combined view.** The earliest response for each call is used: first run, then amendment 1, then amendment 2. It is reported with each source labelled.

No gold label, measure, matching rule or criterion changes.
