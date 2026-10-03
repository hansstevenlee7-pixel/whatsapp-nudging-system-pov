# Lifestyle Medicine Nudging System — Authoritative Thesis Direction

Updated: 12 September 2026. Purpose: a concise scope reference for review and future sessions.

## Source of truth

- **`33292280_HansLee_LitReview_Proposal_REVISED_2026-09-12.pdf` (repository root) is the authoritative literature review and proposal.** Reinstated by Hans on 12 September 2026. It supersedes `33292280-HansLee-DavidTaniar-LitReviewProposal_SUBMIT`, which is now historical context only.
- The revised document is a single 19-page work: sections 1-3 are the literature review and integration gap, section 4 is the current research proposal, and Appendix A is a historical prototype snapshot that is explicitly *not* evidence of current completeness.
- Its section 4 already contains the current system-focused RQs. Use it for background, gap, terminology, and citations. Use Hans's latest explicit direction only where it goes beyond section 4. Raise any unresolved conflict instead of silently changing the scope.
- Verified in this workspace on 12 September 2026 by direct text extraction. One reference error was found and is recorded in `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md`.

## Current focus and technical contribution

The thesis explains, implements, and technically evaluates **how an adaptive Lifestyle Medicine nudging system works**. Its primary question is no longer whether nudges change patient behaviour.

Working research question: **How can a closed-loop adaptive Lifestyle Medicine nudging system translate clinician-approved prescriptions into automated, taxonomy-constrained nudges and adapt delivery using interaction feedback?**

The technical contribution is the design, implementation, and evaluation of the integrated closed-loop system: prescription → taxonomy mapping → nudge selection/generation → scheduling and delivery → feedback capture → adaptation → clinician summary. The adaptive algorithm or machine-learning model is a component of this contribution, not the entire thesis. A particular model or algorithm is not fixed by this direction statement.

## Clinician workflow: extremely simple

The doctor provides or approves the Lifestyle Medicine prescription, adjusts priorities through a simple interface (such as drag and drop where useful), and reviews concise summaries. The doctor should not need to manage individual nudges or tune the adaptation algorithm.

Automation handles taxonomy mapping, nudge selection and generation, scheduling, delivery, feedback capture, and adaptation of future nudges. Summaries show what the system did, the interactions recorded, and how and why delivery adapted. Clinical prescription authority remains with the clinician.

## Synthetic behaviour and evaluation

Synthetic user behaviour provides controlled, reproducible scenarios for testing the feedback and adaptation loop. Simulated responses, delays, ignored messages, or reported completion are test inputs—not evidence of real patient outcomes. Any ML training and evaluation must disclose the simulator assumptions and distinguish simulated signals from real observations.

Suggested evaluation dimensions (to operationalise in the evaluation protocol):

| Dimension | What to demonstrate |
| --- | --- |
| Functional pipeline | Correct prescription-to-nudge processing, taxonomy compliance, scheduling/delivery handling, feedback capture, and traceable summaries; include failure cases. |
| Adaptive behaviour | Whether feedback causes appropriate, bounded, explainable changes under controlled scenarios; compare with a fixed policy where useful and record the adaptation sequence. |
| System/clinician burden | Automation coverage, manual steps and interventions required, and clarity of summaries. Workflow counts or simulated task timings are technical proxies; actual clinician burden reduction needs clinician evidence. |

## Do not deviate

- Do not reframe the thesis as a clinical efficacy trial or make patient behaviour change the primary outcome.
- Do not substitute an older draft for the authoritative literature review or restore superseded proposal aims without Hans’s explicit direction.
- Keep the contribution at the integrated system level; do not reduce it to model accuracy or choosing an ML algorithm.
- Preserve the simple clinician workflow. Automation must handle routine behavioural delivery and adaptation while the clinician retains prescription oversight.
- Keep proposed features, implemented behaviour, local tests, integration/deployment checks, and real-world evidence clearly distinguished.
- Ground every result in recorded evidence, disclose synthetic assumptions, and avoid generalising beyond the tested scenarios.

## What the thesis does NOT claim

The thesis does **not** establish clinical efficacy, sustained patient behaviour change, improved health outcomes, real-world patient adherence, clinical safety or deployment readiness, or validated reductions in clinician workload. Successful synthetic experiments demonstrate bounded technical operation under stated assumptions; they do not establish effectiveness in real patients or autonomous clinical decision-making.

## Provenance

Based on Hans’s current request and the recent conversation [Thesis App Automation](chatgpt-conversation://6aa4fe9c-9c40-83ec-be4d-140e4caaea5e), particularly his clarification that the proposal changed from proving patient behaviour change to explaining how the system works. Evaluation dimensions are suggested, not reported findings. Future scope changes require an explicit user instruction and an update to this reference.
