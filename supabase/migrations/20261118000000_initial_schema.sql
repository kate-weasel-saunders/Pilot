-- Pilot — initial schema
--
-- Design notes (see docs/ARCHITECTURE.md for the longer version):
-- * Every personal table has user_id + Row Level Security. Policies only ever
--   allow a signed-in user to touch rows where user_id = auth.uid().
-- * IDs are generated on the device (UUID v4) so a check-in can be saved
--   offline and pushed later; re-sending the same row is an idempotent upsert.
-- * updated_at is always set by the server clock (trigger). The client's sync
--   cursor relies on it.
-- * Tags are stored as text[] of human-readable labels. Deliberately not a
--   join table: exports stay readable and Postgres arrays are queryable.
-- * `extra jsonb` on check_ins/periods leaves room to record new things
--   without a migration while the vocabulary is still being discovered.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- check_ins
-- ---------------------------------------------------------------------------

create table public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- When the observation is *about* (editable; defaults to when it was made).
  observed_at   timestamptz not null,
  -- IANA zone the observation was made in, plus the wall-clock date/time there.
  -- Stored (not only derived) so travel doesn't rewrite what "morning" meant.
  timezone      text not null check (char_length(timezone) between 1 and 64),
  local_date    date not null,
  local_time    time not null,

  -- 1–5 scales. Nullable: a quick thought without ratings is still worth keeping.
  mood          smallint check (mood between 1 and 5),      -- very low → very good
  energy        smallint check (energy between 1 and 5),    -- empty → energised
  anxiety       smallint check (anxiety between 1 and 5),   -- calm → very anxious/tense
  pressure      smallint check (pressure between 1 and 5),  -- none → overwhelmed

  body_tags     text[] not null default '{}' check (cardinality(body_tags) <= 50),
  context_tags  text[] not null default '{}' check (cardinality(context_tags) <= 50),
  need_tags     text[] not null default '{}' check (cardinality(need_tags) <= 50),

  thought       text check (char_length(thought) <= 20000),
  preceding     text check (char_length(preceding) <= 5000),

  extra         jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index check_ins_user_observed_idx on public.check_ins (user_id, observed_at desc);
create index check_ins_user_updated_idx on public.check_ins (user_id, updated_at);

create trigger check_ins_set_updated_at
  before insert or update on public.check_ins
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- periods
-- ---------------------------------------------------------------------------
-- Dates/times are *floating wall-clock* values compared against a check-in's
-- local_date/local_time, so "Holiday from 30 Nov" means 30 Nov wherever you are.

create table public.periods (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title         text not null check (char_length(title) between 1 and 200),
  description   text check (char_length(description) <= 5000),
  category      text check (char_length(category) <= 60),
  start_date    date not null,
  start_time    time,            -- null = start of day
  end_date      date,            -- null = ongoing
  end_time      time,            -- null = end of day
  extra         jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint periods_end_after_start check (end_date is null or end_date >= start_date)
);

create index periods_user_idx on public.periods (user_id, start_date);
create index periods_user_updated_idx on public.periods (user_id, updated_at);

create trigger periods_set_updated_at
  before insert or update on public.periods
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tags — the user's own vocabulary (default chips live in app code)
-- ---------------------------------------------------------------------------
-- A row either adds a custom chip, or (hidden = true) hides a default one.

create table public.tags (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('body', 'context', 'need')),
  label         text not null check (char_length(label) between 1 and 60),
  hidden        boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index tags_user_idx on public.tags (user_id, kind);
create index tags_user_updated_idx on public.tags (user_id, updated_at);

create trigger tags_set_updated_at
  before insert or update on public.tags
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- analyses — saved AI results (used from the AI phase onwards)
-- ---------------------------------------------------------------------------

create table public.analyses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('period', 'question', 'comparison')),
  title             text check (char_length(title) <= 200),
  range_start       date,
  range_end         date,
  period_ids        uuid[] not null default '{}',
  question          text check (char_length(question) <= 5000),
  model             text,
  prompt_version    text,
  observation_count integer,
  result            text,          -- markdown, as shown to the user
  result_json       jsonb,         -- structured form, if any
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index analyses_user_idx on public.analyses (user_id, created_at desc);

create trigger analyses_set_updated_at
  before insert or update on public.analyses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Same four policies on every table. `(select auth.uid())` is the
-- Supabase-recommended form (evaluated once per statement, not per row).

do $$
declare
  t text;
begin
  foreach t in array array['check_ins', 'periods', 'tags', 'analyses'] loop
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

    -- Defence in depth: the anonymous role gets no table privileges at all.
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;
