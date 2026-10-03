# Bounded adaptation benchmark

## Run

From the System POV repository:

```sh
node --test landing/tests/adaptation-benchmark.test.js
node scripts/adaptation-benchmark/run.js --live --freeze-only
node scripts/adaptation-benchmark/run.js --live
node scripts/adaptation-benchmark/run.js --report-only
```

Default output: `output/adaptation_benchmark_2026-10-02`. For a separate experiment use `--out output/NAME`. Omitting `--live` runs only fixed and rules arms; that is explicitly incomplete and must use a different output directory. Existing traces are resumed, not overwritten. Source/configuration mismatch requires a new directory. Keep the original evidence.

Gemini credentials are read in memory from the existing environment/configuration using the existing frequency experiment loader. They are not copied into snapshots or logs. Only synthetic message text and synthetic action alternatives are sent to Gemini. No cloud schedule, Supabase, Sheets, Twilio send, or deployment is allowed by the runner's transport allowlist. Test-only credentials, database URLs and identifiers are installed temporarily. All other outbound requests are rejected.

## Frozen protocol

The primary comparison is hybrid versus rules-only **interpretation**, with the existing downstream logistic frequency policy held constant. The fixed arm records events but retains initial preferences and skips automatic policy evaluation. All arms use the same STOP, consent, resource approval and delivery logic.

There are 24 deliberately selected cases: 12 supported requests (four dimensions x three language forms), four no-change cases, four boundary/override cases, and four operational cases. `cases.js` is independent of application imports. Its labels derive from documented bounded adaptation requirements, not predictions. Unavailable video may fall back to approved paper; the request is not counted as a supported-request success. Ambiguous wording requires no inferred preference. Silent evidence may permit resource rotation, but cannot itself establish a preference or health adherence. Summary changes concern the resource summary, not arbitrary rewriting of the whole message.

`cases.json` freezes every case and initial local state. `manifest.json` freezes the model alias, temperature, Node version and source hashes before execution. Source snapshots include application code, the frozen frequency model, local adapter, runner and oracle. The application prompt and parser are unchanged. No test-case-driven prompt or rule tuning is permitted. Labels have not been independently adjudicated; this is a construct-validity limitation.

## Execution and scoring

A signed synthetic inbound callback runs through `whatsapp-inbound.js`; pending events run through `processInteraction`; the actual `frequencyWorker` applies timing/frequency changes; `prepareDelivery` produces the next message and reservation. Supabase store code runs against a minimal PostgREST emulator, while Sheets uses the application's existing test adapter. These adapters simulate storage, not cloud consistency/concurrency. No message is transmitted. A frozen clock makes event times reproducible; runtime latency uses a monotonic clock.

Task success requires every expected outcome and protection to pass, no thrown errors, and a complete trace. A recommended preference without an actual prepared/scheduled change does not pass. Every non-STOP case checks permitted resource, window, frequency, clinician override, audit links and preserved history. History protection permits legitimate inbound audit metadata updates but does not permit rewriting send time, delivered time, message SID or status. The first trace for each case supplies the primary table. Category counts, unnecessary changes, exact full interpretation matches and violations are reported separately. Brier score is not used because these are action/state outcomes, not probability forecasts.

Hybrid cases that actually invoke Gemini run three fresh times. The runner never substitutes cached model output for a new repetition. Zero automatic retries are used (within the allowed maximum of two); non-200 responses follow the real classifier's deterministic fallback. All failures remain visible. Pacing is at least 13 seconds between API attempts, timeout 45 seconds, global cap 60. The model alias is fixed; returned model version and usage are recorded when available. A pending request reservation survives interruption and consumes the budget. Requests interrupted before response capture are not represented as successful calls. Repetitions are not extra independent test cases. Costs are reported in tokens, not invented currency estimates.

`traces/` includes initial state, inbound result, interpretation, decision, policy evaluation, prepared message, step-by-step assertions, final stores and local database requests. `api-attempts.jsonl` contains synthetic requests and provider responses. `results.json`, `per_case.csv` and `REPORT.md` summarize evidence. Program failures in a completed evaluation are valid negative results; network failures must be distinguished from valid model interpretations.

## Acceptance and limitations

Research completion requires the frozen suite to run and all outcomes, including failures, to be reported. Artifact acceptance separately requires no failed mandatory scenarios and zero observed constraint violations. A negative result does not block research completion and must not be edited out. Unresolved uncertainty in an expected outcome must be excluded before execution and documented separately; no such cases are included in v1.

No public leaderboard or universal success threshold is claimed. The suite is small, synthetic, requirement-derived and authored by the implementer. No p-value, equivalence claim, real-user performance, clinical benefit, cloud persistence, delivery or production-safety claim follows. Shared downstream logic means this experiment isolates interpretation rather than proving model-free versus model-based system superiority. The report must explain cases where rules and hybrid coincide because the real hybrid classifier takes its deterministic fast path.

Method precedents: Hevner et al. (2004), https://doi.org/10.2307/25148625; Venable et al. (2016), https://doi.org/10.1057/ejis.2014.36; Nahum-Shani et al. (2018), https://doi.org/10.1007/s12160-016-9830-8; Yao et al. (2024), https://arxiv.org/abs/2406.12045. This is a custom benchmark inspired by final-state evaluation, not a run of tau-bench.
