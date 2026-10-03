# Part 2 Detailed Outline and Evidence-to-Claim Matrix

**Working title:** Design and Technical Evaluation of an Explainable Adaptive WhatsApp Nudging System Using Synthetic Interaction Data  
**Scope status:** Frozen system-focused technical-feasibility study  
**Part 2 limit:** 8,000 words excluding references  
**Drafting target:** 6,800-7,400 words excluding references  
**Evidence baseline:** local commits `2961495` (implementation) and `869cbe4` (writing handoff)  
**Claim rule:** `scheduled`, `submitted`, `sent`, `delivered`, `read`, `visited`, `replied`, `request received`, `decision applied`, or `unknown`; never infer adherence, behaviour completion, health benefit, real-user preference, acceptability, or clinical readiness.

## 1. Detailed Part 2 outline

### Abstract - 180-220 words

1. Identify the system problem: fixed messaging does not respond to observable interaction patterns, while unconstrained adaptation is inappropriate in a health-related communication system.
2. State the artifact and method: a Design Science Research study of a closed-loop WhatsApp messaging prototype evaluated with deterministic synthetic longitudinal data.
3. State the bounded learning task: regularised logistic regression predicts a tracked-link visit or ordinary reply within 24 hours of confirmed delivery; deterministic rules remain responsible for safety and eligibility.
4. Report only frozen results: test Brier score, test PR-AUC, matched-policy interaction efficiency and message burden, zero simulated constraint violations, and direction reversals.
5. Conclude narrowly: the prototype demonstrates bounded technical behaviour under declared synthetic assumptions, not clinical efficacy or real-user personalisation.
6. State the deployment boundary: the final implementation baseline is locally verified but not deployed; earlier live evidence is limited to controlled Twilio Sandbox text and tracked-media tests.

### 1. Introduction - 750-850 words

#### 1.1 Problem context

- Explain why a fixed schedule can become poorly matched in frequency, time, or approved format.
- Distinguish observable communication traces from unobservable health behaviour.
- Argue that adaptation requires both an explainable recommendation and a deterministic safety envelope.
- `TODO-CITATION`: support claims about digital message burden, adaptive interventions, and observable engagement proxies with verified scholarly sources.

#### 1.2 Research gap

- Narrow the gap to end-to-end integration: delivery, event correlation, prediction, bounded policy, future schedule mutation, and auditability.
- Do not repeat the broad Part 1 argument about clinical effectiveness, Lifestyle Medicine, or the intention-behaviour gap.
- `TODO-CITATION`: verify whether prior closed-loop messaging studies combine all six system properties claimed in the gap statement.

#### 1.3 Aim and research questions

- State the frozen main RQ and RQ1-RQ3 verbatim or with meaning-preserving edits.
- Define “interaction” immediately as a tracked-link visit or ordinary reply within 24 hours after confirmed delivery.

#### 1.4 Contributions

1. A closed-loop artifact that correlates planned delivery, provider events, interaction events, recommendations, policy decisions, and future schedule changes.
2. A reproducible synthetic evaluation comparing fixed, deterministic, and model-assisted frequency policies on matched profiles and seeds.
3. A model-plus-safety architecture that preserves sent history and logs recommendations separately from applied decisions.

#### 1.5 Scope and attribution

- State that Hans designed and implemented the research artifact, integration logic, synthetic experiment, model runtime, safety policy, and audit semantics.
- Attribute Twilio, Supabase, Vercel, Railway/n8n, Google Sheets, Gemini, YouTube, Europe PMC/PubMed, and media authors/providers as external services or sources.

### 2. Background and Related Work - 950-1,100 words

#### 2.1 Digital nudging and message burden

- Discuss digital nudging only to motivate the delivery problem.
- Candidate sources discovered in Part 1: Matthews (2022); Hummel and Maedche (2019); Nazaret and Sapiro (2023).
- `TODO-CITATION`: retrieve and verify the exact claims used; Part 1 is discovery material only.

#### 2.2 Adaptive interventions and decision points

- Explain adaptive interventions and JITAI decision rules without claiming that this artifact is a micro-randomised trial.
- Candidate sources: Collins et al. (2004); Klasnja et al. (2015); Nahum-Shani et al. (2016).
- `TODO-CITATION`: verify definitions and publication metadata from the original papers.

#### 2.3 Interaction as a bounded proxy

- Explain why clicks/replies are observable system events but incomplete indicators of attention or behaviour.
- Candidate sources: Perski et al. (2017); Yardley et al. (2016); Eysenbach (2005).
- `TODO-CITATION`: find direct support for proxy limitations and missingness.

