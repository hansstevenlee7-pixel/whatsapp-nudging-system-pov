# Part 2 Working Draft: Research Method and System Design

**Draft status:** fresh Part 2 prose; not copied from the submitted Part 1 paper  
**Evidence convention:** unresolved scholarly support is marked `TODO-CITATION`; incomplete or non-current empirical support is marked `TODO-EVIDENCE`  
**Word-budget rule:** maximum 8,000 words excluding references

## 3. Research Method

### 3.1 Study design

This study used a Design Science Research approach to build and evaluate a bounded adaptive messaging artifact. The approach was selected because the research questions concern whether an integrated information system can execute a defined closed loop, whether its learning component can recover declared patterns in controlled longitudinal data, and whether its recommendations can be converted into safe and traceable schedule changes. The unit of contribution is therefore the artifact and its evaluated behaviour, rather than a new clinical intervention or machine-learning algorithm. `TODO-CITATION: verify and cite the original Design Science Research formulations by Hevner et al. (2004) and Peffers et al. (2007), and justify the exact build-evaluate cycle used here.`

The study fixed the claim boundary and requirements before interpreting results, then evaluated the artifact through source checks, automated tests, frozen predictive metrics, and matched policy replay. This order treats an unfavourable result as evidence rather than as a reason to redefine the task after testing, consistent with the assessment instructions' preregistered-study perspective.

The main research question asks to what extent a closed-loop WhatsApp system can use synthetic interaction histories to adapt future delivery within predefined constraints while remaining reliable and traceable. RQ1 evaluates execution of the send-observe-recommend-adapt-log cycle. RQ2 evaluates prediction of an ordinary interaction within 24 hours. RQ3 compares fixed, deterministic, and model-assisted frequency policies in simulation. None of these questions tests adherence, behaviour change, health improvement, acceptability, or clinical effectiveness.

### 3.2 Requirements and success criteria

Functional requirements covered delivery preparation, event correlation, visits, replies, recommendations, deterministic time/media rules, and changes to later unsent messages. Safety requirements specified zero duplicates, zero sends after `STOP`, no outside-envelope option, no frequency increase from silence, and no use of delivery failure as preference evidence. Traceability separated recommendation, policy outcome, and persisted change. Reproducibility fixed the seed, label, features, split, model, policy, and hashes.

Technical success was defined as correct and reproducible execution against these requirements. Predictive improvement was evaluated, but it was not a prerequisite for reporting the study. Likewise, a higher simulated interaction rate could not compensate for a safety violation. This ordering prevented an accuracy measure from overriding the system's opt-out, clinician-envelope, or historical-integrity constraints.

### 3.3 Synthetic longitudinal data

The principal experiment used synthetic rather than participant data. A deterministic generator created 300 synthetic profiles over 12 simulated weeks using seed `5128`. Each profile contained three hidden simulation properties: a preferred weekly frequency between one and three messages, a baseline interaction tendency, and a burden sensitivity when frequency exceeded the hidden preference. These hidden properties generated outcomes but were not exposed as model features. This separation forced the model to use only observable histories and eligible scheduling variables.

One data row represented one simulated message opportunity. The generated dataset contained 7,208 rows, of which 1,380 were positive. A positive label represented an ordinary typed reply or a tracked-link visit within 24 hours after confirmed delivery. A negative label represented neither event after the 24-hour window closed. `STOP`, `PAUSE`, explicit frequency commands such as `MORE` and `LESS`, provider read receipts, delivery failures, identifiers, raw prescription text, and future or post-window fields were excluded from the learned target and feature set. Silence was recorded only as no observable interaction; it was not assigned a behavioural or clinical meaning.

The simulator combined the hidden properties with recent interaction history. These researcher-specified assumptions create the learnable signal and therefore limit external validity; they are not estimates of human behaviour. `TODO-CITATION: add verified sources on synthetic pre-deployment evaluation and researcher-specified simulation risks.`

### 3.4 Model development and temporal validation

The learning component was a pooled regularised logistic-regression model. It used seven features: candidate frequency, current frequency, recent interaction rate, consecutive non-interactions, an indicator for any previous interaction, candidate frequency multiplied by recent interaction rate, and candidate frequency multiplied by the non-interaction streak. Continuous preprocessing statistics were fitted on training rows only. The runtime artifact contains the feature order, means, scales, intercept, coefficients, seed, dataset hash, split definition, metrics, and policy comparison. It does not retrain online.

