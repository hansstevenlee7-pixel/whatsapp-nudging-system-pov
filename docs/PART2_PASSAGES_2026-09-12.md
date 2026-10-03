# Part 2 drop-in passages — 12 September 2026

Replacements for §2.1 and §4.5 of `Hans_Lee_Thesis_Part2_Supervisor_Draft_2026-09-10.docx`. Verified against source code and against the five citations confirmed on 12 September 2026. Resolves `TODO-CITATION` in §2.1 and discrepancies D1, D2, D3, D7 in `ADAPTATION_SCOPE_LOCK_2026-09-12.md`.

---

## §2.1 Adaptive messaging and delivery decisions

*Replaces paragraphs 1 and 2. Keep existing paragraph 3 (comparison with prior systems) unchanged.*

The relevant distinction is between a fixed delivery policy and a policy that can change later messages in response to recorded evidence. In this study the evaluated adaptation dimension is delivery frequency. Delivery window and approved-resource selection are implemented and demonstrated, but are not evaluated as optimisation studies. The prescribed action remains under clinician control throughout. This separates communication adaptation from clinical decision support and prevents the model's output from being read as a recommendation about treatment.

Just-in-time adaptive intervention (JITAI) research supplies the design vocabulary used here, extending the adaptive-intervention framework of Collins et al. (2004). Nahum-Shani et al. (2018) define six components — distal outcome, proximal outcome, decision points, intervention options, tailoring variables, and decision rules — for interventions that adapt support to a person's changing internal and contextual state. Table 1 maps the present system onto those components. The mapping is adopted as descriptive vocabulary rather than as a claim of intervention effectiveness; this study conducts no micro-randomised trial and estimates no causal effect on participants.

**Table 1. The system expressed in JITAI components**

| JITAI component | Instantiation in this system |
| --- | --- |
| Decision point | Close of each 24-hour outcome window following a confirmed delivery |
| Proximal outcome | Ordinary interaction — tracked-link visit or ordinary reply — within 24 hours |
| Intervention options | Weekly frequency inside the clinician envelope; operative range one to three |
| Tailoring variables | Seven observable delivery and interaction-history features |
| Decision rules | Model scores, then a selection rule, then a deterministic safety policy |
| Distal outcome | Not evaluated; no behaviour, adherence, or health outcome is claimed |

The final row states the study's claim boundary in the framework's own terms. A JITAI is ordinarily justified by its distal outcome. This study deliberately leaves that component unevaluated and reports only whether the system executes the remaining five correctly, reproducibly, and within stated limits.

---

## §4.5 Model recommendation and deterministic policy

*Replaces all four paragraphs.*

Frequency adaptation proceeds through three distinct computational layers, each recorded separately. First, the frozen logistic-regression artifact scores every weekly frequency permitted by the clinician envelope, using the ordered features and standardisation values stored with the artifact; the operative range is one to three messages per week. These raw probabilities are persisted as the candidate scores. Second, a deterministic selection rule converts those scores into a single proposal: it takes the lowest frequency whose predicted interaction probability lies within five percentage points of the best candidate, limits the proposal to one step from the current setting, and will not propose an increase without at least one recent ordinary interaction. Third, a deterministic safety policy decides whether that proposal may be applied at all.

The second layer's output is a proposal, not permission. The safety policy applies two independent bounds on change: a magnitude bound limiting any single decision to one step, and a rate bound permitting at most one applied frequency change in any seven-day period. Beyond these, an increase requires at least two ordinary interactions among the four most recent closed windows — a stricter gate than the selection rule's — and a model-assisted decrease requires at least two consecutive closed windows with no observable interaction. Silence can never raise frequency. An explicit patient request falling inside the approved envelope takes precedence over the model, while a request outside the envelope is recorded without application. Uncertain or unsupported cases hold the current setting.

Delivery-time and media adaptation remain wholly deterministic and are reported as demonstrated capabilities rather than evaluated policies. Time can move by at most one approved morning, afternoon, or evening window, and only after at least two ordinary interactions support that window. Media selection applies an explicit format request first, then considers tracked visits by approved format, and otherwise rotates the least-recently-used approved resource. A read receipt is exposure evidence only and does not drive preference inference.

Separating the scoring layer from the selection rule matters for interpretation. What the audit trail labels a model recommendation is already the joint product of the model and the selection rule; the unmodified model output survives only in the recorded candidate scores. Reporting these as a single step would overstate how much of each decision the learned component determines. Together with the clinician envelope upstream and the dual application gate downstream, this design keeps the logistic model, the language model, and the workflow engine well short of autonomous clinical decision-making.

---

## Notes

- **Citation correction:** the authoritative literature review lists this paper with the wrong venue and DOI. Use the corrected form below in Part 2 and fix the literature review entry. See `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md` section 2.
- **Citation to add:** Nahum-Shani, I., Smith, S. N., Spring, B. J., Collins, L. M., Witkiewitz, K., Tewari, A., & Murphy, S. A. (2018). Just-in-time adaptive interventions (JITAIs) in mobile health: Key components and design principles for ongoing health behavior support. *Annals of Behavioral Medicine*, 52(6), 446-462.
- **Table numbering:** existing Tables 1 and 2 in §5 become Tables 2 and 3.
- **Word cost:** approximately +100 words plus one six-row table against the passages replaced. Draft stood at 7,622 of 8,000 words before this change.
