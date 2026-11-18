#!/usr/bin/env bash
# Runs the migrations + RLS tests against a throwaway local PostgreSQL cluster.
# Requires PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on this machine.
# This does NOT touch your Supabase project.
set -euo pipefail
cd "$(dirname "$0")/../.."
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PG_BIN:$PATH"
WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); chown postgres "$WORK"; fi
cleanup() { "${RUN_AS[@]}" pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${RUN_AS[@]}" psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)
"${PSQL[@]}" -f supabase/tests/auth_stub.sql
for f in supabase/migrations/*.sql; do echo "migrate: $f"; "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f supabase/tests/rls.test.sql
echo "All database tests passed."
