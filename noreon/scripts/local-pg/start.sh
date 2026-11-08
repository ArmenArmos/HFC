#!/usr/bin/env bash
# Local PostgreSQL 16 stand-in for `supabase start` (no Docker needed).
#
#   scripts/local-pg/start.sh           # create (first run) or start the server; replay migrations once
#   scripts/local-pg/start.sh --reset   # stop, wipe and rebuild from zero
#   scripts/local-pg/start.sh --stop    # stop the server
#
# Env: NOREON_PG_DIR (default /tmp/noreon-pg), NOREON_PG_PORT (default 54329),
#      PG_BIN (default /usr/lib/postgresql/16/bin), NOREON_PG_OS_USER (default postgres, else pgrunner).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="${NOREON_PG_DIR:-/tmp/noreon-pg}"
PORT="${NOREON_PG_PORT:-54329}"
DATA="$DIR/data"
SOCK="$DIR/run"
LOG="$DIR/server.log"
MIGRATIONS="$REPO/supabase/migrations"
STAMP="$DIR/migrations.applied"

mode="start"
case "${1:-}" in
  --reset) mode="reset" ;;
  --stop) mode="stop" ;;
  "") ;;
  -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
  *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

# The server refuses to run as root: use an unprivileged OS user.
if [ "$(id -u)" = "0" ]; then
  OS_USER="${NOREON_PG_OS_USER:-}"
  if [ -z "$OS_USER" ]; then
    if id postgres >/dev/null 2>&1; then OS_USER=postgres; else OS_USER=pgrunner; fi
  fi
  if ! id "$OS_USER" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$OS_USER"
  fi
  as_pg() { runuser -u "$OS_USER" -- "$@"; }
else
  OS_USER="$(id -un)"
  as_pg() { "$@"; }
fi

pg_ctl_() { as_pg "$PG_BIN/pg_ctl" -D "$DATA" "$@"; }
running() { [ -f "$DATA/postmaster.pid" ] && pg_ctl_ status >/dev/null 2>&1; }
PSQL=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$SOCK" -p "$PORT" -d postgres)

if [ "$mode" = "stop" ] || [ "$mode" = "reset" ]; then
  if running; then pg_ctl_ stop -m fast -w >/dev/null; echo "Stopped server in $DATA"; fi
  [ "$mode" = "stop" ] && exit 0
  rm -rf "$DIR"
fi

if [ ! -f "$DATA/PG_VERSION" ]; then
  mkdir -p "$DIR" "$SOCK"
  chown "$OS_USER" "$DIR" "$SOCK"
  chmod 755 "$DIR" "$SOCK"
  echo "Initialising cluster in $DATA (bootstrap superuser supabase_admin)"
  as_pg "$PG_BIN/initdb" -D "$DATA" -U supabase_admin -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
  cat >>"$DATA/postgresql.conf" <<EOF

# --- noreon local-pg ---
port = $PORT
listen_addresses = 'localhost'
unix_socket_directories = '$SOCK'
max_connections = 200
shared_buffers = 256MB
fsync = off
synchronous_commit = off
full_page_writes = off
max_locks_per_transaction = 256
timezone = 'UTC'
log_timezone = 'UTC'
log_min_messages = warning
wal_level = logical
max_wal_senders = 10
max_replication_slots = 10
EOF
  rm -f "$STAMP"
fi

if ! running; then
  pg_ctl_ start -w -t 60 -l "$LOG" >/dev/null || { echo "Server failed to start; see $LOG" >&2; tail -20 "$LOG" >&2; exit 1; }
fi

if [ ! -f "$STAMP" ]; then
  # Shim (once): if `postgres` role is missing the shim has not run yet.
  has_postgres=$("$PG_BIN/psql" -X -At -h "$SOCK" -p "$PORT" -U supabase_admin -d postgres \
    -c "select count(*) from pg_roles where rolname='postgres'")
  if [ "$has_postgres" = "0" ]; then
    echo "Applying Supabase compatibility shim"
    "${PSQL[@]}" -U supabase_admin -f "$HERE/shim.sql" >/dev/null
  else
    echo "Shim already applied but migrations are incomplete; run with --reset to rebuild." >&2
    exit 1
  fi

  start=$(date +%s)
  n=0
  shopt -s nullglob
  files=("$MIGRATIONS"/*.sql)
  total=${#files[@]}
  echo "Applying $total migrations as postgres"
  for f in "${files[@]}"; do
    n=$((n + 1))
    # Each migration runs in its own transaction, like `supabase db reset`.
    if ! out=$("${PSQL[@]}" -U postgres --single-transaction -f "$f" 2>&1 >/dev/null); then
      echo >&2
      echo "MIGRATION FAILED ($n/$total): $(basename "$f")" >&2
      echo "$out" | grep -v '^psql:.*NOTICE' | tail -20 >&2
      echo "Fix the shim (scripts/local-pg/shim.sql), then: $0 --reset" >&2
      exit 1
    fi
    if [ $((n % 50)) -eq 0 ]; then echo "  $n/$total"; fi
  done
  echo "$total $(date -u +%FT%TZ)" >"$STAMP"
  echo "Applied $total migrations in $(( $(date +%s) - start ))s"
fi

cat <<EOF

Local Noreon PostgreSQL 16 is running.
  data dir : $DATA  (log: $LOG)
  socket   : psql -h $SOCK -p $PORT -U postgres -d postgres
  tcp      : postgresql://postgres@127.0.0.1:$PORT/postgres
  superuser: supabase_admin (postgres is non-superuser, as on Supabase)
  checks   : scripts/local-pg/run-sql-checks.sh [pattern]
  stop     : scripts/local-pg/start.sh --stop
EOF
