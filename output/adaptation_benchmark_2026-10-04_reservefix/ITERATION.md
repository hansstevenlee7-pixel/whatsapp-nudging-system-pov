# Reserved-occurrence iteration (4 October 2026)

Local synthetic run of the fixed and rules arms; no WhatsApp send, deployment, cloud write or Gemini call. Earlier runs are retained unchanged (`../adaptation_benchmark_2026-10-02_repaired/`, `_postfix/`, `_tracefix/`).

## Why

Thesis §4.6 carried the marker "add explicit multi-behaviour and reserved-occurrence assertions before claiming complete isolation". No existing test covered either. `landing/tests/schedule-isolation.test.js` adds both:

1. A patient with two behaviours (sleep, walking) has the sleep behaviour reduced from two to one message a week by `applyAdaptiveSchedule`. The walking behaviour's slots, dated occurrences and delivery-state rows must be unchanged apart from bookkeeping timestamps (`updated_at`, `reviewed_at`, `last_updated`) and the derived `week_number`.
2. Two sleep occurrences are reserved exactly as `prepareDelivery` reserves them (delivery state `sending`, selected media, tracked link and selection decision on the nudge row): one on the slot the decrease keeps, one on the slot it removes. Both rows must come through unchanged.

## Finding

Against the committed code (`9be955e`), test 1 passed and test 2 failed (`isolation_test_before_fix.log`):

- the reserved occurrence on the removed slot was marked `rejected` while its delivery state stayed `sending`, so an in-flight message would be recorded as rejected;
- the reserved occurrence on the kept slot was rebuilt: its message body lost the media summary and tracked link, and `media_asset_id` and `adaptation_decision_id` were cleared, so the stored record no longer matched the message being sent and its decision and tracked-link trace links were lost.

The delivery-state rows themselves were already protected (`historicalState`).

## Change

`landing/api/_lib/schedule-store.js`: a nudge whose delivery state is reserved or later (`historicalState`) is treated as history, like a nudge with `sent_at`. It is neither rejected as stale nor rebuilt. Unreserved future occurrences of a removed slot are still rejected (asserted in test 2).

## Results

- `isolation_test_after_fix.log`: 2/2 pass. `full_suite_after_fix.log`: 228/228 pass (226 before plus the two new tests).
- Benchmark task outcomes are identical to `_tracefix` case by case (fixed 9/24, rules 17/24, 0 violations).
- Trace completeness (rules arm): 25/25 steps with every applicable link (`TRACE_COMPLETENESS.md`), unchanged.

The repair targets the failure the new test revealed; the rerun confirms that it does not change benchmark behaviour. It is not a concurrency test: the race between reservation and a schedule write is reproduced by constructing the reserved state, not by running two workers at once.
