# Thesis Writing Plan

## 1. Paper target

Write Part 2 as a fresh, focused conference-style research paper. The binding Monash limit is 8,000 words excluding references; this is a ceiling, not a target. Aim for approximately 6,800-7,400 words so revisions do not cross the limit.

The paper should answer a technical-feasibility question through a Design Science Research study: define the problem and requirements, build the artifact, evaluate it against frozen criteria, and discuss what the evidence does and does not establish.

## 2. Proposed structure and word budget

| Section | Target words | Purpose |
| --- | ---: | --- |
| Abstract | 180-220 | Problem, method, artifact, principal results, bounded conclusion |
| 1. Introduction | 750-850 | System problem, gap, aim, RQs, contributions |
| 2. Background and Related Work | 950-1,100 | Adaptive messaging, JITAI, interaction proxies, explainability, safety and traceability |
| 3. Research Method | 1,200-1,400 | Design Science framing, requirements, synthetic experiment, validation, metrics, ethics/privacy |
| 4. System Design and Implementation | 1,250-1,450 | Architecture, delivery loop, event model, model, safety policy, schedule mutation, audit trail |
| 5. Evaluation and Results | 1,250-1,450 | Functional tests, model performance, policy comparison, safety results, live Sandbox boundary |
| 6. Discussion | 900-1,100 | Interpretation, trade-offs, oscillation, validity threats, synthetic and deployment limits |
| 7. Conclusion and Future Work | 300-400 | Direct answers to RQs and next evidence gates |

Recommended total: about 7,200 words excluding references.

## 3. Section blueprint

### Abstract

Write this last. State that the model is trained and evaluated on synthetic interaction data and that live evidence is limited to controlled Sandbox delivery. Report the frozen predictive and policy results without implying clinical efficacy.

### 1. Introduction

Build a short argument:

1. Fixed digital reminders can continue at poorly matched frequencies, times, or formats.
2. Interaction traces are observable, but health behaviour and preference are usually not.
3. Adaptation in health-related messaging therefore needs an explicit safety envelope and audit trail.
4. The research gap is a simple, end-to-end demonstration joining delivery, observable interaction, an explainable model, bounded adaptation, and traceability.
5. State the main RQ, three sub-questions, and three contributions.

Proposed contributions:

- a closed-loop WhatsApp messaging artifact with correlated delivery and interaction events;
- a reproducible synthetic evaluation of fixed, deterministic, and model-assisted frequency policies; and
- a dual-layer model-and-safety design that changes only future unsent messages and records every recommendation and applied decision.

### 2. Background and Related Work

Use Part 1 to locate sources, but rewrite the argument for the narrower Part 2 question. Prioritise only literature needed to justify:

- digital nudging and alert/message burden;
- just-in-time adaptive interventions and adaptive messaging;
- engagement or interaction as an observable proxy, with explicit limits;
- interpretable models for constrained decision support;
- synthetic data for system evaluation and its validity limits;
- safety, opt-out, privacy, reproducibility, and auditability in health-related messaging systems.

COM-B, Lifestyle Medicine, and autonomy-preserving language are background constraints, not evaluated outcomes. Avoid recreating the broad Part 1 review.

### 3. Research Method

Describe the study before its results:

- Design Science Research framing and artifact objective;
- functional, safety, and traceability requirements;
- 300 synthetic users, 12 weeks, fixed seed `5128`, and declared hidden interaction assumptions;
- one row per confirmed-delivered message;
- target: tracked-link visit or ordinary reply within 24 hours;
- exclusion of `STOP`, explicit control commands, read receipts, delivery failures, identifiers, raw prescriptions, and future information;
- client-and-time split, preprocessing fitted on training data, frozen artifact, and no online retraining;
- fixed, deterministic, and ML-plus-safety comparison on matched users/seeds;
- Brier score and PR-AUC against a constant-rate baseline;
- interaction efficiency, message burden, direction reversals, and safety violations;
- functional and integration test protocol;
- privacy and ethics boundary: synthetic evaluation, data minimisation, signature validation, opt-out, and no clinical claim.

Predefine success as correct and reproducible execution, not a positive clinical outcome. A model that loses to the baseline remains a valid reportable result.

### 4. System Design and Implementation

Use one architecture figure for:

```text
clinician-approved envelope
  -> Workflow B and Twilio delivery
  -> status, reply, or tracked visit
  -> versioned interaction history
  -> logistic-regression recommendation
  -> deterministic safety policy
  -> future-unsent schedule update
  -> append-only audit record
```

Explain these design decisions:

- Workflow B is the only outbound path.
- Multimedia is an approved tracked video, paper, or reading link, not an attachment.
- Frequency is model-assisted; time and media remain deterministic and explainable.
- Missing read evidence is `unknown`; no observable interaction is not non-adherence.
- `STOP` is immediate and absorbing.
- Duplicate reservations prevent repeated Twilio submission.
- Automatic application is dual-gated and normally remains in shadow mode.
- Historical messages are immutable; only future unsent rows can change.
- Every model recommendation is distinct from the final policy and actual schedule.

