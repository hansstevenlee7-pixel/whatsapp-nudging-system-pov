# Thesis Writing Handoff

**Prepared:** 1 September 2026  
**Repository:** `Whatsapp Nudging System - System POV`  
**Branch:** `main`  
**Implementation baseline:** `2961495` (`Implement bounded adaptive scheduling and behavior evidence`)

## 1. Purpose of the next session

Begin writing Part 2 of the thesis as a fresh, focused research paper. Do not restart implementation or broaden the product unless a missing item is necessary to answer one of the frozen research questions.

Read these sources in order:

1. `docs/HANDOFF_THESIS_WRITING.md` - current evidence and deployment boundary.
2. `docs/THESIS_WRITING_PLAN.md` - paper structure, word budget, and writing order.
3. `../THESIS_SCOPE_LOCK_2026-08-28.md` - frozen research scope and claim boundary.
4. `docs/FREQUENCY_MODEL_PROTOCOL.md` - model, validation, policy, and frozen results.
5. `INSTRUCTIONS.md` - implementation and safety contract.
6. `../Thesis Instructions - 24-S2.pdf` - binding submission instructions and rubric.
7. `../33292280_HansLee_LitReview_Proposal_REVISED_2026-09-12.pdf` - the AUTHORITATIVE literature review and proposal as of 12 September 2026. The older `...LitReviewProposal_SUBMIT.pdf` is superseded and is historical context only.

The Monash instructions require Part 2 to be a conference-style research paper of no more than 8,000 words excluding references. Part 2 must be written afresh: do not copy text from the submitted literature review. The paper must clearly distinguish Hans's work from third-party services, libraries, sources, and supervisory input.

## 2. Frozen research position

### Working title

**Design and Technical Evaluation of an Explainable Adaptive WhatsApp Nudging System Using Synthetic Interaction Data**

### Main research question

> To what extent can a bounded WhatsApp nudging system use observable delivery and interaction traces to adapt the frequency, delivery window, and approved media format of future messages while maintaining reliable and traceable delivery?

### Sub-questions

- **RQ1 - System operation:** Can the prototype complete the send-observe-recommend-adapt-log cycle with delivery tracking, interaction capture, duplicate prevention, bounded changes, and immediate `STOP` handling?
- **RQ2 - Learning:** How well does the frozen regularised logistic-regression model predict an ordinary interaction within 24 hours of confirmed delivery in synthetic longitudinal data?
- **RQ3 - Adaptation:** Compared with fixed delivery and deterministic adaptation, does model-assisted adaptation improve interaction efficiency or reduce message burden in matched simulation without violating the safety envelope?

### Contribution boundary

The contribution is the design, integration, technical evaluation, bounded adaptation, reproducibility, and traceability of the system. It is not a new clinical intervention or ML algorithm.

Permitted claims describe `scheduled`, `submitted`, `sent`, `delivered`, `read`, `visited`, `replied`, `request received`, `decision applied`, and `unknown` evidence. Do not claim adherence, behaviour completion, health improvement, clinical effectiveness, real-user preference from silence, WhatsApp reading duration, or video completion.

## 3. Current implementation and evidence status

Keep the evidence levels separate in the thesis.

| Item | Status | Defensible statement |
| --- | --- | --- |
| Text and tracked-media delivery path | Implemented and locally verified | Workflow B supports text and approved tracked resource links. |
| Twilio duplicate reservation, lifecycle callbacks, signed inbound/status webhooks, and `STOP` | Implemented and locally verified | Automated tests cover the safety behaviour. |
| Passive interaction evidence | Implemented and locally verified | The Monitor derives deliveries, read-known/read-unknown, visits, replies, latencies, and closed/open 24-hour windows. |
| Frequency model | Implemented, frozen, and locally verified | A synthetic-trained regularised logistic regression performs deterministic JavaScript inference from a versioned JSON artifact. |
| Bounded frequency/time/media policy | Implemented and locally verified | Frequency uses the model plus safety rules; time and media use deterministic, explainable rules. |
| Future schedule application | Implemented and locally verified | Only future unsent rows change; sent history is preserved and changes are verified after persistence. |
| Local validation | Passed at implementation baseline | `npm test`: 177/177; `npm run check`: passed; `git diff --check`: passed. Re-run before citing final counts. |
| Earlier Twilio Sandbox text proof | Previously live verified | A controlled text message reached the test phone and its Twilio lifecycle was inspected. This was not repeated in the final implementation turn. |
| Earlier tracked-media proof | Previously live verified | An approved WHO video link reached the test phone and tracked visits were correlated. This was not repeated in the final implementation turn. |
| Ordinary inbound reply chain | Not yet confirmed as complete evidence | Do not claim this acceptance item until one reply is correlated across inbound webhook, interaction record, decision, and Monitor. |
| Supabase migration 006 | Applied live on 31 August 2026 | `automatic_schedule_apply` exists; it was enabled only for the approved synthetic/demo behaviour. Reverify before describing it as current. |
| Vercel apply environment switch | Configured on 31 August 2026, but dormant | `ADAPTIVE_SCHEDULE_APPLY_ENABLED=true` was added to Production; Vercel requires a new deployment before the new code can use it. |
| Vercel deployment of baseline `2961495` | Not done | The local implementation is not deployed. `origin/main` remained at `929a81d` at handoff time. |
| Live Workflow C frequency worker | Not done | The workflow JSON is updated locally, but the live n8n workflow was not updated or activated in the final turn. |
| Live automatic schedule change | Not done | No new live message was sent and no production schedule was automatically changed in the final turn. |
| Production WhatsApp sender | External gate not complete | Describe the artifact as production-ready code with Sandbox evidence, not as a live production sender. |