#### 2.4 Explainability and constrained decision support

- Justify regularised logistic regression as a transparent, low-complexity baseline appropriate to a bounded feasibility study.
- Explain why the predictor is subordinate to deterministic rules.
- `TODO-CITATION`: add verified sources for interpretable prediction, calibration, and human oversight in health-related software.

#### 2.5 Synthetic evaluation, reproducibility, safety, and privacy

- Justify synthetic longitudinal data for pre-deployment system evaluation while stating its external-validity limits.
- Discuss fixed seeds, temporal validation, data minimisation, auditability, opt-out, and provider trust boundaries.
- `TODO-CITATION`: add verified sources for synthetic-data evaluation, temporal validation, calibration/Brier score, PR-AUC under class imbalance, and health-data privacy/security.

#### 2.6 Design Science Research framing

- Candidate sources discovered in Part 1: Hevner et al. (2004) and Peffers et al. (2007).
- `TODO-CITATION`: verify both original papers and connect their artifact-build-evaluate cycles specifically to this study.

### 3. Research Method - 1,200-1,400 words

#### 3.1 Study design

- Design Science Research framing; artifact objective; frozen RQs; preregistered-style interpretation of positive and negative results.

#### 3.2 Requirements and success criteria

- Functional, safety, traceability, and reproducibility requirements.
- Define success as correct, repeatable, bounded operation rather than clinical improvement.

#### 3.3 Synthetic longitudinal data

- 300 synthetic users, 12 weeks, seed `5128`, 7,208 message rows, and 1,380 positive rows.
- Document hidden simulation assumptions and explain why they are not model features.
- One row per simulated message; target and exclusions.

#### 3.4 Model training and temporal validation

- Seven declared features; training-only standardisation; regularised logistic regression; no online retraining.
- Exact client-and-time split and row counts; frozen dataset/model identifiers.
- Brier score, log loss, PR-AUC, prevalence and constant-rate baseline.

#### 3.5 Matched policy comparison

- Fixed 2/week, deterministic rule, and model-plus-safety policy.
- Matched synthetic profiles and random variates; interaction efficiency, burden, changes, reversals, and violations.

#### 3.6 Artifact verification

- Source inspection, automated functional tests, syntax checks, frozen artifact reproduction, and dated Sandbox evidence.
- Keep local, deployed, integration, and live WhatsApp verification separate.

#### 3.7 Ethics, privacy, and claim boundary

- Synthetic principal evaluation; no clinical or participant outcome.
- Data minimisation, server-side secrets, signed callbacks, immediate opt-out, pseudonymous research identifiers, and no raw health content in model features.
- `TODO-CITATION`: verify current Monash ethics, data-governance, and retention requirements before submission.

### 4. System Design and Implementation - 1,250-1,450 words

#### 4.1 Architecture and trust boundaries

- Present one architecture figure from clinician envelope to audit record.
- Mark Hans-authored components and externally operated platforms visually.

#### 4.2 Approved plan and outbound delivery

- Clinician-approved action, meaning, media set, time window, frequency range, quiet hours, and opt-in.
- Workflow B as the only outbound path; reservation before Twilio submission; template/Sandbox distinction.

#### 4.3 Event and interaction model

- Correlate provider status, signed inbound replies, and tracked visits.
- Missing read evidence remains `unknown`; no observable interaction is not non-adherence.

#### 4.4 Prediction and policy separation

- Score eligible frequency candidates with the frozen logistic model.
- Apply deterministic eligibility, one-step changes, evidence gates, and clinician envelope.
- Time and media selection remain deterministic.

#### 4.5 Schedule application and traceability

- Dual activation gates; shadow mode by default; future-unsent-only mutation; immutable history.
- Separate recommendation, policy outcome, persistence verification, and audit records.

#### 4.6 External services and media provenance

- Explicitly distinguish the research implementation from Twilio, Supabase, Vercel, Railway/n8n, Google Sheets, Gemini, search APIs, and media creators.
- Media is linked and attributed; the system does not claim authorship, ownership, or content completion.

#### 4.7 Security and failure behaviour

- Fail-closed signatures/secrets, idempotency, high-entropy redirect tokens, HTTPS targets, opt-out, and uncertain submission reconciliation.
- `TODO-CITATION`: cite official provider documentation for the external protocol semantics described.

### 5. Evaluation and Results - 1,250-1,450 words

#### 5.1 RQ1: system operation

