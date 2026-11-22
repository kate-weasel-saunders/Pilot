-- RLS & constraint tests. Run as a superuser; each block switches role and
-- JWT claims the way PostgREST does. Any failed assertion raises and aborts.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 1. User A can insert and read their own check-in; user_id defaults to auth.uid().
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
insert into public.check_ins (id, observed_at, timezone, local_date, local_time, mood, thought)
values ('11111111-1111-4111-8111-111111111111', now(), 'Europe/London', current_date, '09:00', 3, 'A private thought');
insert into public.periods (id, title, start_date) values ('22222222-2222-4222-8222-222222222222', 'Holiday', current_date);
do $$ begin
  assert (select count(*) from public.check_ins) = 1, 'A should see own check-in';
  assert (select user_id from public.check_ins limit 1) = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user_id defaults to auth.uid()';
end $$;
commit;
\echo 'ok 1 - owner can insert and read'

-- 2. User B cannot see, update or delete A's rows.
begin;
select pg_temp.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') \gset
do $$
declare n int;
begin
  assert (select count(*) from public.check_ins) = 0, 'B must not see A''s check-ins';
  assert (select count(*) from public.periods) = 0, 'B must not see A''s periods';
  update public.check_ins set thought = 'hijacked' where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count; assert n = 0, 'B must not update A''s row';
  delete from public.check_ins where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count; assert n = 0, 'B must not delete A''s row';
  delete from public.periods;
  get diagnostics n = row_count; assert n = 0, 'B must not delete A''s periods';
end $$;
commit;
\echo 'ok 2 - other user cannot read, update or delete'

-- 3. User B cannot insert a row claiming to belong to A.
begin;
select pg_temp.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') \gset
do $$ begin
  begin
    insert into public.check_ins (user_id, observed_at, timezone, local_date, local_time)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), 'UTC', current_date, '10:00');
    raise exception 'B inserted a row for A';
  exception when insufficient_privilege then null; -- RLS violation, expected
  end;
end $$;
commit;
\echo 'ok 3 - cannot insert rows for another user'

-- 4. Upsert of A's existing id by B (the sync path) is refused.
begin;
select pg_temp.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') \gset
do $$ begin
  begin
    insert into public.check_ins (id, user_id, observed_at, timezone, local_date, local_time)
    values ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now(), 'UTC', current_date, '10:00')
    on conflict (id) do update set thought = 'hijacked';
    raise exception 'B upserted over A''s row';
  exception when insufficient_privilege or unique_violation then null;
  end;
end $$;
commit;
\echo 'ok 4 - upsert over another user''s id is refused'

-- 5. User A cannot reassign a row to B.
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  begin
    update public.check_ins set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    raise exception 'A moved a row to B';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
\echo 'ok 5 - cannot reassign ownership'

-- 6. Anonymous role has no access at all.
begin;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.check_ins;
    raise exception 'anon could read check_ins';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
\echo 'ok 6 - anon has no privileges'

-- 7. Unauthenticated "authenticated" role without a sub sees nothing.
begin;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.check_ins) = 0, 'no sub => no rows';
end $$;
commit;
\echo 'ok 7 - no JWT subject => no rows'

-- 8. Constraints: scores must be 1–5; period end >= start.
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  begin
    insert into public.check_ins (observed_at, timezone, local_date, local_time, mood) values (now(), 'UTC', current_date, '10:00', 6);
    raise exception 'mood=6 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.periods (title, start_date, end_date) values ('Bad', '2026-12-10', '2026-12-01');
    raise exception 'end before start accepted';
  exception when check_violation then null;
  end;
end $$;
commit;
\echo 'ok 8 - constraints enforced'

-- 9. updated_at comes from the server clock, even if the client sends one.
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
update public.check_ins set thought = 'edited', updated_at = '2000-01-01' where id = '11111111-1111-4111-8111-111111111111';
do $$ begin
  assert (select updated_at from public.check_ins where id = '11111111-1111-4111-8111-111111111111') > '2020-01-01', 'updated_at must be server-set';
end $$;
commit;
\echo 'ok 9 - updated_at is server-controlled'