Clearly attribute infrastructure: Hans designed and implemented the research artifact and integration logic; Twilio, Supabase, Vercel, Railway/n8n, Google Sheets, and approved media providers are external services.

### 5. Evaluation and Results

Organise results by research question rather than chronologically.

**RQ1 - System operation**

- local automated test total and safety cases;
- delivery reservation and duplicate prevention;
- callback/reply idempotency and `STOP`;
- schedule-history preservation and audit completeness;
- controlled Sandbox text and tracked-media evidence;
- explicitly list the still-missing ordinary-reply chain and undeployed final implementation.

**RQ2 - Learning**

- dataset and split counts;
- model feature list and coefficient artifact;
- validation/test Brier score;
- test PR-AUC and prevalence baseline;
- calibration figure or probability-band table if generated from the frozen artifact.

**RQ3 - Adaptation**

- fixed, deterministic, and ML-plus-safety table;
- interaction efficiency and total messages;
- zero safety violations in replay;
- examples of increase, decrease, and hold;
- direction reversals as a stability result, not a footnote.

Do not mix locally tested results with live cloud evidence in one undifferentiated success claim.

### 6. Discussion

Interpret the result narrowly:

- The artifact demonstrates technically bounded adaptability under declared synthetic assumptions.
- The model improved the frozen synthetic predictive baselines and reduced simulated burden, but this is not evidence about real people.
- The safety layer is essential because a prediction alone is not permission to send or change a schedule.
- The model's direction reversals suggest possible instability and justify shadow mode.
- Observable interactions are incomplete proxies; disabled receipts, connectivity, attention, or off-platform action remain unobserved.
- Sandbox delivery supports integration feasibility but is not production or clinical deployment evidence.

Validity threats should cover simulation assumptions, dataset shift, sparse positive events, provider callback incompleteness, one test phone, external service dependence, implementation-test coverage, and researcher-built synthetic data.

### 7. Conclusion and Future Work

Answer each RQ in one bounded sentence. Future work can include prospective shadow evaluation, real-user research with ethics approval, calibration monitoring, stability controls, and production sender validation. Do not propose a wider autonomous clinical system as if it were already justified.

## 4. Required tables and figures

Keep visuals few and useful:

1. end-to-end architecture and trust boundaries;
2. event and decision sequence from scheduled message to future adaptation;
3. synthetic-data generation and temporal split diagram;
4. model-versus-baseline metric table;
5. three-policy comparison table;
6. increase/decrease/hold replay examples with safety reasons;
7. evidence-level table separating local, deployed, integration, and live WhatsApp verification.

Optional only if generated from the frozen artifact: a calibration plot. Do not add decorative dashboard screenshots to the main paper; place detailed screenshots in the appendix.

## 5. Claim and terminology rules

| Use | Avoid |
| --- | --- |
| ordinary interaction within 24 hours | engagement success, adherence |
| no observable interaction after a closed window | ignored, non-adherent, disliked |
| delivery/read evidence | proof the message was understood |
| tracked-link visit | content consumed or behaviour completed |
| synthetic user or synthetic profile | patient when discussing simulation |
| model recommendation | AI decision or autonomous clinical decision |
| deterministic safety policy | human-like judgement |
| bounded technical feasibility | clinical effectiveness or real-world safety |
| production-ready code with Sandbox evidence | live production system |

## 6. Writing order

Use this order so drafting follows the strongest existing evidence:

1. Research Method.
2. System Design and Implementation.
3. Evaluation and Results from frozen artifacts.
4. Discussion and validity threats.
5. Introduction and focused related work.
6. Conclusion.
7. Abstract.
8. Final claim audit, citation audit, word count, and rubric check.

Maintain an evidence-to-claim matrix while drafting. Every numeric result must point to a reproducible artifact or captured evidence. Mark missing evidence as `TODO-EVIDENCE`; mark missing scholarly support as `TODO-CITATION`. Never fill either gap from memory alone.

## 7. Definition of thesis-writing completion

Before submission, confirm:

- Part 2 is at or below 8,000 words excluding references;
- the submitted Part 1 is included before Part 2 in the full thesis as required, and no Part 1 prose was copied into Part 2;
- every research question is answered using the correct evidence level;
- methodology decisions are justified, not merely described;
- ethics and data privacy are explicit;
- Hans's work and third-party work are clearly distinguished;
- results remain reproducible from frozen seeds, hashes, versions, and scripts;
- limitations include synthetic-data and deployment boundaries;
- appendices support but do not extend the substantive argument; and
- the final PDF filename follows the Monash convention: `33292280-HansLee-DavidTaniar-Thesis.pdf`.
