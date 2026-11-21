# Architecture and decisions

## Shape

```
iPhone / browser (PWA)
  React UI ── reads only from ──▶ IndexedDB (Dexie): check_ins, periods, tags, outbox, meta
     │ writes: row + outbox entry, one transaction
     ▼
  sync engine (src/data/sync.ts) ── supabase-js (publishable key + user JWT) ──▶ Supabase Postgres (RLS)
                                                                                 ▲
  Settings → Calendars ─▶ Edge Function `calendar` ─▶ Google / Outlook ICS feeds
                           (user JWT; service role only for calendar_feed_secrets)
  (later) "Analyse" ─▶ Supabase Edge Function (user JWT, RLS applies) ─▶ Anthropic API
```

## Decisions

**Vite + React SPA, no SSR framework.** A private app behind a login gains nothing from server rendering. Static files deploy anywhere and cache cleanly in a service worker.

**Supabase.** Managed Postgres, Auth and an Edge Function runtime for the AI key, with no server to maintain. Plain SQL migrations keep the data portable.

**Email + password, not magic links.** On iOS a Home Screen app has its own storage, separate from Safari's. A magic link opened from Mail signs *Safari* in, not the installed app. Passwords work with iCloud Keychain autofill. Sign-ups are disabled in the Supabase dashboard.

**On-device first, with a simple outbox (not a full CRDT/local-first system).**
- Every save writes the row and an outbox entry to IndexedDB in one transaction, so a dropped connection can't lose it.
- IDs are UUIDs generated on the device, so pushing is an idempotent upsert.
- The pull step fetches rows changed since a cursor (server `updated_at`, with a 5-minute overlap). It never overwrites rows with pending local changes, and it compares ID lists to notice deletions made on another device.
- Conflict policy: the last write to reach the server wins. That's acceptable for one person on a phone and a laptop.
- Every request has a 20-second timeout, because weak mobile connections can hang rather than fail.

**UI reads only from IndexedDB.** It's instant, it works offline, and there's one code path. Data volume for one person is small: years of check-ins are a few MB.

**Tags as `text[]` of labels plus a `tags` vocabulary table.** No join table. Exports stay human-readable and Postgres arrays are queryable (`@>`, GIN). Default chips live in code (`src/lib/vocabulary.ts`). The table holds custom chips, plus `hidden` rows that hide defaults. Renaming a tag doesn't rewrite history.

**Time.** A check-in stores `observed_at` (instant), `timezone` (IANA), and `local_date`/`local_time` (wall clock there). Weekday and part of day are derived (`src/lib/time.ts`). Storing the wall clock means travel doesn't change what "morning" meant.

**Periods use floating local dates/times** and are compared with each check-in's local wall clock, so "Holiday from 30 Nov" means 30 Nov wherever you are. Ends are inclusive; a missing end means ongoing. Membership is computed, never stored, so editing a period re-classifies everything automatically.

**Nullable scores.** The four measures are presented first and are quick, but none is enforced: a thought on its own is still worth keeping. Analysis treats missing values as missing.

**`extra jsonb`** on check-ins and periods leaves room to record new things without a migration while the vocabulary is still evolving. Promote fields to real columns once they settle.

**Service worker caches only the app shell.** Supabase responses are never cached by it. Personal data lives in IndexedDB (cleared on sign-out) and Postgres.

**Calendars: secret ICS links, not OAuth.** No Google Cloud project, no consent screen, no weekly re-authorisation, and Outlook's published calendars work the same way.
- **Server-side import:** the `calendar` Edge Function fetches feeds server-side (browsers can't read them cross-origin anyway). Hosts are allowlisted (prevents SSRF), feeds are capped at 5 MB and 15 s, and recurring events are expanded with ical.js using the feed's own VTIMEZONEs, so Outlook's Windows zone names work.
- **Rolling window:** events are imported for a week back and two weeks ahead.
- **Duplicates:** merged across calendars by UID, falling back to title + time.
- **Safe deletion:** a failed fetch never deletes that calendar's events.
- **Snapshots:** each check-in stores a snapshot of its attached events (`check_ins.events`) with their relation in time (upcoming/now/recent/all-day/earlier/later and minutes). Analysis sees what you were facing then, even if the calendar changes later.
- **Default rule** (`src/lib/calendar.ts`): pre-tick timed events starting within 12 h, happening now, or ended within 3 h, plus all-day events covering the date. Same-day others are offered unticked. A per-series "don't tick automatically" exists, but nothing is ever unselectable.
- **Kinds** resolve per series (`event_series`), then the calendar's default kind. Custom kinds use the shared `tags` vocabulary (kind `event`).

**Apple Health: an iOS Shortcut pushes data to the `health` function.** PWAs can't access HealthKit; a native wrapper would need Xcode and a paid developer account.
- **Shortcut format:** the Shortcut sends simple `|`-separated lines (easier to build in Shortcuts than JSON), parsed tolerantly but with strict ISO dates.
- **Authentication:** a per-user ingest key; only its SHA-256 is stored.
- **Deploy:** the function is deployed with `--no-verify-jwt` and authenticates every request itself (ingest key, or the user's JWT for key creation).
- **Sleep:** stages are condensed into sessions server-side (union of intervals, so overlapping devices count once).
- **In the app:** workouts, mindful sessions and sleep are mapped to calendar-like items (virtual source `apple-health`), so they reuse the Check In picker and snapshots. Last night's sleep stays pre-ticked for 18 h after waking. HRV and resting HR are daily context for analysis.

## Security model

- RLS enabled **and forced** on every table. The policies are select/insert/update/delete `to authenticated` where `(select auth.uid()) = user_id`. The `anon` role is revoked. Test 10 in `supabase/tests/rls.test.sql` fails if any future table in `public` lacks RLS.
- `updated_at` is set by a trigger from the server clock, since the sync cursor depends on it.
- Only the publishable key ships to the browser. Edge Functions act as the caller (their JWT), so RLS applies.
- **Service-role uses:**
  - inside the `calendar` function, solely for `calendar_feed_secrets`
  - inside the `health` function, for writing `health_samples` and managing `health_ingest_keys`, always scoped to the key owner / verified user

  Browser roles can only read and delete their own health rows (tested). That table has RLS forced and no policies or grants for browser roles (tested), and every query is filtered by the verified user id.
- AI will hold `ANTHROPIC_API_KEY` as a function secret.
- No analytics, no third-party requests besides Supabase, and a strict CSP (`vercel.json`). Errors shown in the UI never include entry text, and the sync engine doesn't log row contents.

## Planned next

1. **Trends** (Patterns tab): the four measures over 7/30/90 days or custom, as quiet small multiples. Tap a point to see the check-in.
2. **Analysis data layer**: a pure, tested transform from rows to a compact, explicit text representation (timestamp, weekday, part of day, periods, measures, tags, text, attached calendar events with timing and kind, previous-check-in gap). Include an option to send event kinds instead of titles.
3. **Analysis system prompt** as its own versioned module: evidence first, observation vs. hypothesis vs. insufficient evidence, counts and exceptions, alternative explanations, deliberate counter-evidence, no diagnosis, no coaching.
4. **Edge Function `analyse`**: deliberate, user-triggered, `claude-opus-5-5`, results saved to `analyses`.
5. Ask My Data, period comparison, experiments, delete-all-data.
