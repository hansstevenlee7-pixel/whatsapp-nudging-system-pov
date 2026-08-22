# Research vision notes — closed-loop behaviour change
*Triage of brainstorm (June 2026). Buckets: BUILD NOW / THESIS TEXT / FUTURE WORK.*

## Core thesis statements (THESIS TEXT — use nearly verbatim)
- The problem is not knowledge; it is behaviour change and consistency. Most people
  already know what to do → the contribution targets the **intention–action gap**
  (same construct as the integration gap already framing the thesis).
- Existing habit trackers are logging systems: open-loop
  (goal → reminder → ignore → repeat). This system is **closed-loop**:
  Observe → Interpret → Intervene → Measure → Adapt.
- Design principle: *a behaviour change system that happens to use LLMs, not an
  LLM application looking for a problem.* (Matches the existing novelty claim.)
- Hypothesis: humans often need adaptive reflection at the right time, not more
  information. (Links to JITAI "right time" and SDT autonomy support.)

## Mapping to existing frameworks (THESIS TEXT)
- "Identify barriers rather than push motivation" → COM-B: barriers are
  Capability/Opportunity deficits; motivation is one component of three.
- "Intervention adapts to the reason for failure" → JITAI tailoring variable =
  barrier type.
- Reflective questioning instead of guilt ("You were consistent for 3 weeks —
  what changed?") → SDT: autonomy-supportive, non-controlling feedback.

## BUILD NOW (scope-safe additions to current architecture)
1. **Barrier enumeration in feedback (Workflow C extension)**
   - Reply SKIP → one follow-up question → map answer to enum:
     `stress | fatigue | time | goal_too_hard | life_event | environment | social | other`
   - Stored in feedback tab. Flat schema preserved.
2. **Rule-triggered reflective nudge (Workflow B variant)**
   - Detect streak-break in schedule_state (rule, no LLM).
   - Send pre-written reflective template variant instead of standard reminder.
3. **Weekly adaptation run (new Workflow D — the key upgrade)**
   - Weekly cron: LLM receives prescription + feedback history + barrier tags →
     regenerates next week's schedule (intensity, frequency, timing, tone).
   - LLM remains batch-only: runs at intake + weekly re-planning, NEVER in the
     delivery path. Extends, does not violate, the standing constraint.
   - This makes the system a true closed-loop adaptive intervention.

## Research question (current, answerable by the pilot)
Can **adaptive scheduled nudging** (barrier-aware, weekly re-planned) outperform
static reminders on adherence and engagement?
- Evaluation: adherence rate, response rate, barrier-resolution over time,
  per-user adaptation trace (qualitative DSR evidence).

## FUTURE WORK chapter (do NOT build for this thesis)
- **Conversational coaching**: LLM in the reply path acting as coach/reflection
  partner. Different reliability, safety, and cost regime; needs its own
  evaluation design. RQ: can adaptive conversational coaching outperform both
  static reminders and adaptive scheduled nudging?
- **Multi-agent barrier reasoning**: secondary agent challenges the user's stated
  barrier (e.g. user says "lack of time", schedule unchanged → hypothesis:
  stress/exhaustion). Reduces shallow self-report explanations.
- **Long-term memory layer**: previous failures, successful interventions,
  personality patterns, recurring obstacles → persistent user model beyond
  schedule_state.
- **Vision**: AI companion supporting who the user wants to become via continuous
  behavioural feedback loops; preventive healthcare / lifestyle medicine setting.
- **Anecdotal seed for discussion section**: the brainstorm conversation itself
  acted as a closed-loop intervention — no new information, value came from
  reflection, context, reframing, adaptation at the right moment.

## Guardrails
- Keep the **doctor's prescription** as the input anchor. Clinical reasoning stays
  human; the system translates, schedules, and adapts. Do not drift into fully
  self-directed habit tracking — it weakens the healthcare framing and safety story.
- Any idea requiring the LLM per-message goes to FUTURE WORK by default.
