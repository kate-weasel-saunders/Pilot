# Pilot

A private, phone-first instrument for noticing your own patterns: mood, energy, anxiety, pressure, body, context, needs and thoughts. Capture is fast; interpretation comes later.

Pilot is a single-user Progressive Web App: React + TypeScript (Vite), Supabase (Auth + Postgres with Row Level Security) and IndexedDB on the device so check-ins never depend on a connection. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and reasoning.

## What works now

- Sign in (email + password)
- Check in: four 1–5 scales, body/context/need chips with your own custom chips, "What's going through your head?", "What happened just before this?", adjustable time
- Saved on the phone first, synced in the background; works offline. An unfinished check-in survives the app being closed
- Today: check-in button, today's entries, active periods ("Holiday · day 3 of 14")
- History: grouped by day, tap to expand, edit, delete (with confirmation), search, date/tag/period filters
- Periods: create, edit and delete (overlapping allowed, ongoing allowed)
- Calendars: import Google (and, if your workplace allows publishing, Outlook/Microsoft 365) calendars via their secret ICS links. Events around each check-in are pre-ticked (starting within 12 hours, happening now, or ended within 3 hours; all-day events on the day). You can untick or add others, and give events a kind (Work, Meeting, Social, Family, Appointment, Travel, Exercise, Personal, or your own); a kind applies to every repeat of that event
- Export: full JSON backup, check-ins CSV (with weekday, part of day, calendar events and periods), periods CSV
- Installable to the iPhone Home Screen; light and dark mode

Not built yet: trends, AI analysis, Ask My Data, experiments, delete-all-data.

## Setup

### 1. Supabase (free tier is fine)

1. Create a project at supabase.com. Pick a region near you.
2. **Authentication → Sign In / Providers**: in the **User Signups** section at the top of the page (not inside the Email provider), turn off **Allow new users to sign up** and save. Some dashboard versions put this under Authentication → Settings. It's recommended but not essential: Row Level Security keeps each account's data separate either way.
3. **Authentication → Users → Add user**: create yourself with an email and a strong password. Tick "Auto confirm".
4. Apply the schema, using either option:
   - **SQL Editor**: open `supabase/migrations/20261118000000_initial_schema.sql` (on GitHub, use "Copy raw file"), paste its **contents** into a new query and click Run. If Supabase warns about destructive operations, confirm: that's the line removing anonymous access. Afterwards Table Editor should show `check_ins`, `periods`, `tags` and `analyses`. Or:
   - **CLI**: `npx supabase login && npx supabase init && npx supabase link --project-ref <ref> && npx supabase db push`
5. **Project Settings → API Keys**: copy the project URL and the **publishable** key (`sb_publishable_…`). Never use the secret/service_role key in this app.

### 1b. Calendar import (optional, needed for calendars)

1. **Apply the second migration**: in the SQL Editor, paste the contents of `supabase/migrations/20261119000000_calendars.sql` and run it. Run migrations in date order; the first must already have been run.
2. **Deploy the `calendar` function**, either option:
   - **Automatic (no terminal):** in GitHub → this repo → Settings → Secrets and variables → Actions:
     - add the **secret** `SUPABASE_ACCESS_TOKEN` (create one at supabase.com → your avatar → Account preferences → Access Tokens, with only the **edge_functions_write** permission; you can delete it after a successful deploy and make a new one next time the function changes)
     - add the **variable** `SUPABASE_PROJECT_REF` (the part before `.supabase.co` in your project URL)

     Then open the **Actions** tab → *Deploy Supabase functions* → **Run workflow**. It also redeploys automatically whenever the function changes.
   - **Terminal:** `npx supabase@3.2.0 login`, then `npx supabase@3.2.0 functions deploy calendar --remote=<project-ref> --use-api`
3. In Pilot: **Settings → Manage calendars**, then paste each calendar's secret link. The screen explains where to find it in Google and Outlook.

The function uses settings Supabase provides automatically, so there are no keys to paste. Your Anthropic key isn't involved.

### 2. Run locally

```bash
cp .env.example .env.local   # fill in URL + publishable key
npm install
npm run dev                  # http://localhost:5173
```

### 3. Deploy (Vercel; any static host works)

Import the repo in Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as environment variables, and deploy. `vercel.json` adds a strict Content-Security-Policy and other security headers. If you use another host, port those headers.

### 4. Install on iPhone

Open the deployed URL in **Safari** → Share → **Add to Home Screen**. Sign in once inside the installed app. iOS keeps Home Screen apps' storage separate from Safari's, so signing in within Safari doesn't carry over.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build (with service worker) |
| `npm test` | Unit tests (time, periods, vocabulary, filters, export, sync engine, calendar parsing/rules, calendar function) |
| `npm run test:db` | Applies migrations to a throwaway local PostgreSQL and runs the RLS/constraint tests (needs PostgreSQL 15+ installed locally; doesn't touch Supabase) |
| `npm run test:e2e` | Builds and drives the whole app on an emulated iPhone against a fake Supabase (needs Playwright + Chromium). `SCREENSHOTS=1` saves screenshots to `e2e/screenshots/` |
| `npm run lint` / `npm run typecheck` | Lint / types |

## Privacy and security summary

- RLS on every table: a signed-in user can only read and write rows where `user_id = auth.uid()`. The anonymous role has no table access. Tested in `supabase/tests/rls.test.sql`.
- The browser only has the publishable key, which is public by design. There's no secret in the bundle.
- Calendar links are credentials. They're sent once to the `calendar` function and stored in a table the browser can neither read nor write. The function only fetches from Google/Outlook calendar hosts, with size and time limits, and imports only titles and times (no attendees, descriptions or locations).
- No analytics, trackers, third-party fonts or ads. The service worker caches only the app's own files, never your data.
- Data on the device lives in IndexedDB and is wiped on sign-out.
- AI (a later phase) will run through a Supabase Edge Function holding the Anthropic key as a server-side secret. It runs only when you ask for an analysis.
