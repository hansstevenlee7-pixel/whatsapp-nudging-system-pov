# Patient adaptation data dictionary

This dictionary is the operational and research contract for the patient adaptation loop. Supabase is authoritative; the two Google Sheet tabs are idempotent exports for clinician review and analysis.

## Frequency measures

| Field | Definition | Source | Interpretation |
| --- | --- | --- | --- |
| `planned_frequency` | Active recurring schedule slots for a behaviour in a week | `weekly_schedule` | Intended message opportunity |
| `delivered_frequency` | Occurrences with a Twilio `delivered` or `read` state | `schedule_state` / delivery events | Provider-confirmed exposure |
| `requested_frequency` | Latest explicit patient frequency request represented in an approved decision | adaptation state / decisions | A requested future setting, not adherence |
| `observed_frequency` | Link visits plus typed replies during the week | interaction events | Interaction evidence only |

Sent counts and read counts are retained separately. A missing read callback is `unknown`, never `unread`.

After 24 hours, each confirmed delivery is classified as either `ordinary_interaction` (tracked visit or ordinary typed reply) or `no_observable_interaction`. The second label describes only missing system evidence; it is not a preference, adherence, or health-behaviour label.

## Media and time fields

Each dated occurrence preserves `media_selection_mode` (`automatic`, `text_only`, or `clinician_selected`), the actual `media_asset_id` and `media_kind`, and the original source URL. It also retains scheduled, sent, delivered, read, visited, and replied timestamps plus send-to-read/visit/reply latencies.

All stored event timestamps are UTC. The monitor renders them in `Australia/Melbourne`.

The derived passive-evidence view includes read-known/read-unknown counts, first visit and reply times, send-to-read/visit/reply latency, interaction window (`morning`, `afternoon`, or `evening`), and the number of open and closed 24-hour outcome windows. WhatsApp reading duration and external video completion are not collected.

## Applied communication policy

- Frequency uses the frozen regularised logistic-regression artifact and a deterministic safety layer.
- Delivery time moves by at most one approved window after at least two ordinary interactions support the same window.
- Explicit media requests override implicit evidence; otherwise tracked visits score approved formats and weak evidence falls back to least-recently-used rotation.
- Changes affect future unsent occurrences only. The audit timeline retains the model recommendation, policy outcome, previous state, next state, changed fields, and application mode.

## Adaptation scopes

`user_adaptation_state` is behaviour-specific. `patient_adaptation_state` is a patient-wide fallback. A behaviour-specific value wins; the global value is not copied into or broadcast across other behaviours.

Every decision records its scope, source, effective time, state version, changed fields, previous state, new state, rule, outcome, and reason. Decisions and timeline exports are append-only. Current state is updated separately for fast reads.

## Synthetic acceptance trace

The minimal fixture should demonstrate: baseline three planned messages with automatic media; a typed video preference; a valid frequency change within the envelope; a clinician media override; a natural link visit; a reply; and a silent week that rotates media without reducing frequency or claiming non-adherence.
