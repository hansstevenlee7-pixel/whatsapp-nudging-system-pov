# Live LLM translation fidelity

Protocol `translation-fidelity-v1`. 36 calls planned (36 attempted, cap 45); model versions: gemini-2.5-flash.

| Measure | Result |
|---|---|
| M1 HTTP 200 with a candidate | 22/36 (61%) |
| M2 Accepted by the intake gate | 22/36 (61%); refused 0; rows written on refusal 0 |
| M3 Prescription count equals gold | 22/22 (100%) |
| M4 Pillar | 23/24 (96%) |
| M5 Category exact / with declared alternatives | 19/24 (79%) / 23/24 (96%) |
| M6 Frequency exact / with declared alternatives | 23/24 (96%) / 23/24 (96%) |
| M7 Duration exact | 23/24 (96%) |
| M8 Drafts equal frequency / within week 1 / distinct dates / action ≤120 / bodies ≤180 | 22/24 (92%) / 24/24 (100%) / 24/24 (100%) / 24/24 (100%) / 24/24 (100%) |
| M9 Texts with identical labels across repetitions | 7/12 (58%) |
| M10 Full chains closed on real output | 11/11 run |

## Per call

| Call | HTTP | Gate | Gold → output (pillar/category/frequency/weeks) | Prompt rules broken |
|---|---|---|---|---|
| F01-r1 | 200 | accepted | physical_activity/increase/2/6 → physical_activity/establish/2/6 | — |
| F01-r2 | 200 | accepted | physical_activity/increase/2/6 → physical_activity/establish/2/6 | — |
| F01-r3 | 200 | accepted | physical_activity/increase/2/6 → physical_activity/establish/2/6 | — |
| F02-r1 | 200 | accepted | sleep/establish/3/8 → sleep/establish/3/8 | — |
| F02-r2 | 200 | accepted | sleep/establish/3/8 → sleep/establish/3/8 | — |
| F02-r3 | 200 | accepted | sleep/establish/3/8 → sleep/establish/3/8 | — |
| F03-r1 | 200 | accepted | substance_use/reduce/1/12 → substance_use/reduce/1/12 | — |
| F03-r2 | 200 | accepted | substance_use/reduce/1/12 → substance_use/reduce/1/12 | — |
| F03-r3 | 429 | no response | — | — |
| F04-r1 | 200 | accepted | substance_use/avoid/3/10 → substance_use/avoid/3/10 | — |
| F04-r2 | 200 | accepted | substance_use/avoid/3/10 → substance_use/avoid/3/10 | p1:count_matches_frequency |
| F04-r3 | 503 | no response | — | — |
| F05-r1 | 200 | accepted | nutrition/increase/2/6 → nutrition/increase/2/6 | — |
| F05-r2 | 200 | accepted | nutrition/increase/2/6 → nutrition/increase/2/6 | — |
| F05-r3 | 200 | accepted | nutrition/increase/2/6 → nutrition/increase/2/6 | p1:count_matches_frequency |
| F06-r1 | 200 | accepted | physical_activity/maintain/1/8 → physical_activity/maintain/1/8 | — |
| F06-r2 | 200 | accepted | physical_activity/maintain/1/8 → physical_activity/maintain/1/8 | — |
| F06-r3 | 429 | no response | — | — |
| F07-r1 | 200 | accepted | stress_management/establish/2/4 → stress_management/establish/2/4 | — |
| F07-r2 | 200 | accepted | stress_management/establish/2/4 → stress_management/establish/2/4 | — |
| F07-r3 | 200 | accepted | stress_management/establish/2/4 → stress_management/establish/2/4 | — |
| F08-r1 | 200 | accepted | social_connection/increase/1/8 → social_connection/establish/1/8 | — |
| F08-r2 | 429 | no response | — | — |
| F08-r3 | 429 | no response | — | — |
| F09-r1 | 200 | accepted | nutrition/avoid/2/6 → missing<br>+1 extra | — |
| F09-r2 | 429 | no response | — | — |
| F09-r3 | 429 | no response | — | — |
| F10-r1 | 429 | no response | — | — |
| F10-r2 | 200 | accepted | sleep/reduce/2/8 → sleep/reduce/2/8<br>sleep/establish/2/8 → sleep/establish/2/8 | — |
| F10-r3 | 429 | no response | — | — |
| F11-r1 | 200 | accepted | physical_activity/increase/3/6 → physical_activity/increase/3/6<br>nutrition/reduce/2/6 → nutrition/reduce/2/6 | — |
| F11-r2 | 429 | no response | — | — |
| F11-r3 | 429 | no response | — | — |
| F12-r1 | 429 | no response | — | — |
| F12-r2 | 429 | no response | — | — |
| F12-r3 | 429 | no response | — | — |