The split separated profiles and time. Profiles `001-240` in weeks 1-8 produced 3,818 training rows; profiles `241-270` in weeks 9-10 produced 118 validation rows with 19 positives; and profiles `271-300` in weeks 11-12 produced 109 untouched test rows with 24 positives. Other client-week combinations were unused. The split reduces direct profile and future-time leakage but yields small later samples and discards much of the panel. `TODO-CITATION: verify a primary source for temporal validation and leakage control.`

Predictive performance was assessed with Brier score, log loss, and precision-recall area under the curve. Brier score was the primary calibration-sensitive error measure, while PR-AUC described ranking performance for the less frequent positive outcome. The comparator was a constant probability equal to the training prevalence. `TODO-CITATION: add verified methodological references for Brier score, calibration, PR-AUC under class imbalance, and constant-rate baselines.` Accuracy was not used as a primary metric because a majority-class prediction could obscure performance on ordinary interactions.

The frozen dataset SHA-256 is `b332923d43e528836c39259fbc35f99485601c60d5db33eddb0d9b3348f3a523`; the model-file SHA-256 is `971e347d95f2d2eaf207db7d0d9978defe97df871eeb94068903eb989321aaa2`. `TODO-EVIDENCE: add the runtime version, commit, optimisation settings, and command transcript to the appendix.`

### 3.5 Matched policy evaluation

Three policies were replayed for the same 300 profiles over 12 weeks. The fixed policy sent twice weekly. The deterministic policy changed frequency from declared history rules. The model-assisted policy scored allowed frequencies before the runtime safety constraints. Each began at twice weekly. Pseudo-random variates were keyed by seed, profile, week, message index, and replay namespace to make the comparison reproducible.

Policy measures were total delivered messages, ordinary interactions, interactions per message, messages per interaction, frequency changes, direction reversals, and defined constraint violations. Interaction efficiency and message burden were reported together because a policy can improve a ratio by sending fewer messages while also producing fewer total interactions. Direction reversals were retained as a stability measure. No post-test tuning was used to remove the frozen model policy's reversal result.

### 3.6 Artifact verification and evidence levels

The implementation was inspected at local commit `2961495` and the writing handoff at `869cbe4`. On 1 September 2026, the current checkout passed 177 automated tests with no failures, the JavaScript syntax checks passed, and `git diff --check` passed. The tests cover deterministic generation and training, feature-contract validation, duplicate reservation, signed callbacks, reply idempotency, `STOP`, 24-hour outcome closure, bounded policy decisions, future-only schedule mutation, and audit persistence. Some tests deliberately emit simulated storage failures to verify that partial writes are not reported as successful. These are local tests with fixtures; they are not evidence that the cloud services exchanged records in production.

Evidence is classified as implemented, locally verified, deployed, integration verified, or live WhatsApp verified. Earlier controlled Sandbox observations support a text send and tracked-media visit, but pre-date the final baseline. `TODO-EVIDENCE: attach redacted, dated correlation records.` A complete ordinary-reply chain across webhook, event, decision, and Monitor is unverified. The final baseline was not deployed, Workflow C was not updated live, and no live automatic schedule change has been observed.

### 3.7 Ethics, privacy, and interpretation boundary

Because the principal evaluation is synthetic, it does not expose participants to an intervention and does not estimate a health outcome. This does not remove the need to address privacy and safety in the artifact. The design minimises model inputs, excludes names, phone numbers, and raw prescriptions, keeps service credentials server-side, validates Twilio signatures before reading or changing patient state, records events idempotently, uses revocable high-entropy redirect tokens, and treats `STOP` as immediate and absorbing. Search providers receive only an action, pillar, and category rather than patient identifiers or interaction history.

The study does not claim ethics approval, clinical safety, or compliance merely from these controls. Any prospective participant evaluation requires the applicable Monash review, consent, retention, and data-governance arrangements. `TODO-CITATION: verify the current Monash ethics, privacy, and research-data requirements.` `TODO-EVIDENCE: insert the applicable approval identifier and approved protocol only if approval exists and has been checked.`

## 4. System Design and Implementation

### 4.1 Architecture and responsibility boundaries

The artifact implements a closed loop with eight stages:

```text
clinician-approved envelope
  -> due-message selection and delivery reservation
  -> Twilio submission
  -> delivery, reply, or tracked-visit evidence
  -> versioned interaction history
  -> logistic-regression recommendation
  -> deterministic safety policy
  -> future-unsent schedule update and audit record
```

