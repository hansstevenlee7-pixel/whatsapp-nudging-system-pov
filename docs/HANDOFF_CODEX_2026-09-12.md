# Handoff — Codex session, 12 September 2026

Minor Master's thesis (Monash). **Submission 23 October 2026.** Part 2 is a conference-style paper, max 8,000 words excluding references. Focus is **technical feasibility of an integrated system**, not clinical efficacy.

---

## 1. STOP RULES — read before running anything

**Never run `npm run model:train`.** It calls `scripts/train-frequency-model.js`, which at line 135 does `fs.writeFileSync` to `landing/api/_models/frequency-logistic-v1.json` — the frozen model artifact whose numbers are **already written into the thesis draft**. Running it silently overwrites the evidence base of Chapter 5.

Safe by comparison:

| Command | Effect |
| --- | --- |
| `npm run model:generate` | Safe. Writes to stdout only. |
| `npm test` | Safe. 182 tests expected. |
| `npm run check` | Safe. Syntax only. |
| `npm run model:train` | **DESTRUCTIVE. Do not run.** |

**Recovery if it is run anyway:**

```
git checkout HEAD -- landing/api/_models/frequency-logistic-v1.json
shasum -a 256 landing/api/_models/frequency-logistic-v1.json
```

Expected: `971e347d95f2d2eaf207db7d0d9978defe97df871eeb94068903eb989321aaa2` (verified 12 September 2026 against the committed copy at `2961495`).

**Also forbidden without an explicit new instruction from Hans:** `git push`, any deploy, any change under `landing/api/` or `scripts/`. Pushing `main` may trigger a Vercel production deployment and activate the demo schedule-application path, because both live gates were already prepared. Documentation edits under `docs/` are fine.

---

## 2. Where the data and the model actually are

**The synthetic dataset is not stored on disk.** It is generated in memory and consumed in the same run. It is fully reproducible from seed `5128`.

| Thing | Location |
| --- | --- |
| Generator | `scripts/generate-frequency-dataset.js` |
| Trainer + policy replay | `scripts/train-frequency-model.js` |
| Frozen model artifact | `landing/api/_models/frequency-logistic-v1.json` |
| Runtime inference | `landing/api/_lib/frequency-model.js` |
| Policy + safety layer | `landing/api/_lib/frequency-shadow.js` |
| Time/media rules | `landing/api/_lib/behaviour-policy.js` |

**How the simulated data is produced** (`generate-frequency-dataset.js:24-39`). Each of 300 synthetic users gets three hidden properties: `preferred_frequency ~ U{1,2,3}`, `baseline_logit ~ N(-0.7, 0.65)`, `fatigue ~ U(0.25, 0.80)`. Interaction probability per message is:

```
logit = baseline_logit
      - 0.75 * |f - preferred|
      - fatigue * max(0, f - preferred)
      + 0.90 * recent_interaction_rate
      - 0.22 * noninteraction_streak
      + 0.25 * has_previous_interaction
```

Randomness is keyed by `sha256(seed|userId|week|messageIndex|policy)`, so every run is byte-identical. Dataset: 7,208 rows, 1,380 positive, SHA-256 `b332923d43e528836c39259fbc35f99485601c60d5db33eddb0d9b3348f3a523`.

**Known limitation, already accepted — do not try to fix it.** The generator is a logistic response function and the model is logistic regression, so the model family matches the data-generating process. The predictive comparison is therefore a best case and is reported as a pipeline sanity check, not as evidence of generalisable predictive value. This is disclosed in the thesis limitations. Calibrating the generator to published parameters is explicitly **out of scope** for Part 2.

---

## 3. LLM (Gemini) touchpoints — three, all constrained the same way

Verified in code on 12 September 2026.

