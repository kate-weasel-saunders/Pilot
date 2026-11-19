-- Pilot — calendar import
--
-- * calendar_sources: one row per imported calendar (name, default kind).
-- * calendar_feed_secrets: the secret ICS address for each source. It is a
--   credential, so the browser can neither read nor write it: there are NO
--   policies for `authenticated`. Only the `calendar` Edge Function touches it,
--   using the service role, and always scoped to the caller's verified user id.
-- * calendar_events: occurrences imported by the Edge Function for a rolling
--   window, de-duplicated across calendars. Read-only in practice.
-- * event_series: your decisions about a (recurring) event: kind, renamed
--   title, "don't pre-select". Keyed by the calendar UID.
-- * check_ins.events: the events attached to a check-in, as they were at the
--   time (a snapshot), so later calendar edits never rewrite the past.

-- ---------------------------------------------------------------------------

create table public.calendar_sources (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 100),
  default_kind      text check (char_length(default_kind) <= 60),
  enabled           boolean not null default true,
  last_refreshed_at timestamptz,
  last_error        text check (char_length(last_error) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index calendar_sources_user_updated_idx on public.calendar_sources (user_id, updated_at);

create trigger calendar_sources_set_updated_at
  before insert or update on public.calendar_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table public.calendar_feed_secrets (
  source_id   uuid primary key references public.calendar_sources (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  feed_url    text not null check (char_length(feed_url) between 10 and 2048),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger calendar_feed_secrets_set_updated_at
  before insert or update on public.calendar_feed_secrets
  for each row execute function public.set_updated_at();

alter table public.calendar_feed_secrets enable row level security;
alter table public.calendar_feed_secrets force row level security;
-- Deliberately no policies, and no privileges for browser roles.
revoke all on public.calendar_feed_secrets from anon, authenticated;

-- ---------------------------------------------------------------------------

create table public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_key   text not null check (char_length(event_key) <= 1000),  -- series + occurrence
  series_key  text not null check (char_length(series_key) <= 1000), -- calendar UID
  source_ids  uuid[] not null default '{}',
  title       text check (char_length(title) <= 500),
  all_day     boolean not null default false,
  starts_at   timestamptz,   -- timed events
  ends_at     timestamptz,
  start_date  date,          -- all-day events (end_date is exclusive, as in iCalendar)
  end_date    date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint calendar_events_key_unique unique (user_id, event_key),
  constraint calendar_events_shape check (
    (all_day and start_date is not null and end_date is not null)
    or (not all_day and starts_at is not null and ends_at is not null)
  )
);

create index calendar_events_user_start_idx on public.calendar_events (user_id, starts_at);
create index calendar_events_user_updated_idx on public.calendar_events (user_id, updated_at);

create trigger calendar_events_set_updated_at
  before insert or update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------

create table public.event_series (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series_key      text not null check (char_length(series_key) <= 1000),
  kind            text check (char_length(kind) <= 60),
  title_override  text check (char_length(title_override) <= 200),
  hidden          boolean not null default false,  -- true = never pre-selected
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index event_series_user_updated_idx on public.event_series (user_id, updated_at);

create trigger event_series_set_updated_at
  before insert or update on public.event_series
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Same own-rows-only policies as the initial schema.

do $$
declare
  t text;
begin
  foreach t in array array['calendar_sources', 'calendar_events', 'event_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy "%1$s: select own" on public.%1$I
      for select to authenticated using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s: insert own" on public.%1$I
      for insert to authenticated with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s: update own" on public.%1$I
      for update to authenticated using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s: delete own" on public.%1$I
      for delete to authenticated using ((select auth.uid()) = user_id)$p$, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Check-ins carry a snapshot of the events attached to them.

alter table public.check_ins
  add column events jsonb not null default '[]'::jsonb
  constraint check_ins_events_is_array check (jsonb_typeof(events) = 'array');

-- Event kinds share the custom-vocabulary table with the other chip groups.
alter table public.tags drop constraint tags_kind_check;
alter table public.tags add constraint tags_kind_check check (kind in ('body', 'context', 'need', 'event'));
