create table if not exists public.media_search_jobs (
  job_id uuid primary key default gen_random_uuid(),
  behaviour_key text not null,
  user_id text not null,
  prescription_id text not null,
  action_text text not null,
  pillar text not null,
  category text not null,
  status text not null default 'pending' check (status in ('pending','processing','complete','failed')),
  attempts integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists media_search_jobs_active_key
  on public.media_search_jobs (user_id, behaviour_key)
  where status in ('pending','processing');

create table if not exists public.media_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  behaviour_key text not null,
  media_kind text not null check (media_kind in ('video','paper','reading')),
  title text not null,
  source_name text not null,
  source_url text not null,
  source_id text,
  published_at timestamptz,
  open_access boolean not null default false,
  short_summary text,
  detailed_summary text,
  limitations text,
  ranking_score numeric not null default 0,
  ranking_reasons jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  unique (behaviour_key, source_url)
);

create table if not exists public.media_assets (
  asset_id uuid primary key default gen_random_uuid(),
  candidate_id uuid references public.media_candidates(candidate_id) on delete set null,
  behaviour_key text not null,
  media_kind text not null check (media_kind in ('video','paper','reading')),
  title text not null,
  source_name text not null,
  source_url text not null,
  short_summary text,
  detailed_summary text,
  limitations text,
  status text not null default 'proposed' check (status in ('proposed','approved','retired')),
  approved_at timestamptz,
  approved_by uuid references public.profiles(auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  unique (behaviour_key, source_url)
);

create table if not exists public.adaptation_envelopes (
  envelope_id uuid primary key default gen_random_uuid(),
  user_id text not null,
  behaviour_key text not null,
  action_text text not null,
  pillar text not null,
  category text not null,
  formats jsonb not null default '["video","paper","reading"]'::jsonb,
  summary_lengths jsonb not null default '["short","detailed"]'::jsonb,
  tones jsonb not null default '["encouraging","neutral_informational"]'::jsonb,
  earliest_time time not null,
  latest_time time not null,
  frequency_min integer not null check (frequency_min between 1 and 7),
  frequency_max integer not null check (frequency_max between 1 and 7 and frequency_max >= frequency_min),
  action_alternatives jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','invalidated')),
  approved_asset_ids jsonb not null default '[]'::jsonb,
  approved_at timestamptz,
  approved_by uuid references public.profiles(auth_user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, behaviour_key)
);

create table if not exists public.user_adaptation_state (
  user_id text not null,
  behaviour_key text not null,
  preferred_format text,
  preferred_summary_length text,
  preferred_tone text,
  preferred_time time,
  preferred_frequency integer,
  preferred_action text,
  format_scores jsonb not null default '{}'::jsonb,
  last_asset_id uuid references public.media_assets(asset_id) on delete set null,
  asset_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, behaviour_key)
);

create table if not exists public.interaction_events (
  interaction_id text primary key,
  event_at timestamptz not null default now(),
  event_type text not null check (event_type in ('inbound_reply','link_visit','delivery_status')),
  user_id text not null,
  behaviour_key text,
  nudge_id text,
  wa_message_id text,
  inbound_message_sid text,
  reply_to_wa_message_id text,
  body text,
  media_count integer not null default 0,
  asset_id uuid references public.media_assets(asset_id) on delete set null,
  status text,
  correlation_method text,
  processed_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb
);

create table if not exists public.adaptation_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  decided_at timestamptz not null default now(),
  user_id text not null,
  behaviour_key text,
  interaction_id text references public.interaction_events(interaction_id) on delete set null,
  signal_type text not null,
  interpretation jsonb not null default '{}'::jsonb,
  scores_before jsonb not null default '{}'::jsonb,
  scores_after jsonb not null default '{}'::jsonb,
  rule_applied text not null,
  previous_state jsonb not null default '{}'::jsonb,
  next_state jsonb not null default '{}'::jsonb,
  selected_asset_id uuid references public.media_assets(asset_id) on delete set null,
  outcome text not null check (outcome in ('applied','outside_envelope','no_change','failed')),
  reason text not null,
  fulfilled_at timestamptz
);

create table if not exists public.tracked_links (
  token text primary key,
  asset_id uuid not null references public.media_assets(asset_id) on delete cascade,
  user_id text not null,
  behaviour_key text not null,
  nudge_id text,
  target_url text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  visit_count integer not null default 0,
  first_visited_at timestamptz,
  last_visited_at timestamptz
);

create index if not exists media_candidates_behaviour_score on public.media_candidates (behaviour_key, ranking_score desc);
create index if not exists interaction_events_user_time on public.interaction_events (user_id, event_at desc);
create index if not exists adaptation_decisions_user_time on public.adaptation_decisions (user_id, decided_at desc);

alter table public.media_search_jobs enable row level security;
alter table public.media_candidates enable row level security;
alter table public.media_assets enable row level security;
alter table public.adaptation_envelopes enable row level security;
alter table public.user_adaptation_state enable row level security;
alter table public.interaction_events enable row level security;
alter table public.adaptation_decisions enable row level security;
alter table public.tracked_links enable row level security;

-- Operational tables are server-only. The service-role key bypasses RLS; no
-- browser policy is intentionally created.
