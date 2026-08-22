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

## Media and time fields

Each dated occurrence preserves `media_selection_mode` (`automatic`, `text_only`, or `clinician_selected`), the actual `media_asset_id` and `media_kind`, and the original source URL. It also retains scheduled, sent, delivered, read, visited, and replied timestamps plus send-to-read/visit/reply latencies.

All stored event timestamps are UTC. The monitor renders them in `Australia/Melbourne`.

## Adaptation scopes

`user_adaptation_state` is behaviour-specific. `patient_adaptation_state` is a patient-wide fallback. A behaviour-specific value wins; the global value is not copied into or broadcast across other behaviours.

Every decision records its scope, source, effective time, state version, changed fields, previous state, new state, rule, outcome, and reason. Decisions and timeline exports are append-only. Current state is updated separately for fast reads.

## Synthetic acceptance trace

The minimal fixture should demonstrate: baseline three planned messages with automatic media; a typed video preference; a valid frequency change within the envelope; a clinician media override; a natural link visit; a reply; and a silent week that rotates media without reducing frequency or claiming non-adherence.