The local application switch is deliberately dual-gated. Automatic schedule application requires both the Vercel environment switch and the behaviour-level Supabase flag. Shadow mode remains the default for all other behaviours.

## 4. Frozen model evidence

The dataset generator creates 300 synthetic users over 12 weeks with seed `5128`. One training row represents one confirmed-delivered message. A positive outcome is an ordinary reply or tracked-link visit within 24 hours; a negative outcome is neither event after the window closes.

The frozen test results are:

| Measure | Model | Constant-rate baseline |
| --- | ---: | ---: |
| Test Brier score | 0.137161 | 0.172242 |
| Test PR-AUC | 0.518518 | 0.220183 prevalence |

The matched policy replay is:

| Policy | Messages | Interactions/message | Messages/interaction | Safety violations |
| --- | ---: | ---: | ---: | ---: |
| Fixed at 2/week | 7,200 | 0.23708 | 4.2179 | 0 |
| Deterministic rule | 5,233 | 0.26008 | 3.84497 | 0 |
| ML plus safety | 3,800 | 0.26842 | 3.72549 | 0 |

Retain the 157 model-policy direction reversals, versus 35 under the deterministic rule, as a stability limitation. Do not tune it away after observing the frozen test result.

## 5. Evidence map for the paper

| Thesis section | Primary project evidence |
| --- | --- |
| Research method | `../THESIS_SCOPE_LOCK_2026-08-28.md`, `docs/FREQUENCY_MODEL_PROTOCOL.md` |
| Architecture and interfaces | `README.md`, `INSTRUCTIONS.md`, `workflows/`, `landing/api/` |
| Synthetic data and training | `scripts/generate-frequency-dataset.js`, `scripts/train-frequency-model.js` |
| Frozen model artifact | `landing/api/_models/frequency-logistic-v1.json` |
| Adaptation policy | `landing/api/_lib/frequency-shadow.js`, `landing/api/_lib/behaviour-policy.js` |
| Schedule mutation and safety | `landing/api/_lib/schedule-store.js`, `landing/api/_lib/adaptive-handlers.js` |
| Audit/data semantics | `docs/PATIENT_ADAPTATION_DATA_DICTIONARY.md`, Supabase migrations |
| Functional evidence | `landing/tests/`, local test output, controlled Sandbox evidence |
| Delivery configuration and limitations | `docs/TWILIO_DELIVERY_RUNBOOK.md` |

For appendices, retain code/version identifiers, frozen dataset and model hashes, test output, architecture and Monitor screenshots, redacted Twilio correlation evidence, migration versions, and the experimental protocol. Never include secrets, full phone numbers, or health information.

## 6. Safe continuation boundary

Do not push or deploy automatically in the thesis-writing session. Pushing `main` may trigger a Vercel production deployment and activate the demo schedule-application path because the two live configuration gates were prepared. Deployment requires a separate, explicit instruction after reviewing this handoff.

If live evidence is refreshed later, record the exact date and separate these states: implemented, locally verified, deployed, integration verified, and live WhatsApp verified.

## 7. Copy-ready prompt for the new session

```text
Resume my Master's thesis from the System POV repository. Read docs/HANDOFF_THESIS_WRITING.md, docs/THESIS_WRITING_PLAN.md, ../THESIS_SCOPE_LOCK_2026-08-28.md, docs/FREQUENCY_MODEL_PROTOCOL.md, INSTRUCTIONS.md, and the binding ../Thesis Instructions - 24-S2.pdf. Use my submitted Part 1 PDF only as background and citation discovery; do not copy its prose into Part 2. Keep the study system-focused, synthetic, bounded, and evidence-led. Do not push or deploy.

Start by creating the detailed Part 2 outline and an evidence-to-claim matrix, then draft the Research Method and System Design sections in fresh language. Mark every missing citation or unverified result explicitly instead of inventing it. Keep a running word budget below 8,000 words excluding references and clearly distinguish my implementation from Twilio, Supabase, Vercel, Railway/n8n, Google Sheets, and third-party media sources.
```

