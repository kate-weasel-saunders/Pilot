# Signal — notes for Claude Code

Personal, single-user mood/energy observation PWA. Read `docs/ARCHITECTURE.md` first.

## Product principles (non-negotiable)
- Capture must be fast; everything after the four scales is optional.
- No streaks, targets, scores, guilt, red "missed" states or "you haven't checked in" language. Missing days is fine.
- AI analyses; it doesn't coach or diagnose. It's epistemically cautious and resists confirmation bias.
- Calm, warm, typographic UI. Tokens in `src/styles/tokens.css`. No UI kit.

## Code map
- `src/data/` — row types (mirror SQL), Dexie store, local writes + outbox (`repo.ts`), sync engine (`sync.ts`), controller, hooks
- `src/lib/` — pure logic: time, periods, vocabulary, filters, export (all unit-tested)
- `src/screens/`, `src/components/` — UI
- `supabase/migrations/` — schema; every new table needs RLS + the four own-row policies
- `supabase/tests/` — RLS tests against local Postgres (`npm run test:db`)
- `e2e/smoke.cjs` — full-loop test on emulated iPhone with fake Supabase

## Before finishing a change
`npm run typecheck && npm run lint && npm test && npm run test:db && npm run test:e2e`

## Rules
- Never put secrets in `VITE_*` variables. The Anthropic key lives only in Supabase function secrets.
- Never log journal text.
- Schema changes are new migration files, and row types in `src/data/types.ts` must match.
- Use `claude-opus-5-5` for AI; keep the system prompt in its own versioned module.
