# Run notes: live translation fidelity, completion run under amendment 2 (4 October 2026)

`scripts/translation-trace/FIDELITY_AMENDMENT_2.md` (SHA-256 `58867ae8…`) was hashed at 09:21:27 UTC, before this run. The run re-made the 12 calls still unanswered after amendment 1, using the second Gemini key in `n8n.env` (`key_line` 2 in the manifest), 13 seconds apart, with zero retries.

## Outcome

Three calls returned, F08-r3, F12-r2 and F12-r3. All three were accepted and kept every prompt rule. The other nine received HTTP 503: "This model is currently experiencing high demand" (`UNAVAILABLE`). That is a provider capacity response, not a quota refusal.

Every text now has at least one answer. F09 has only one.

## Combined (earliest response per call: first run, amendment 1, amendment 2)

| Measure | Result |
|---|---|
| Responses | 27/36, all accepted by the gate; 0 refused; no rows written on any failed call |
| Prescription count | Equals gold in 27/27 |
| Pillar | 30/31 (F09: soft drinks classed `substance_use`) |
| Category | 25/31 exact; 30/31 with declared alternatives (F01 ×3 and F08 ×2 gave `establish`) |
| Frequency | 30/31 |
| Duration | 30/31 |
| Prompt rules | Drafts equal `frequency_per_week` 29/31 (F04-r2, F05-r3); week-1 dates, distinct dates, action ≤ 120 and bodies ≤ 180 all 31/31 |
| Consistency | Identical labels on every call for all 11 texts with two or more responses (F09 had one) |
| Full chain on real output | 12/12 closed |

Neither key appears in any output file (scanned).
