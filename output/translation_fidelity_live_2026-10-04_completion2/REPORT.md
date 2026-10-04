# Live LLM translation fidelity

Protocol `translation-fidelity-v1`, completion run under FIDELITY_AMENDMENT_1.md (first run kept in output/translation_fidelity_live_2026-10-04, output/translation_fidelity_live_2026-10-04_completion). 12 calls planned (12 attempted, cap 45); model versions: gemini-2.5-flash.

| Measure | Result |
|---|---|
| M1 HTTP 200 with a candidate | 3/12 (25%) |
| M2 Accepted by the intake gate | 3/12 (25%); refused 0; rows written on refusal 0 |
| M3 Prescription count equals gold | 3/3 (100%) |
| M4 Pillar | 3/3 (100%) |
| M5 Category exact / with declared alternatives | 2/3 (67%) / 3/3 (100%) |
| M6 Frequency exact / with declared alternatives | 3/3 (100%) / 3/3 (100%) |
| M7 Duration exact | 3/3 (100%) |
| M8 Drafts equal frequency / within week 1 / distinct dates / action ≤120 / bodies ≤180 | 3/3 (100%) / 3/3 (100%) / 3/3 (100%) / 3/3 (100%) / 3/3 (100%) |
| M9 Texts with identical labels across repetitions | 1/12 (8%) |
| M10 Full chains closed on real output | 1/1 run |

## Per call

| Call | HTTP | Gate | Gold → output (pillar/category/frequency/weeks) | Prompt rules broken |
|---|---|---|---|---|
| F03-r3 | 503 | no response | — | — |
| F04-r3 | 503 | no response | — | — |
| F06-r3 | 503 | no response | — | — |
| F08-r2 | 503 | no response | — | — |
| F08-r3 | 200 | accepted | social_connection/increase/1/8 → social_connection/establish/1/8 | — |
| F09-r2 | 503 | no response | — | — |
| F09-r3 | 503 | no response | — | — |
| F10-r1 | 503 | no response | — | — |
| F11-r2 | 503 | no response | — | — |
| F12-r1 | 503 | no response | — | — |
| F12-r2 | 200 | accepted | sleep/maintain/1/12 → sleep/maintain/1/12 | — |
| F12-r3 | 200 | accepted | sleep/maintain/1/12 → sleep/maintain/1/12 | — |

## Full chain on real output (M10)

| Text | From call | Closed | Reply decision | Links (T1–T19) |
|---|---|---|---|---|
| F12 | F12-r2 | yes | outside_envelope | all complete |

## Action wording (verbatim, first call per text)

- **F01** “Walk 30 minutes after dinner, twice a week, for 6 weeks.” → no parsed output
- **F02** “Be in bed by 10:30 pm on weeknights; three reminders a week for 8 weeks.” → no parsed output
- **F03** “Cut down on alcohol to no more than two drinks on any day. Weekly reminder, 12 weeks.” → no parsed output
- **F04** “Stop smoking completely. Remind me three times a week for 10 weeks.” → no parsed output
- **F05** “Eat two serves of vegetables at lunch; reminders twice a week for 6 weeks.” → no parsed output
- **F06** “Keep up your three gym sessions a week; one reminder a week for 8 weeks.” → no parsed output
- **F07** “Ten minutes of slow breathing every evening to manage stress; remind me twice a week for 4 weeks.” → no parsed output
- **F08** “Call or meet a friend at least once a week to feel less isolated. Weekly reminder for 8 weeks.” → “Call or meet a friend to feel less isolated.”
- **F09** “Avoid sugary soft drinks entirely. Two reminders a week, 6 weeks.” → no parsed output
- **F10** “Reduce screen time after 9 pm and keep a regular wake-up time of 7 am. Two reminders a week for each, 8 weeks.” → no parsed output
- **F11** “Walk 20 minutes three times a week, and cut back on takeaway meals to once a week with two reminders a week for the takeaway goal; 6 weeks.” → no parsed output
- **F12** “Maintain your current 7 to 8 hours of sleep. One reminder a week, 12 weeks.” → “Maintain 7 to 8 hours of sleep.”

## Combined (FIDELITY_AMENDMENT_2.md)

earliest response per call across output/translation_fidelity_live_2026-10-04, output/translation_fidelity_live_2026-10-04_completion, output/translation_fidelity_live_2026-10-04_completion2

| Measure | Combined |
|---|---|
| M1 HTTP 200 with a candidate | 27/36 (75%) |
| M2 Accepted | 27/36 (75%); refused 0; rows written on refusal 0 |
| M3 Count | 27/27 (100%) |
| M4 Pillar | 30/31 (97%) |
| M5 Category exact / with alternatives | 25/31 (81%) / 30/31 (97%) |
| M6 Frequency exact / with alternatives | 30/31 (97%) / 30/31 (97%) |
| M7 Duration exact | 30/31 (97%) |
| M8 Drafts equal frequency / week 1 / distinct / action ≤120 / bodies ≤180 | 29/31 (94%) / 31/31 (100%) / 31/31 (100%) / 31/31 (100%) / 31/31 (100%) |
| M9 Identical labels across repetitions | 11/12 (92%) |
| M10 Chains closed | 12/12 run |

Outbound requests refused: 0.
