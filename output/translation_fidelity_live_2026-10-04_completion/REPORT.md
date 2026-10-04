# Live LLM translation fidelity

Protocol `translation-fidelity-v1`, completion run under FIDELITY_AMENDMENT_1.md (first run kept in output/translation_fidelity_live_2026-10-04). 14 calls planned (14 attempted, cap 45); model versions: gemini-2.5-flash.

| Measure | Result |
|---|---|
| M1 HTTP 200 with a candidate | 2/14 (14%) |
| M2 Accepted by the intake gate | 2/14 (14%); refused 0; rows written on refusal 0 |
| M3 Prescription count equals gold | 2/2 (100%) |
| M4 Pillar | 4/4 (100%) |
| M5 Category exact / with declared alternatives | 4/4 (100%) / 4/4 (100%) |
| M6 Frequency exact / with declared alternatives | 4/4 (100%) / 4/4 (100%) |
| M7 Duration exact | 4/4 (100%) |
| M8 Drafts equal frequency / within week 1 / distinct dates / action ≤120 / bodies ≤180 | 4/4 (100%) / 4/4 (100%) / 4/4 (100%) / 4/4 (100%) / 4/4 (100%) |
| M9 Texts with identical labels across repetitions | 0/12 (0%) |
| M10 Full chains closed on real output | 0/0 run |

## Per call

| Call | HTTP | Gate | Gold → output (pillar/category/frequency/weeks) | Prompt rules broken |
|---|---|---|---|---|
| F03-r3 | 429 | no response | — | — |
| F04-r3 | 429 | no response | — | — |
| F06-r3 | 429 | no response | — | — |
| F08-r2 | 429 | no response | — | — |
| F08-r3 | 429 | no response | — | — |
| F09-r2 | 429 | no response | — | — |
| F09-r3 | 429 | no response | — | — |
| F10-r1 | 429 | no response | — | — |
| F10-r3 | 200 | accepted | sleep/reduce/2/8 → sleep/reduce/2/8<br>sleep/establish/2/8 → sleep/establish/2/8 | — |
| F11-r2 | 429 | no response | — | — |
| F11-r3 | 200 | accepted | physical_activity/increase/3/6 → physical_activity/increase/3/6<br>nutrition/reduce/2/6 → nutrition/reduce/2/6 | — |
| F12-r1 | 429 | no response | — | — |
| F12-r2 | 429 | no response | — | — |
| F12-r3 | 429 | no response | — | — |

## Full chain on real output (M10)

| Text | From call | Closed | Reply decision | Links (T1–T19) |
|---|---|---|---|---|
| F12 | — | not run | — | no accepted output |

## Action wording (verbatim, first call per text)

- **F01** “Walk 30 minutes after dinner, twice a week, for 6 weeks.” → no parsed output
- **F02** “Be in bed by 10:30 pm on weeknights; three reminders a week for 8 weeks.” → no parsed output
- **F03** “Cut down on alcohol to no more than two drinks on any day. Weekly reminder, 12 weeks.” → no parsed output
- **F04** “Stop smoking completely. Remind me three times a week for 10 weeks.” → no parsed output
- **F05** “Eat two serves of vegetables at lunch; reminders twice a week for 6 weeks.” → no parsed output
- **F06** “Keep up your three gym sessions a week; one reminder a week for 8 weeks.” → no parsed output
- **F07** “Ten minutes of slow breathing every evening to manage stress; remind me twice a week for 4 weeks.” → no parsed output
- **F08** “Call or meet a friend at least once a week to feel less isolated. Weekly reminder for 8 weeks.” → no parsed output
- **F09** “Avoid sugary soft drinks entirely. Two reminders a week, 6 weeks.” → no parsed output
- **F10** “Reduce screen time after 9 pm and keep a regular wake-up time of 7 am. Two reminders a week for each, 8 weeks.” → “Reduce screen time after 9 pm”, “Reduce screen time after 9 pm”, “Wake up at 7 am”, “Wake up at 7 am”
- **F11** “Walk 20 minutes three times a week, and cut back on takeaway meals to once a week with two reminders a week for the takeaway goal; 6 weeks.” → “Walk for 20 minutes.”, “Walk for 20 minutes.”, “Walk for 20 minutes.”, “Limit takeaway meals to once a week.”, “Limit takeaway meals to once a week.”
- **F12** “Maintain your current 7 to 8 hours of sleep. One reminder a week, 12 weeks.” → no parsed output

## Combined with the first run (FIDELITY_AMENDMENT_1.md)

first-run response where one exists, otherwise the completion run's (FIDELITY_AMENDMENT_1.md)

| Measure | Combined |
|---|---|
| M1 HTTP 200 with a candidate | 24/36 (67%) |
| M2 Accepted | 24/36 (67%); refused 0; rows written on refusal 0 |
| M3 Count | 24/24 (100%) |
| M4 Pillar | 27/28 (96%) |
| M5 Category exact / with alternatives | 23/28 (82%) / 27/28 (96%) |
| M6 Frequency exact / with alternatives | 27/28 (96%) / 27/28 (96%) |
| M7 Duration exact | 27/28 (96%) |
| M8 Drafts equal frequency / week 1 / distinct / action ≤120 / bodies ≤180 | 26/28 (93%) / 28/28 (100%) / 28/28 (100%) / 28/28 (100%) / 28/28 (100%) |
| M9 Identical labels across repetitions | 9/12 (75%) |
| M10 Chains closed | 11/11 run |

Outbound requests refused: 0.