-- 11. Calendar tables: own rows only.
insert into public.calendar_sources (id, user_id, name) values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Home');
insert into public.calendar_feed_secrets (source_id, user_id, feed_url) values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://calendar.google.com/calendar/ical/x/private-secret/basic.ics');
insert into public.calendar_events (user_id, event_key, series_key, title, starts_at, ends_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dentist|2026-11-20T10:00:00Z', 'dentist', 'Dentist', '2026-11-20T10:00:00Z', '2026-11-20T10:30:00Z');
insert into public.event_series (user_id, series_key, kind) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dentist', 'Appointment');
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  assert (select count(*) from public.calendar_sources) = 1, 'A sees own source';
  assert (select count(*) from public.calendar_events) = 1, 'A sees own events';
  assert (select count(*) from public.event_series) = 1, 'A sees own series';
end $$;
commit;
begin;
select pg_temp.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') \gset
do $$
declare n int;
begin
  assert (select count(*) from public.calendar_sources) = 0, 'B must not see A''s sources';
  assert (select count(*) from public.calendar_events) = 0, 'B must not see A''s events';
  assert (select count(*) from public.event_series) = 0, 'B must not see A''s series';
  delete from public.calendar_events;
  get diagnostics n = row_count; assert n = 0, 'B must not delete A''s events';
end $$;
commit;
\echo 'ok 11 - calendar tables are own-rows-only'

-- 12. Secret feed links are invisible and unwritable from the browser, even for their owner.
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  begin
    perform count(*) from public.calendar_feed_secrets;
    raise exception 'owner could read feed secrets';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.calendar_feed_secrets (source_id, user_id, feed_url) values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://evil.example.com/x.ics');
    raise exception 'owner could write feed secrets';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
\echo 'ok 12 - feed secrets are server-only'

-- 12b. The server role (used only by the calendar function) can manage feed secrets.
begin;
set local role service_role;
insert into public.calendar_feed_secrets (source_id, user_id, feed_url)
  values ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://calendar.google.com/calendar/ical/x/private-new/basic.ics')
  on conflict (source_id) do update set feed_url = excluded.feed_url;
do $$ begin
  assert (select feed_url from public.calendar_feed_secrets where source_id = '33333333-3333-4333-8333-333333333333') like '%private-new%', 'service_role can upsert and read secrets';
end $$;
commit;
\echo 'ok 12b - server role can store and read feed secrets'

-- 13. Check-in event snapshots must be arrays; deleting a source removes its secret.
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  begin
    update public.check_ins set events = '{"not":"array"}' where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'non-array events accepted';
  exception when check_violation then null;
  end;
  delete from public.calendar_sources where id = '33333333-3333-4333-8333-333333333333';
end $$;
commit;
do $$ begin
  assert (select count(*) from public.calendar_feed_secrets) = 0, 'secret should cascade-delete with its source';
end $$;
\echo 'ok 13 - snapshot shape enforced; secrets removed with their calendar'

-- 14. Health: the server role writes; owners can read and delete; nobody else sees anything.
begin;
set local role service_role;
insert into public.health_ingest_keys (id, user_id, key_hash) values
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a', 64));
insert into public.health_samples (user_id, metric, starts_at, ends_at, value, label, sample_key) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'workout', '2026-11-20T07:00:00Z', '2026-11-20T07:35:00Z', 35, 'Running', 'workout|run1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hrv', '2026-11-20T03:00:00Z', '2026-11-20T03:01:00Z', 48, null, 'hrv|1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active_minutes', '2026-11-20T07:00:00Z', '2026-11-20T07:10:00Z', 10, null, 'active_minutes|1');
commit;
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
do $$ begin
  assert (select count(*) from public.health_samples) = 3, 'owner reads own health samples';
  assert (select count(*) from public.health_ingest_keys) = 1, 'owner lists own keys';
  begin
    insert into public.health_samples (user_id, metric, starts_at, ends_at, sample_key)
      values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'workout', now(), now(), 'forged');
    raise exception 'owner could write health samples directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.health_ingest_keys (user_id, key_hash) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('b', 64));
    raise exception 'owner could mint keys directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.health_ingest_keys set key_hash = repeat('c', 64);
    raise exception 'owner could change a key hash';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
begin;
select pg_temp.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') \gset
do $$
declare n int;
begin
  assert (select count(*) from public.health_samples) = 0, 'B must not see A''s health data';
  assert (select count(*) from public.health_ingest_keys) = 0, 'B must not see A''s keys';
  delete from public.health_ingest_keys;
  get diagnostics n = row_count; assert n = 0, 'B must not revoke A''s keys';
end $$;
commit;
begin;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.health_samples;
    raise exception 'anon could read health samples';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;
begin;
select pg_temp.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') \gset
delete from public.health_ingest_keys where id = '44444444-4444-4444-8444-444444444444';
do $$ begin
  assert (select count(*) from public.health_ingest_keys) = 0, 'owner can revoke own key';
end $$;
commit;
\echo 'ok 14 - health data: server writes, owner reads/deletes, others nothing'

-- 10. Every table in public has RLS enabled (guards future migrations).
do $$ begin
  assert not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ), 'a public table is missing RLS';
end $$;
\echo 'ok 10 - all public tables have RLS enabled'