- Report 177/177 local tests only after identifying date, commit, environment, and test scope.
- Separate locally verified features from the earlier controlled Sandbox evidence.
- `TODO-EVIDENCE`: complete and redact one ordinary-reply chain across webhook, event, decision, and Monitor.
- `TODO-EVIDENCE`: deploy and verify baseline `2961495` only under a later explicit deployment instruction; do not imply it is deployed now.

#### 5.2 RQ2: model performance

- Report split sizes, positive counts, Brier score, log loss, PR-AUC, and constant-rate baseline.
- Add a calibration table/plot only if regenerated from the frozen artifact.
- Discuss the small validation/test row counts and synthetic generator assumptions.

#### 5.3 RQ3: policy comparison

- Present messages, ordinary interactions, interactions/message, messages/interaction, changes, reversals, and violations.
- Interpret lower burden and higher simulated interaction efficiency without real-user claims.
- Treat 157 model-policy direction reversals as a principal stability limitation.

#### 5.4 Evidence-level summary

- Include one table separating implemented, locally verified, deployed, integration verified, and live WhatsApp verified states.

### 6. Discussion - 900-1,100 words

#### 6.1 Answers to RQ1-RQ3

- Answer each question at its actual evidence level.

#### 6.2 Interpretation and design trade-offs

- Explain why the safety layer, shadow mode, lowest-near-best rule, and immutable history matter.
- Discuss efficiency versus total interactions and stability versus responsiveness.

#### 6.3 Threats to validity

- Construct validity: interaction is an incomplete proxy.
- Internal validity: researcher-authored generator, fixed functional assumptions, and unused client-week combinations in the split.
- External validity: synthetic profiles, one Sandbox phone, no participant study, and provider dependencies.
- Reliability: callbacks can be missing or delayed; tests use fixtures and cannot prove live integration.
- Statistical conclusion validity: small validation/test samples and sparse positives.

#### 6.4 Deployment and clinical boundary

- The final implementation is not production deployed or clinically evaluated.
- Identify the next evidence gates without presenting them as completed work.

### 7. Conclusion and Future Work - 300-400 words

- Give one bounded answer for each RQ.
- Restate the contribution as system design, integration, technical evaluation, and traceability.
- Future work: prospective shadow evaluation, ethics-approved real-user research, stability controls, calibration monitoring, full reply-chain evidence, and production-sender validation.

### References - excluded from word count

- Include only sources cited in Part 2 and verify every bibliographic entry against the original source.
- Do not treat the Part 1 reference list as verification.

## 2. Evidence-to-claim matrix

Status vocabulary:

- **Verified-local:** inspected or reproduced in this checkout on 1 September 2026.
- **Frozen-artifact:** recorded in versioned deterministic output and checked against code/artifact.
- **Dated-live:** supported by an earlier controlled live observation but not refreshed in this writing session.
- **Unverified:** not yet demonstrated at the required evidence level.
- **Citation-needed:** scholarly or provider support must be verified before submission.