| # | Location | Role | Constraint |
| --- | --- | --- | --- |
| 1 | `workflows/workflow_a_intake.json` | Prescription free text + image to canonical `prescriptions`, a dated **week-1** `nudges` schedule, and seeded `schedule_state`. Model `gemini-2.5-flash`, vision. | Locked enums: pillar, category, nudge_type, tone_variant, template_name. Mandatory validation gate rejects the **whole batch** on any enum violation, returns 422, writes nothing. "Normalize Known Enum Drift" corrects only known case/spacing and retired-token drift; everything else is rejected. Week-1 only. `action_text` is clinician-revisable free text. |
| 2 | `landing/api/_lib/media-discovery.js` → `summarizePaper()` | **Summarises** an already-discovered paper into plain English. | Structured JSON schema, five required fields. Does **not** discover, select, or approve media — discovery is via search API, approval is deterministic or clinician. |
| 3 | `landing/api/_lib/reply-classifier.js` → `classifyReply()` | Extracts an explicit patient request from an inbound reply. | Runs `explicitInterpretation()` **first**; calls Gemini only when the deterministic path finds nothing. `temperature: 0`, `responseSchema` with closed value sets. Returns the deterministic result on HTTP failure, parse failure, and every other error path. |

**Call-path safety, verified.** `classifyReply` is invoked from `adaptive-service.js` (the asynchronous worker), **not** from `whatsapp-inbound.js`. No LLM runs in the delivery, status-callback, redirect, or immediate inbound-webhook paths. Workflow C confirms this from a second location and records that search and Gemini credentials remain server-side in Vercel, never in Railway/n8n — a usable point for the security section.

**The pattern to state in the thesis** — identical across all three:

> The LLM proposes within a closed, deterministically validated vocabulary; it never authorises. In every case there is a bounded output vocabulary, a deterministic gate that rejects atomically without partial writes, and a deterministic fallback on every failure path.

This directly answers the Bender et al. (2021) variability and hallucination concern raised in the authoritative literature review §2.6.

**Coherence issue — fix before submission.** Literature review §2.6 says the LLM is "confined to the message surface layer" and that deterministic logic governs "behavioural diagnosis and intervention selection." That understates the system: intake generates the week-1 nudge schedule, which is closer to intervention selection, and the classifier interprets patient intent. Restate §2.6 with the precise pattern above — it is more defensible than "surface layer," not less. Same shape as the engagement-proxy issue in `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md` §3.

**Scope impact: none on the frequency lock.** All three touchpoints sit in RQ1 (traceability) and RQ3 (automation coverage). None is part of RQ2.

**Evaluation item this adds to RQ1.** Demonstrate the intake validation gate rejecting a malformed or drifted Gemini response: show the 422 and that nothing was written. The revised proposal §4.6 explicitly asks for failure cases and this is the strongest one available. Check `landing/tests/` for existing coverage before writing new tests.

---

## 4. Frozen numbers — cite, never recompute

Model: `regularized_logistic_regression`, 7 features, intercept `-1.6002436176913715`.

Split: users 001-240 / weeks 1-8 train (3,818 rows); users 241-270 / weeks 9-10 validation (118 rows, 19 positive); users 271-300 / weeks 11-12 test (109 rows, 24 positive).

| Metric | Validation | Test |
| --- | ---: | ---: |
| Brier score | 0.112762 | 0.137161 |
| Constant baseline Brier | 0.136383 | 0.172242 |
| Log loss | 0.375875 | 0.435158 |
| PR-AUC | 0.478683 | 0.518518 |
| Prevalence | 0.161017 | 0.220183 |

Matched 12-week policy replay:

| Policy | Messages | Interactions | Int./msg | Msg./int. | Changes | Reversals | Violations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed 2/week | 7,200 | 1,707 | 0.23708 | 4.21793 | 0 | 0 | 0 |
| Deterministic | 5,233 | 1,361 | 0.26008 | 3.84497 | 557 | 35 | 0 |
| Model + safety | 3,800 | 1,020 | 0.26842 | 3.72549 | 523 | 157 | 0 |

**Report honestly:** the model policy improves the *ratio* but produces **fewer total interactions** (1,020 vs 1,707). Efficiency and burden must be reported together. The 157 direction reversals are a stability limitation and must not be tuned away.

**Observation for the write-up:** the `current_frequency` coefficient is `-0.0008`, effectively zero — one of the seven features contributes nothing. Report this as an honest finding. **Do not retrain to remove it.**