Hans designed and implemented the research-specific portal, APIs, workflow configurations, event semantics, synthetic generator, logistic-regression training and JavaScript inference, deterministic adaptation rules, schedule writer, audit structures, migrations, and automated tests. The surrounding platforms are not contributions claimed as original work. Twilio is the external WhatsApp delivery and callback provider. Supabase supplies externally operated PostgreSQL, authentication, and storage services. Vercel hosts the portal and server-side APIs. Railway hosts the n8n runtime, while n8n is the external workflow-orchestration engine in which the project's workflow definitions run. Google Sheets is the external clinical schedule and research-export surface. Gemini, YouTube, Europe PMC/PubMed, and the linked media publishers are external models, search services, repositories, or content sources. `TODO-CITATION: add official documentation citations where the paper relies on provider-specific protocol behaviour.`

The browser is separated from privileged services. Clinician pages call same-origin APIs and do not receive provider credentials or worker secrets. Supabase is authoritative for operational adaptation state; Google Sheets retains the approved schedule, dated delivery rows, current delivery state, and research-facing exports. This division does not imply that either external platform was designed by Hans.

### 4.2 Clinician envelope and outbound path

Automation begins only after a clinician defines an eligible envelope. The envelope limits the prescribed action and message meaning, permitted media formats and assets, delivery window, quiet hours, and minimum and maximum frequency. The model cannot alter diagnosis, treatment, medication, the intended action, or the approved source set. A recommendation outside the envelope is rejected and recorded.

Workflow B is the only outbound delivery path. It polls for approved, generated occurrences that are due in a narrow Melbourne-time window and calls a signed server endpoint to prepare each delivery. Preparation first verifies that the recipient is active and opted in. It then reserves the occurrence with a unique delivery-attempt identifier before any Twilio request is made. An occurrence already reserved, queued, sent, delivered, or read is not submitted again. An uncertain submission remains reserved for reconciliation rather than being retried blindly.

For a controlled Sandbox session, Workflow B may send a free-form body to a phone that has joined the Sandbox and opened the permitted conversation window. The production branch instead requires a configured Messaging Service and approved content template; it does not silently fall back to a free-form message. `TODO-CITATION: verify and cite Twilio's current WhatsApp template, session-window, callback, and signature requirements before final submission.` The final production sender configuration and final-baseline deployment remain unverified. `TODO-EVIDENCE: do not describe the system as a live production sender.`

### 4.3 Media selection and provenance

The delivery system supports text-only messages or an approved video, paper, or reading resource. Multimedia is delivered as a validated HTTPS link rather than as a direct WhatsApp attachment. The preparation API may use a clinician-selected asset or a bounded automatic selection from the approved pool. It creates a high-entropy tracked redirect associated with the user, behaviour, nudge, and asset, appends the attributed resource title and source to the message, and records the actual selection.

External search is restricted to the behaviour-owned action, pillar, and category. Trusted institutional YouTube channels and open-access literature services can provide candidates; a clinician approves the usable pool before delivery. Gemini may summarise retrieved and validated paper content, but it does not determine the clinical action and is not the learning model evaluated by RQ2. The media authors and publishers retain authorship, and their external services host the original resources. The implemented contribution is restricted retrieval, deterministic ranking, approval, tracked selection, and provenance recording. A tracked visit proves that the redirect was requested; it does not prove that a video was watched, a paper was read, or a prescribed action was completed.

### 4.4 Event and interaction model

Twilio reports provider lifecycle states such as submitted, sent, delivered, read, failed, and undelivered when available. The public status and inbound endpoints validate the Twilio signature before accessing stored state. Status events are correlated by the provider message identifier and processed idempotently. A missing read callback remains `unknown`, because receipt availability can depend on provider and recipient settings.

An ordinary reply is stored once using the inbound message identifier and acknowledged immediately; interpretation is delegated to an asynchronous worker. `STOP` is processed before any other interpretation, changes the opt-in state, and cancels future unsent occurrences. Explicit control instructions are not ordinary-interaction labels. Tracked-link redirects record a visit before returning an HTTPS redirect to the approved source. For each confirmed delivery, the evidence builder keeps the outcome window open for 24 hours and then records either an ordinary interaction or no observable interaction. The latter is missing system evidence, not evidence of non-adherence, dislike, or inaction.

### 4.5 Model recommendation and deterministic policy

The frozen logistic-regression artifact scores candidate weekly frequencies from one to three, limited further by the clinician envelope. Runtime inference uses the same ordered features and standardisation values stored with the artifact. The selector chooses the lowest frequency whose predicted interaction probability lies within five percentage points of the highest candidate score. This rule expresses a burden preference when predicted interaction probabilities are similar.

