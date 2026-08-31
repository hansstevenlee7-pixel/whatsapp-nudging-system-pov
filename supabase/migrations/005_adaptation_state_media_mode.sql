-- The delivery-selection decision records whether the clinician chose text,
-- automatic media, or an approved media override. Keep that mode in the
-- behaviour-level state so selection decisions can be replayed and audited.
alter table public.user_adaptation_state
  add column if not exists media_selection_mode text;
