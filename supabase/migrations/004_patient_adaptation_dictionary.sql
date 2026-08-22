-- Longitudinal patient dictionary. Historical decisions remain append-only;
-- current state is kept separately for fast monitor reads.

alter table public.user_adaptation_state
  add column if not exists state_version integer not null default 0,
  add column if not exists last_signal_at timestamptz,
  add column if not exists last_decision_id uuid;

create table if not exists public.patient_adaptation_state (
  user_id text primary key,
  preferred_format text,
  preferred_summary_length text,
  preferred_tone text,
  preferred_time time,
  preferred_frequency integer check (preferred_frequency between 1 and 7),
  preferred_action text,
  format_scores jsonb not null default '{}'::jsonb,
  asset_history jsonb not null default '[]'::jsonb,
  state_version integer not null default 0,
  last_signal_at timestamptz,
  last_decision_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.adaptation_decisions
  add column if not exists scope text not null default 'behaviour' check (scope in ('global','behaviour')),
  add column if not exists decision_source text not null default 'system' check (decision_source in ('patient','clinician','system')),
  add column if not exists effective_at timestamptz not null default now(),
  add column if not exists state_version integer,
  add column if not exists changed_fields jsonb not null default '[]'::jsonb,
  add column if not exists frequency_before integer,
  add column if not exists frequency_after integer,
  add column if not exists media_mode_before text,
  add column if not exists media_mode_after text,
  add column if not exists media_kind_before text,
  add column if not exists media_kind_after text,
  add column if not exists nudge_id text;

create index if not exists adaptation_decisions_scope_time
  on public.adaptation_decisions (user_id, scope, effective_at desc);
create index if not exists user_adaptation_state_updated
  on public.user_adaptation_state (user_id, updated_at desc);

alter table public.patient_adaptation_state enable row level security;

-- These exports are maintained by the migration helper and the dictionary
-- endpoint when the corresponding research tabs have been provisioned.