The recommendation is not permission to change the schedule. A deterministic policy restricts changes to one frequency step per week, requires two recent ordinary interactions before an increase, and requires two closed non-interaction windows before a model-assisted decrease. Silence can never raise frequency. Explicit valid patient requests take precedence, while outside-envelope requests are recorded without application. Uncertain or unsupported cases hold the current setting.

Delivery-time and media adaptation remain deterministic. Time can move by at most one approved morning, afternoon, or evening window after at least two ordinary interactions support that window. Media selection applies an explicit format request first, then considers tracked visits by approved format, and otherwise rotates the least-recently-used approved resource. A read receipt is exposure evidence only and does not drive preference inference.

This design deliberately separates four layers: model recommendation, deterministic safety policy, clinician decision where required, and actual scheduled send. It therefore avoids describing the logistic model, Gemini, or the workflow engine as an autonomous clinical decision-maker.

### 4.6 Shadow mode, schedule mutation, and auditability

Shadow mode is the default. In this mode the system records what the model and policy would recommend but leaves the schedule unchanged. Automatic application requires both `ADAPTIVE_SCHEDULE_APPLY_ENABLED=true` in the server environment and `automatic_schedule_apply=true` on the approved behaviour envelope. The dual gate prevents a deployment-wide switch from silently activating every behaviour.

When both gates permit application, the schedule writer changes only active future unsent occurrences for the affected behaviour. Frequency reductions retain evenly spaced recurring slots; increases create stable slot identifiers and choose unused weekdays to preserve spacing. A time change modifies the eligible future occurrences. Previously sent or otherwise historical rows remain immutable. After writing, the server reloads the canonical schedule and verifies persistence rather than treating a write request as proof of success.

Each closed-window evaluation has a stable key so repeated worker runs do not create duplicate decisions. The audit trail records a model-recommendation row separately from the policy row. The latter identifies shadow, applied, or no-change behaviour and retains the previous and next state, frequency before and after, candidate scores, reasons, changed fields, effective time, and policy/model version. Media assignments preserve the actual asset, selection mode, source and tracked URLs, planned frequency, lifecycle timestamps, and observable latencies. This separation allows a reviewer to distinguish what the model proposed, what the safety policy allowed, what was persisted, and what was eventually sent.

### 4.7 Failure and deployment boundaries

The design fails closed when public signatures, internal worker secrets, authentication, consent, eligible assets, or safe schedule state are absent. Duplicate callbacks and replies are idempotent, and an already-reserved delivery is not resubmitted. These properties are implemented and locally tested, but fixture-based tests cannot prove external availability or production correctness.

At the current evidence boundary, commit `2961495` is local and was not deployed in the final implementation turn; the remote main branch remained at the earlier baseline recorded in the handoff. The updated Workflow C definition was not installed or activated in the live n8n service, and no live automatic schedule change was demonstrated. Earlier controlled Sandbox delivery evidence supports limited integration feasibility but does not establish a production deployment or clinical readiness. `TODO-EVIDENCE: refresh each live layer separately only after explicit deployment approval, and record implemented, deployed, integration-verified, and live-WhatsApp-verified states independently.`

## Running Part 2 word budget

The outline targets approximately 7,200 words excluding references. Counts below are to be refreshed after every substantive edit using one consistent counting method.

| Section | Target | Current draft | Budget status |
| --- | ---: | ---: | ---: |
| Abstract | 180-220 | 0 | 180-220 available |
| 1. Introduction | 750-850 | 0 | 750-850 available |
| 2. Background and Related Work | 950-1,100 | 0 | 950-1,100 available |
| 3. Research Method | 1,200-1,400 | 1,318 | Within target |
| 4. System Design and Implementation | 1,250-1,450 | 1,433 | Within target |
| 5. Evaluation and Results | 1,250-1,450 | 0 | 1,250-1,450 available |
| 6. Discussion | 900-1,100 | 0 | 900-1,100 available |
| 7. Conclusion and Future Work | 300-400 | 0 | 300-400 available |
| **Part 2 total** | **about 7,200; maximum 8,000** | **2,751** | **4,449 to the 7,200 target; 5,249 to the ceiling** |

If every undrafted section used the top of its range, the projected total would be 7,871 words, leaving only 129 words of ceiling headroom. Subsequent drafting should therefore aim near the middle or lower end of each range.