---

## 5. Locked scope

**Frequency is the only evaluated adaptation dimension.** Delivery window and media format are implemented and demonstrated but are *not* optimisation studies. Basis: revised proposal §4.4, "One bounded adaptation dimension will provide the core experiment." Confirmed by Hans on 12 September 2026. Full detail in `ADAPTATION_SCOPE_LOCK_2026-09-12.md`.

**Authoritative literature review and proposal:** `../33292280_HansLee_LitReview_Proposal_REVISED_2026-09-12.pdf`. The older `...LitReviewProposal_SUBMIT.pdf` is superseded and is historical context only.

---

## 6. What this session produced (docs only, nothing committed)

| File | Contents |
| --- | --- |
| `ADAPTATION_SCOPE_LOCK_2026-09-12.md` | The frequency lock, verified adaptation surface, JITAI mapping, 7 code-vs-docs discrepancies (D1-D7) |
| `PART2_PASSAGES_2026-09-12.md` | Drop-in replacements for draft §2.1 and §4.5 |
| `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md` | Authoritative-source change, a reference error, the Part 1 / Part 2 coherence risk |
| `THESIS_DIRECTION_2026-09-12.md` | **Edited** — repointed to the revised PDF |
| `HANDOFF_THESIS_WRITING.md` | **Edited** — repointed item 7 |
| `PART2_DETAILED_OUTLINE_AND_EVIDENCE_MATRIX.md` | **Edited** — citation ledger marked superseded |

Also verified this session: three Gemini touchpoints and their constraints (section 3), the frozen model SHA-256 against the committed copy, and that `npm run model:train` overwrites the frozen artifact.

Five methodological citations verified 12 September 2026: Christodoulou et al. (2019) *J Clin Epidemiol* 110:12-22; Rudin (2019) *Nat Mach Intell* 1(5):206-215; Nahum-Shani et al. (2018) *Ann Behav Med* 52(6):446-462; Saito & Rehmsmeier (2015) *PLoS ONE* 10(3):e0118432; Van Calster et al. (2019) *BMC Med* 17:230.

---

## 7. Next tasks, in order

1. **Apply the two drafted passages** into the draft at `output/thesis/Hans_Lee_Thesis_Part2_Supervisor_Draft_2026-09-10.docx`. Renumber existing Tables 1-2 in §5 to 2-3.
2. **Fix the Nahum-Shani reference** in the literature review — see `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md` §2.
3. **Draft §1.2 and §6.2** carrying the engagement-proxy argument — see `SOURCE_OF_TRUTH_REVIEW_2026-09-12.md` §3. This is the highest-value remaining writing task.
4. **Rewrite §5 and §6** against the locked RQs. The draft still uses the superseded 28 August RQ1/RQ2/RQ3.
5. **Restate literature review §2.6** on the LLM role using the propose-validate-dispose pattern in section 3 above.
6. **Demonstrate the intake validation gate** rejecting a drifted Gemini response as an RQ1 failure case.
7. **Reproducibility appendix:** record Node version, commit, seed, both hashes, and the `npm run model:generate` transcript. Note that the dataset is regenerated rather than stored.

**Word budget:** draft stood at 7,622 of 8,000 before this session's passages. `§5.3` is the agreed cut when §5 is rewritten.

---

## 8. Evidence levels — never blur these

Implemented / locally verified / deployed / integration verified / live WhatsApp verified are five distinct states. As of this handoff: the final baseline is **not deployed**, live Workflow C was **not updated**, no live automatic schedule change has occurred, and the ordinary inbound reply chain is **not yet correlated** end to end. Earlier Twilio Sandbox text and tracked-media observations are **dated-live** and pre-date the final baseline.

Permitted evidence vocabulary: `scheduled`, `submitted`, `sent`, `delivered`, `read`, `visited`, `replied`, `request received`, `decision applied`, `unknown`. Never claim adherence, behaviour completion, health improvement, clinical effectiveness, or real-user preference inferred from silence.
