-- Pilot — let the calendar Edge Function (service role) use calendar_feed_secrets.
--
-- The calendars migration revoked browser access to this table and relied on
-- Supabase's default privileges for service_role. Projects without those
-- defaults refused the function too (42501). Grant it explicitly, on this one
-- table only. Browser roles (anon, authenticated) still have no access.
grant select, insert, update, delete on public.calendar_feed_secrets to service_role;
