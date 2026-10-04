# Fidelity protocol, amendment 1: completing calls lost to runner pacing

Written on 4 October 2026, after the first live run (`output/translation_fidelity_live_2026-10-04/`) and before any further call. The runner records this file's SHA-256.

## What happened

The protocol spaced calls at least 7 seconds apart (`MIN_INTERVAL_MS` in `fidelity-cases.js`), about 8.6 a minute. The provider's free tier allows 5 requests per minute per model. Every 429 response names the quota `GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, with `quotaValue` 5.

Of 36 calls:

- 22 returned;
- 13 were refused with HTTP 429 and one returned HTTP 503;
- text F12 received no response at all, and texts F08–F11 received one each.

The missing calls are a defect of the runner's pacing, not an outcome of the model.

## Amendment

- **Scope.** The 14 calls without a response, and only those, are made once more. Each keeps its text, repetition number and gold labels; the prompt, model settings and harness are unchanged.
- **Pacing and retries.** Calls are at least 13 seconds apart (under 5 a minute). The cap is 14 attempts, still with zero retries; a call that fails again stays failed.
- **Chains.** The full chain (M10) is run for any text that had no accepted output in the first run.
- **Records.** The first run is kept unchanged. The completion run goes to `output/translation_fidelity_live_2026-10-04_completion/`.
- **Reporting.** Results are reported three ways: the first run alone, the completion run alone, and combined. The combined view uses the first run's response where one exists and the completion run's response otherwise. Every combined figure is labelled as such.

No gold label, measure, matching rule or criterion changes.
