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

-- 10. Every table in public has RLS enabled (guards future migrations).
do $$ begin
  assert not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ), 'a public table is missing RLS';
end $$;
\echo 'ok 10 - all public tables have RLS enabled'
