# Weekly schedule migration

The Monitoring API requires a Google Sheets tab named `weekly_schedule`. This tab is the recurring-plan source of truth; `nudges`, `schedule_state`, and `delivery_events` retain outbound delivery history. The portal uses direct server-side Sheets access.

Create the tab with this header row, in order:

```text
schedule_slot_id,user_id,source_nudge_id,prescription_id,day,scheduled_time,nudge_type,pillar,action_text,tone_variant,message_body,message_body_alt,template_name,status,start_date,end_date,created_at,updated_at
```

Also add `schedule_slot_id` and `action_text` to the `nudges` header. Existing source and historical rows may leave `schedule_slot_id` blank. `action_text` is covered by `ACTION_TAXONOMY_MIGRATION.md` — read that first if this Sheet predates the dynamic action taxonomy.

## Existing-patient seed

1. Export the current `nudges` tab as JSON and keep the Sheet version history intact.
2. Run a dry-run: `node scripts/seed-weekly-schedule.js nudges.json`.
3. Check the reported patient and slot counts against the Monitoring page.
4. Generate the import file and an automatic local backup: `node scripts/seed-weekly-schedule.js nudges.json weekly_schedule.seed.json --write`.
5. Review the generated rows, import them into `weekly_schedule`, and confirm every approved patient has the intended active weekdays.

Deploy the direct-Sheets portal only after both headers exist and the service account can edit the spreadsheet. Test one non-participant record through approve, remove weekday, save, and reload before using it for research participants.
