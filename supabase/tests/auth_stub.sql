-- Minimal stand-in for the parts of Supabase's `auth` schema the migration
-- uses. ONLY for local testing against plain Postgres — never run on Supabase.
-- auth.uid() mirrors Supabase's implementation: it reads the JWT `sub` claim
-- that PostgREST places in request.jwt.claims.
create role anon nologin;
create role authenticated nologin;
create schema auth;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated;
-- Supabase grants table privileges to anon by default; emulate that so the
-- migration's explicit REVOKE is actually exercised.
alter default privileges in schema public grant all on tables to anon, authenticated;