| ID | Proposed Part 2 claim | Evidence and location | Status | Permitted wording / required action |
| --- | --- | --- | --- | --- |
| C01 | The study evaluates a system artifact, not clinical efficacy. | `../THESIS_SCOPE_LOCK_2026-08-28.md`; `INSTRUCTIONS.md` | Verified-local | State as the frozen study boundary. |
| C02 | Hans designed and implemented the integration logic, synthetic generator, model runtime, safety policy, schedule mutation, and audit semantics. | Git history at `2961495`; `scripts/`; `landing/api/`; `workflows/`; `supabase/migrations/` | Verified-local | Attribute these as Hans's work; `TODO-EVIDENCE`: prepare an appendix contribution map by file/commit. |
| C03 | Twilio, Supabase, Vercel, Railway/n8n, Google Sheets, Gemini, search providers, and media publishers are external. | `README.md`; `INSTRUCTIONS.md`; package/workflow configuration | Verified-local | Name them as infrastructure/services/sources, not as Hans-authored technology. Add official citations where protocol details matter. |
| C04 | The generator produced 300 synthetic users over 12 weeks with seed 5128. | `scripts/generate-frequency-dataset.js`; reproduced console output | Frozen-artifact | May report as synthetic design, not participant data. |
| C05 | The frozen generated dataset contains 7,208 rows and 1,380 positive labels. | Reproduced generator output; dataset hash `b332923d43e528836c39259fbc35f99485601c60d5db33eddb0d9b3348f3a523` | Frozen-artifact | Report with seed and hash. |
| C06 | A positive label is an ordinary reply or tracked-link visit within 24 hours after confirmed delivery. | `docs/FREQUENCY_MODEL_PROTOCOL.md`; `frequency-shadow.js`; `behaviour-policy.js` | Verified-local | Use “ordinary interaction within 24 hours,” not engagement/adherence. |
| C07 | STOP, PAUSE, MORE, LESS, read receipts, failures, identifiers, prescription text, and future fields are excluded from the learned target/features. | Protocol; generator/model feature contract; `frequency-model.js`; tests | Verified-local | Distinguish control handling from the ordinary-interaction label. |
| C08 | The model uses seven declared current/history/frequency features. | Model JSON and `frequency-model.js` | Frozen-artifact | List exactly; do not claim richer personalisation. |
| C09 | Preprocessing is fitted only on training rows. | `scripts/train-frequency-model.js` | Verified-local | State as leakage control; `TODO-CITATION`: justify temporal validation from literature. |
| C10 | Train/validation/test comprise 3,818/118/109 rows, with 19 validation and 24 test positives. | Frozen model JSON | Frozen-artifact | Report all counts; discuss small later splits and excluded client-week combinations as limitations. |
| C11 | Test Brier score is 0.137161 versus 0.172242 for the constant-rate baseline. | Frozen model JSON; reproducibility test | Frozen-artifact | May say “lower on the frozen synthetic test set,” not generally superior. |
| C12 | Test PR-AUC is 0.518518 at prevalence 0.220183. | Frozen model JSON | Frozen-artifact | Report as synthetic held-out performance; `TODO-CITATION`: verify PR-AUC interpretation source. |
| C13 | The fixed, deterministic, and model-plus-safety policies were replayed on matched synthetic users and random variates. | `scripts/train-frequency-model.js` | Verified-local | Explain matching method; avoid causal generalisation beyond the simulator. |
| C14 | Fixed/deterministic/model policies sent 7,200/5,233/3,800 messages. | Frozen model JSON | Frozen-artifact | Report as simulated message counts. |
| C15 | Their interactions/message were 0.23708/0.26008/0.26842 and messages/interaction were 4.2179/3.84497/3.72549. | Frozen model JSON | Frozen-artifact | Describe as simulated interaction efficiency and burden. |
| C16 | All three replays recorded zero defined constraint violations. | Frozen model JSON; simulator definition in training script | Frozen-artifact | Say zero **defined replay violations**; do not claim real-world safety. |
| C17 | The model policy had 157 direction reversals versus 35 for the deterministic policy. | Frozen model JSON | Frozen-artifact | Present prominently as a stability limitation supporting shadow mode. |
| C18 | The current checkout passes 178 automated tests. | Local `npm test` run on 9 September 2026; 178 passed, 0 failed | Verified-local | Cite as local automated test coverage only; simulated error traces are intentional failure-path tests. |
| C19 | JavaScript syntax checks and `git diff --check` pass. | Local checks on 9 September 2026 | Verified-local | Suitable for appendix/reproducibility notes, not evidence of live integration. |
| C20 | Duplicate reservation, signed callbacks, ordinary-reply idempotency, and STOP behaviour are implemented and locally tested. | `adaptive-handlers.js`; `whatsapp-inbound.js`; Twilio/status tests | Verified-local | “Implemented and locally verified.” |
| C21 | Missing read evidence remains unknown. | `behaviour-policy.js`; `patient-dictionary.js`; tests | Verified-local | Never convert missing callbacks to “unread.” |
| C22 | Only future unsent schedule occurrences are changed; sent history is preserved. | `landing/api/_lib/schedule-store.js`; `landing/tests/adaptive-schedule.test.js`; `docs/MODEL_DRIVEN_SCHEDULE_CHANGE_EXPERIMENT_2026-09-09.md` | Verified-local | “Implemented and locally verified”; report the experiment separately and do not generalise to live data. |
| C23 | Automatic application requires an environment switch and a per-behaviour database flag; default is shadow mode. | `adaptive-handlers.js`; migration `006_bounded_schedule_apply.sql`; model JSON | Verified-local | Explain both gates. Live gate state is dated and must be reverified before any current claim. |
| C24 | Earlier controlled Twilio Sandbox text delivery was observed. | Handoff/runbook evidence | Dated-live | Say “previously observed in a controlled Sandbox test”; `TODO-EVIDENCE`: attach redacted correlation record and date. |
| C25 | Earlier tracked-media delivery and visit correlation were observed. | Handoff/runbook evidence | Dated-live | Say “previously observed”; do not imply final-baseline deployment. `TODO-EVIDENCE`: attach redacted chain. |
| C26 | An ordinary inbound reply has been correlated across webhook, interaction, decision, and Monitor. | No complete captured chain at handoff | Unverified | `TODO-EVIDENCE`: do not claim until demonstrated and redacted. |
| C27 | Baseline `2961495` is deployed and drives the live worker. | Handoff says Vercel deployment and Workflow C update were not done | Unverified | State explicitly that the final baseline is not deployed and live Workflow C was not updated. |
| C28 | Live automatic schedule adaptation has occurred. | No live evidence at handoff | Unverified | `TODO-EVIDENCE`: do not claim. |
| C29 | The system is production-ready for WhatsApp delivery. | Code/runbook plus Sandbox evidence; external sender/template gates incomplete | Partially verified | Use “production-ready code with controlled Sandbox evidence,” followed by the unresolved sender/template/deployment gates. |
| C30 | Linked media is approved and traceable but externally authored/hosted. | Media discovery/approval code; tracked-link store; provider URLs | Verified-local | Attribute authorship and hosting to the source; a visit is not proof of viewing or completion. |
| C31 | Design Science Research is an appropriate methodology for this artifact study. | Hevner et al. (2004); Peffers et al. (2007), discovered via Part 1 | Citation-needed | `TODO-CITATION`: verify original texts and write a study-specific justification. |
| C32 | Interaction traces are incomplete proxies for digital intervention engagement. | Perski et al. (2017); Yardley et al. (2016), discovered via Part 1 | Citation-needed | `TODO-CITATION`: verify exact support; retain the system-level proxy limitation. |
| C33 | Temporal evaluation, Brier score, calibration, and PR-AUC are appropriate choices. | Protocol and implementation; scholarly support not yet verified | Citation-needed | `TODO-CITATION`: add primary methodological sources. |
| C34 | The system satisfies current ethics, privacy, and data-retention requirements. | Security controls are implemented; formal current requirements not verified here | Unverified | Describe implemented privacy controls only. `TODO-CITATION` and `TODO-EVIDENCE`: verify Monash/HREC requirements and any applicable approval before stronger wording. |
| C35 | In a fixed-seed synthetic scenario, the frozen model recommended reducing frequency from 2 to 1 per week; the bounded policy applied that change to the future schedule while preserving delivered state. | `scripts/experiment-modelled-schedule-change.js`; `docs/evidence/modelled-schedule-change-2026-09-09.json`; `docs/MODEL_DRIVEN_SCHEDULE_CHANGE_EXPERIMENT_2026-09-09.md` | Verified-local-synthetic | Report as a reproducible model-to-policy-to-schedule demonstration; do not describe it as an adherence, causal, patient, or live result. |

