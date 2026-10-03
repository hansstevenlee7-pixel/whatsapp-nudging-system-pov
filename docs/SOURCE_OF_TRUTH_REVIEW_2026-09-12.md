# Source-of-truth review — 12 September 2026

Hans reinstated `33292280_HansLee_LitReview_Proposal_REVISED_2026-09-12.pdf` (repository root) as the authoritative literature review and proposal. Verified by direct text extraction: 19 pages, ~7,456 words. Sections 1-3 literature review and integration gap, section 4 research proposal, section 5 conclusion, Appendix A historical prototype snapshot.

`THESIS_DIRECTION_2026-09-12.md`, `HANDOFF_THESIS_WRITING.md`, and the citation ledger in `PART2_DETAILED_OUTLINE_AND_EVIDENCE_MATRIX.md` have been repointed. The older `...LitReviewProposal_SUBMIT.pdf` is historical context only.

## 1. Effect on the locked adaptation scope: none

Section 4 of the revised document is identical in substance to `Research_Proposal_Revised_2026-09-12.docx`, which `ADAPTATION_SCOPE_LOCK_2026-09-12.md` was already built against. The RQs, the one-dimension rule in §4.4, and the evaluation strategy in §4.6 are unchanged. **The frequency lock stands.**

## 2. Reference error in the authoritative document

The revised reference list contains one entry that merges two different papers:

> Nahum-Shani, I., Smith, S. N., Spring, B. J., Collins, L. M., Witkiewitz, K., Tewari, A., & Murphy, S. A. (2016). Just-in-time adaptive interventions (jitais) in mobile health. *Health Psychology*, 36(8), 217-228. doi:10.1037/hea0000306

Verified 12 September 2026:

- That **author list and title** belong to *Annals of Behavioral Medicine*, **52(6), 446-462 (2018)**, doi:10.1007/s12160-016-9830-8.
- **doi:10.1037/hea0000306** belongs to a different paper: Nahum-Shani, I., Hekler, E. B., & Spruijt-Metz, D. (2015). Building health behavior models to guide the development of just-in-time adaptive interventions: A pragmatic framework. *Health Psychology*, **34(S), 1209-1219**.
- The stated volume, issue, pages and year (36(8), 217-228, 2016) match neither paper.

**Action:** correct the entry in the lit review to the 2018 *Annals of Behavioral Medicine* paper, and use that corrected form in Part 2. Do not propagate the existing entry. If the 2015 pragmatic-framework paper is also wanted, add it as a separate entry.

## 3. Coherence risk between Part 1 and Part 2 — address before drafting §1 and §6

Section 2.6 of the authoritative literature review argues that adaptive systems are frequently optimised for engagement-related outcomes rather than behavioural effectiveness (Yardley et al., 2016), and that without theoretical grounding they risk operating as opaque systems refining interventions on short-term interaction signals rather than clinically relevant change (Michie et al., 2017).

Section 3 then defines the third structural disconnection as the absence of feedback mechanisms that update intervention logic from behavioural outcomes **rather than engagement proxies**.

The Part 2 artifact adapts weekly frequency against a 24-hour interaction proxy. On its face this is the practice the literature review criticises. An examiner reading both parts will see it.

**Resolution — state it explicitly, do not leave it implicit.** The design answer is that the proxy's *authority* is structurally bounded rather than its *use* avoided:

- The proxy governs communication logistics only — how often an approved message is sent.
- It cannot alter the prescribed action, the clinical goal, the approved media pool, or the envelope itself.
- It is subordinate to a deterministic safety policy, so a prediction is never permission.
- The distal outcome is left unevaluated by design, so no behavioural claim rests on the proxy.

Part 2 therefore does **not** claim to close disconnection (3). It closes disconnection (1) — the missing data pathway from clinician-approved assessment to real-time delivery and feedback — and it *contains* the risk that (3) names rather than resolving it. The safety layer is the containment mechanism, which is the design justification for its existence.

This turns the strongest available criticism into the rationale for the architecture. It belongs in §1.2 (research gap) and again in §6.2 (interpretation).

## 4. Which disconnection Part 2 addresses

| Disconnection (revised §3) | Part 2 |
| --- | --- |
| (1) No data pathway from assessment to real-time delivery | **Addressed** — this is the artifact |
| (2) No explicit theoretical grounding in point-of-execution nudge design | Partly — taxonomy and envelope are design representations only |
| (3) No feedback from behavioural outcomes rather than engagement proxies | **Not addressed** — explicitly out of scope; contained, not resolved |

Stating all three and claiming only (1) is stronger than implying the artifact closes the whole gap.

## 5. Citations now available without rediscovery

The revised reference list carries full DOIs and can be cited directly. Relevant to Part 2: Collins et al. (2004); Klasnja et al. (2015); Yardley et al. (2016); Michie et al. (2017); Perski et al. (2017); Eysenbach (2005); Hevner et al. (2004); Peffers et al. (2007); Hummel & Maedche (2019); Matthews (2022); Nazaret & Sapiro (2023); Bender et al. (2021); Singhal et al. (2023). The five methodological citations verified separately on 12 September 2026 (Christodoulou, Rudin, Nahum-Shani 2018, Saito & Rehmsmeier, Van Calster) are additions not present in the literature review.
