# Run notes: live translation fidelity, completion run under amendment 1 (4 October 2026)

`scripts/translation-trace/FIDELITY_AMENDMENT_1.md` (SHA-256 `2be870a0…`) was hashed at 09:09:50 UTC, before this run. Between 09:10:32 and 09:13:21 UTC the run re-made the 14 calls that got no response in `../translation_fidelity_live_2026-10-04/`, 13 seconds apart, with zero retries.

## Outcome

Two calls returned: F10-r3 and F11-r3. Both were accepted, with the gold labels and every prompt rule kept. The other 12 were refused with HTTP 429.

This time the refusal named the **daily** free-tier quota, `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `quotaValue` 20. That quota was exhausted. More calls must wait for the provider's daily reset or use a paid key, so the amendment's scope is not complete:

- F12 has no response;
- F08 and F09 have one response each.

## Combined with the first run (first-run response where one exists)

| Measure | Result |
|---|---|
| Responses | 24/36, all accepted by the gate; 0 refused; no rows written on refusal |
| Prescription count | Equals gold in 24/24 |
| Pillar | 27/28 (F09: soft drinks classed `substance_use`) |
| Category | 23/28 exact; 27/28 with declared alternatives (F01 ×3 and F08 gave `establish`) |
| Frequency | 27/28 |
| Duration | 27/28 |
| Prompt rules | Drafts equal `frequency_per_week` 26/28; week-1 dates, distinct dates, action ≤ 120 and bodies ≤ 180 all 28/28 |
| Consistency | Identical labels on every call for all 9 texts with two or more responses |
| Full chain on real output | 11/11 closed; F12 not run |

All calls used `gemini-2.5-flash`. Every stored row names the model, the prompt-template hash and the provider's response ID. The key appears in no output file (scanned).