## 3. Evidence still needed before the Results section is final

1. A redacted ordinary-reply chain across signed inbound webhook, interaction record, policy decision, and Monitor.
2. Redacted, dated evidence packages for the earlier Sandbox text and tracked-media tests.
3. A reproducibility manifest containing commit, Node version, seed, dataset hash, model-file hash, training settings, and command outputs.
4. A frozen calibration table or plot generated directly from the versioned model and untouched test rows.
5. A contribution appendix mapping Hans-authored files/workflows/migrations to third-party libraries and services.
6. Verified scholarly references for every `TODO-CITATION` marker.
7. Current ethics/data-governance wording and, if applicable, approval identifiers; do not infer them from the earlier proposal.

## 4. Part 1 citation-discovery ledger

**SUPERSEDED 12 September 2026.** This ledger was built from the older `...LitReviewProposal_SUBMIT.pdf`. The authoritative source is now `../33292280_HansLee_LitReview_Proposal_REVISED_2026-09-12.pdf`, whose reference list carries full DOIs and can be cited directly rather than rediscovered. One entry in it is incorrect - see `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md`. The table below is retained only as a record of earlier discovery work.

| Part 2 purpose | Discovery candidates | Verification state |
| --- | --- | --- |
| Design Science Research | Hevner et al. (2004); Peffers et al. (2007) | `TODO-CITATION` |
| Adaptive interventions/JITAI | Collins et al. (2004); Klasnja et al. (2015); Nahum-Shani et al. (2016) | `TODO-CITATION` |
| Digital nudging | Matthews (2022); Hummel and Maedche (2019); Nazaret and Sapiro (2023) | `TODO-CITATION` |
| Interaction/engagement proxy | Perski et al. (2017); Yardley et al. (2016); Eysenbach (2005) | `TODO-CITATION` |
| Digital intervention design | Michie et al. (2017); Webb et al. (2010) | `TODO-CITATION` |
| Behavioural background only | Michie et al. (2011); Deci and Ryan (2000); Teixeira et al. (2012) | `TODO-CITATION`; include only if needed for a narrow design constraint |
