# Dynamic action taxonomy migration

> **Superseded in part by [`BEHAVIOUR_TAXONOMY_MIGRATION.md`](BEHAVIOUR_TAXONOMY_MIGRATION.md).**
> That change moved `pillar` and `category` down to the behaviour as well, so the
> claims below about pillar/category being *prescription-level and locked* — the
> locked chips in the review page, and the server rejecting a slot whose pillar
> disagrees with its prescription — are **no longer true**. Everything about
> retiring `target_behavior` and `action_text` living on the weekly slot still
> holds, and is the precedent the later change followed.

The fixed `target_behavior` catalogue is retired. The concrete execution step is
now `action_text`, free text owned by the clinician and held **per recurring weekly
slot**, so one prescription can carry different actions on different weekdays.

Research trace after this change (later extended — see the superseding doc):

```text
raw prescription → locked pillar/category → clinician-approved action → message → feedback
```

## Why the split

`target_behavior` conflated two things: the taxonomy the study analyses across
patients, and the instruction a specific patient receives. Locking the first and
freeing the second keeps the enumerated analysis intact while letting a clinician
prescribe something the catalogue never anticipated. The LLM drafts each action at
intake; weekly adaptation may never change it.

## Required Sheet changes

Add one column to each of two tabs. Append it at the end of the header row — column
order is read by name, not position.

| Tab | New header | Backfill |
|---|---|---|
| `nudges` | `action_text` | Blank is tolerated on read; filled on the next clinician save |
| `weekly_schedule` | `action_text` | Seeded by the migration script below |

`prescriptions.target_behavior` stays in place. Nothing writes it any more —
Workflow A now writes it blank — and it is read only to convert legacy rows.

The Monitoring API also reads the `questionnaire` tab now, for
`preferred_nudge_time`. It must exist with at least `questionnaire_id` and
`user_id` headers; the retired per-behaviour `default_time` table no longer
supplies slot timing.

`landing/api/_lib/clinical-data.js` fails loudly (`missing required columns`)
rather than silently dropping the value, so add both columns before deploying.

## Backfilling the action

Retired tokens map to text through `x_legacy_action_labels` in
`lifestyle_nudging_schema.json` (for example `sleep_onset_consistency` → "Go to bed at
a consistent time"). Unrecognised tokens de-tokenize rather than showing a raw enum.

### Case A — the Sheet already has `weekly_schedule` rows (production today)

**Do not run the seed script.** It mints slot IDs from scratch and would duplicate any
slot the portal created after the original weekly-schedule migration.

Add the `action_text` column and leave it blank. The Monitoring read path converts
`prescriptions.target_behavior` to readable text on every load, so clinicians see and
edit a real action immediately; the value is written to the Sheet the next time they
save that patient's schedule. No bulk write is needed, and none is safe.

A prescription with a blank `target_behavior` yields a blank action. That slot shows an
empty, required Action field and the save button stays disabled until the clinician
types one — intended, not a failure.

### Case B — patients never migrated to `weekly_schedule`

Only for a Sheet that predates the weekly-schedule migration entirely:

1. Export the current `nudges` and `prescriptions` tabs as JSON; keep Sheet version
   history intact.
2. Dry-run:
   `node scripts/seed-weekly-schedule.js nudges.json --prescriptions=prescriptions.json`
3. Check `missing_action_rows` in the summary — those slots need a clinician-typed
   action at next review.
4. Write the import file plus an automatic backup:
   `node scripts/seed-weekly-schedule.js nudges.json weekly_schedule.seed.json --prescriptions=prescriptions.json --write`
5. Import into `weekly_schedule` and confirm each approved patient shows the intended
   weekdays and a readable action.

## Behaviour after migration

- **Review page** shows pillar and category chips plus a required Action on every
  weekly slot. (Superseded: those chips were inherited from the prescription and
  read-only; the behaviour taxonomy made them the slot's own, edited per behaviour
  in the trace card, and turned the slot's Action into a picker.)
- **Add custom nudge** requires the clinician to select which prescription the nudge
  belongs to. It no longer guesses the closest match, and the server rejects a slot
  whose source row hangs off a different prescription. (Superseded: it no longer
  rejects a slot whose pillar disagrees with its prescription — that is now a
  legitimate multi-pillar plan.)
- **Materialization** copies the slot action to every dated delivery it generates.
  Already-sent rows are never rewritten, so audit history keeps the action that was
  actually delivered.
- **Workflow D** receives `action_text` as read-only context and its validation gate
  restores the stored value before anything is written; the Sheets update node does
  not map the column at all.
