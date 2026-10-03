# Table X. Bounded adaptation benchmark results

The benchmark used 24 frozen synthetic cases: 12 supported requests, four no-change cases, four boundary or clinician-override cases, and four operational cases. A task passed only when the expected state change and all required protections were satisfied.

| Evaluation arm | Overall task success | Supported-request fulfilment | No-change cases | Boundary/override cases | Operational cases | Observed constraint violations |
|---|---:|---:|---:|---:|---:|---:|
| Fixed schedule | 9/24 (37.5%) | 0/12 (0.0%) | 4/4 (100.0%) | 4/4 (100.0%) | 1/4 (25.0%) | 0 |
| Rules-only interpreter | 12/24 (50.0%) | 3/12 (25.0%) | 3/4 (75.0%) | 4/4 (100.0%) | 2/4 (50.0%) | 5 |
| Rules-plus-Gemini interpreter | 12/22 completed (54.5%) | 5/12 (41.7%) | 1/2 completed (50.0%) | 4/4 (100.0%) | 2/4 (50.0%) | 5 |

**Notes.** The fixed schedule is a reference arm. The rules-only and rules-plus-Gemini arms share the same downstream frequency policy, envelope checks, persistence, and delivery-preparation logic; the primary comparison therefore concerns reply interpretation. The hybrid arm is incomplete: two of its 24 first-run cases were not evaluated after Gemini's free-tier quota was exhausted. Its percentages are descriptive observations, not a completed superiority comparison. Provider failures and quota exhaustion are reported separately in the evidence package. Constraint violations count prohibited state changes and historical-record mutations; they are not averaged away by successful cases.

## Thesis-ready result statement

In the frozen synthetic benchmark, the fixed schedule completed 9 of 24 tasks (37.5%), while the deterministic rules-only arm completed 12 of 24 tasks (50.0%). The rules-only arm fulfilled 3 of 12 supported requests and recorded five constraint violations, including historical-source mutation during schedule application. The rules-plus-Gemini arm completed 12 of 22 cases for which a first-run result was available (54.5%) and fulfilled 5 of 12 supported requests, but the comparison was incomplete because the Gemini free-tier quota was exhausted before all model-dependent cases and repetitions could be run. These results demonstrate the evaluation method and identify concrete implementation failures; they do not establish that the hybrid arm is superior, reliable in production, or beneficial to patients.

## Reporting boundary

This is a custom, requirements-derived synthetic benchmark. Cases were authored by the implementer and evaluated through the local application logic and isolated storage emulators. No WhatsApp message, production schedule, or participant data was used. The benchmark measures technical state-transition correctness and bounded request handling, not clinical adherence, health outcomes, or real-user performance.
