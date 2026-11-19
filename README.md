# Signal

A private, phone-first instrument for noticing your own patterns: mood, energy, anxiety, pressure, body, context, needs and thoughts. Capture is fast; interpretation comes later.

Signal is a single-user Progressive Web App: React + TypeScript (Vite), Supabase (Auth + Postgres with Row Level Security) and IndexedDB on the device so check-ins never depend on a connection. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and reasoning.

## What works now

- Sign in (email + password)
- Check in: four 1–5 scales, body/context/need chips with your own custom chips, "What's going through your head?", "What happened just before this?", adjustable time
- Saved on the phone first, synced in the background; works offline. An unfinished check-in survives the app being closed
- Today: check-in button, today's entries, active periods ("Holiday · day 3 of 14")
- History: grouped by day, tap to expand, edit, delete (with confirmation), search, date/tag/period filters
- Periods: create, edit and delete (overlapping allowed, ongoing allowed)
- Export: full JSON backup, check-ins CSV (with weekday, part of day and periods), periods CSV
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
| `npm test` | Unit tests (time, periods, vocabulary, filters, export, sync engine) |
| `npm run test:db` | Applies migrations to a throwaway local PostgreSQL and runs the RLS/constraint tests (needs PostgreSQL 15+ installed locally; doesn't touch Supabase) |
| `npm run test:e2e` | Builds and drives the whole app on an emulated iPhone against a fake Supabase (needs Playwright + Chromium). `SCREENSHOTS=1` saves screenshots to `e2e/screenshots/` |
| `npm run lint` / `npm run typecheck` | Lint / types |

## Privacy and security summary

- RLS on every table: a signed-in user can only read and write rows where `user_id = auth.uid()`. The anonymous role has no table access. Tested in `supabase/tests/rls.test.sql`.
- The browser only has the publishable key, which is public by design. There's no secret in the bundle.
- No analytics, trackers, third-party fonts or ads. The service worker caches only the app's own files, never your data.
- Data on the device lives in IndexedDB and is wiped on sign-out.
- AI (a later phase) will run through a Supabase Edge Function holding the Anthropic key as a server-side secret. It runs only when you ask for an analysis.