## Full chain on real output (M10)

| Text | From call | Closed | Reply decision | Links (T1–T19) |
|---|---|---|---|---|
| F01 | F01-r1 | yes | applied | all complete |
| F02 | F02-r1 | yes | applied | all complete |
| F03 | F03-r1 | yes | outside_envelope | all complete |
| F04 | F04-r1 | yes | applied | all complete |
| F05 | F05-r1 | yes | applied | all complete |
| F06 | F06-r1 | yes | outside_envelope | all complete |
| F07 | F07-r1 | yes | applied | all complete |
| F08 | F08-r1 | yes | outside_envelope | all complete |
| F09 | F09-r1 | yes | outside_envelope | all complete |
| F10 | F10-r2 | yes | applied | T16 0/1 |
| F11 | F11-r1 | yes | applied | T16 0/1 |
| F12 | — | not run | — | no accepted output |

## Action wording (verbatim, first call per text)

- **F01** “Walk 30 minutes after dinner, twice a week, for 6 weeks.” → “Walk 30 minutes after dinner.”, “Walk 30 minutes after dinner.”
- **F02** “Be in bed by 10:30 pm on weeknights; three reminders a week for 8 weeks.” → “Be in bed by 10:30 pm.”, “Be in bed by 10:30 pm.”, “Be in bed by 10:30 pm.”
- **F03** “Cut down on alcohol to no more than two drinks on any day. Weekly reminder, 12 weeks.” → “Limit alcohol to no more than two drinks on any day.”
- **F04** “Stop smoking completely. Remind me three times a week for 10 weeks.” → “Stop smoking completely.”, “Stop smoking completely.”, “Stop smoking completely.”
- **F05** “Eat two serves of vegetables at lunch; reminders twice a week for 6 weeks.” → “Eat two serves of vegetables at lunch.”, “Eat two serves of vegetables at lunch.”
- **F06** “Keep up your three gym sessions a week; one reminder a week for 8 weeks.” → “Attend your three gym sessions this week.”
- **F07** “Ten minutes of slow breathing every evening to manage stress; remind me twice a week for 4 weeks.” → “Practice 10 minutes of slow breathing.”, “Practice 10 minutes of slow breathing.”
- **F08** “Call or meet a friend at least once a week to feel less isolated. Weekly reminder for 8 weeks.” → “Call or meet a friend to feel less isolated.”
- **F09** “Avoid sugary soft drinks entirely. Two reminders a week, 6 weeks.” → “Avoid sugary soft drinks entirely today.”, “Continue to avoid sugary soft drinks.”
- **F10** “Reduce screen time after 9 pm and keep a regular wake-up time of 7 am. Two reminders a week for each, 8 weeks.” → “Reduce screen time after 9 pm”, “Reduce screen time after 9 pm”, “Wake up at 7 am”, “Wake up at 7 am”
- **F11** “Walk 20 minutes three times a week, and cut back on takeaway meals to once a week with two reminders a week for the takeaway goal; 6 weeks.” → “Walk for 20 minutes.”, “Walk for 20 minutes.”, “Walk for 20 minutes.”, “Limit takeaway meals to once a week.”, “Limit takeaway meals to once a week.”
- **F12** “Maintain your current 7 to 8 hours of sleep. One reminder a week, 12 weeks.” → no parsed output

Outbound requests refused: 0.
