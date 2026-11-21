-- Pilot — Apple Health import (via an iOS Shortcut)
--
-- A Shortcut on the phone reads Health and POSTs to the `health` Edge Function,
-- authenticated by a per-user ingest key (not the account password). The
-- function writes with the service role, always scoped to the key's owner.
--
-- * health_ingest_keys: only a SHA-256 hash of each key is stored. Owners can
--   list and revoke (delete) their keys; only the function can create them.
-- * health_samples: workouts, mindful sessions, nightly sleep summaries, HRV
--   and resting heart rate. Owners can read and delete; only the function writes.
--
-- Privileges are granted explicitly: this project has no default privileges.

create table public.health_ingest_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  key_hash      text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label         text not null default 'Shortcut' check (char_length(label) between 1 and 60),
  last_used_at  timestamptz,
  last_summary  text check (char_length(last_summary) <= 500),
  created_at    timestamptz not null default now()
);

create index health_ingest_keys_user_idx on public.health_ingest_keys (user_id);

alter table public.health_ingest_keys enable row level security;
alter table public.health_ingest_keys force row level security;
create policy "health_ingest_keys: select own" on public.health_ingest_keys
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "health_ingest_keys: delete own" on public.health_ingest_keys
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.health_ingest_keys from anon, authenticated;
grant select, delete on public.health_ingest_keys to authenticated;
grant select, insert, update, delete on public.health_ingest_keys to service_role;

-- ---------------------------------------------------------------------------

create table public.health_samples (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  metric      text not null check (metric in ('workout', 'mindful', 'sleep', 'hrv', 'resting_hr')),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  value       numeric,          -- hrv: ms (SDNN); resting_hr: bpm; sleep: minutes asleep; workout/mindful: minutes
  unit        text check (char_length(unit) <= 20),
  label       text check (char_length(label) <= 100),  -- workout type, e.g. "Running"
  detail      jsonb not null default '{}'::jsonb,       -- sleep: minutes per stage
  sample_key  text not null check (char_length(sample_key) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint health_samples_key_unique unique (user_id, sample_key),
  constraint health_samples_order check (ends_at >= starts_at)
);

create index health_samples_user_start_idx on public.health_samples (user_id, starts_at);
create index health_samples_user_updated_idx on public.health_samples (user_id, updated_at);

create trigger health_samples_set_updated_at
  before insert or update on public.health_samples
  for each row execute function public.set_updated_at();

alter table public.health_samples enable row level security;
alter table public.health_samples force row level security;
create policy "health_samples: select own" on public.health_samples
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "health_samples: delete own" on public.health_samples
  for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.health_samples from anon, authenticated;
grant select, delete on public.health_samples to authenticated;
grant select, insert, update, delete on public.health_samples to service_role;
