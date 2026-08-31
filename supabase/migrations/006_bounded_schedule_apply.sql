-- Per-behaviour activation gate for verified future-schedule adaptation.
-- The application also requires ADAPTIVE_SCHEDULE_APPLY_ENABLED=true, so a
-- database row can be disabled independently of the deployed code.

alter table public.adaptation_envelopes
  add column if not exists automatic_schedule_apply boolean not null default false;

create index if not exists adaptation_envelopes_automatic_apply
  on public.adaptation_envelopes (user_id, behaviour_key)
  where status = 'approved' and automatic_schedule_apply = true;
