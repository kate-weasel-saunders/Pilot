-- Pilot — keep raw Apple "Exercise Minutes" readings for exact daily totals.
--
-- Active periods (metric 'workout', label 'Exercise') only include stretches of
-- 10+ minutes, for Check In. The day's total should match the Apple Watch
-- Exercise ring, which counts every minute, so the raw readings are stored too.
alter table public.health_samples drop constraint health_samples_metric_check;
alter table public.health_samples add constraint health_samples_metric_check
  check (metric in ('workout', 'mindful', 'sleep', 'hrv', 'resting_hr', 'active_minutes'));
