#!/usr/bin/env bash
# Run scripts/check-*.sql against the local-pg server (scripts/local-pg/start.sh), one psql
# process per file, the way `node scripts/run-checks.mjs --sql` does through `docker exec`.
#
#   scripts/local-pg/run-sql-checks.sh                 # every check, in filename order
#   scripts/local-pg/run-sql-checks.sh booking         # files whose name contains "booking"
#   scripts/local-pg/run-sql-checks.sh 'check-zoe-*'   # or a glob over the file names
#
# Env: NOREON_PG_DIR, NOREON_PG_PORT (as start.sh), NOREON_CHECK_TIMEOUT (seconds, default 600),
#      NOREON_CHECK_LOG_DIR (default $NOREON_PG_DIR/check-logs), VERBOSE=1 to stream output.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
DIR="${NOREON_PG_DIR:-/tmp/noreon-pg}"
PORT="${NOREON_PG_PORT:-54329}"
TIMEOUT="${NOREON_CHECK_TIMEOUT:-600}"
LOGS="${NOREON_CHECK_LOG_DIR:-$DIR/check-logs}"
pattern="${1:-}"

if ! "$PG_BIN/pg_isready" -q -h "$DIR/run" -p "$PORT"; then
  echo "Local server is not running on $DIR/run:$PORT; run scripts/local-pg/start.sh first." >&2
  exit 2
fi

files=()
for f in "$REPO"/scripts/check-*.sql; do
  name="$(basename "$f")"
  if [ -n "$pattern" ]; then
    # shellcheck disable=SC2053
    if [[ "$pattern" == *[\*\?\[]* ]]; then [[ "$name" == $pattern ]] || continue
    else [[ "$name" == *"$pattern"* ]] || continue; fi
  fi
  files+=("$f")
done
if [ ${#files[@]} -eq 0 ]; then echo "No checks match '$pattern'." >&2; exit 2; fi

mkdir -p "$LOGS"
passed=0; failed=0; failures=()
start=$(date +%s)
for f in "${files[@]}"; do
  name="$(basename "$f")"
  log="$LOGS/${name%.sql}.log"
  t0=$(date +%s)
  if [ "${VERBOSE:-0}" = "1" ]; then
    timeout "$TIMEOUT" "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$DIR/run" -p "$PORT" -U postgres -d postgres <"$f" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
  else
    timeout "$TIMEOUT" "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$DIR/run" -p "$PORT" -U postgres -d postgres <"$f" >"$log" 2>&1
    status=$?
  fi
  secs=$(( $(date +%s) - t0 ))
  if [ "$status" -eq 0 ]; then
    passed=$((passed + 1)); printf 'PASS %-60s %4ss\n' "$name" "$secs"
  else
    failed=$((failed + 1)); failures+=("$name")
    [ "$status" -eq 124 ] && echo "TIMEOUT after ${TIMEOUT}s" >>"$log"
    printf 'FAIL %-60s %4ss  %s\n' "$name" "$secs" "$(grep -m1 -E 'ERROR|FATAL|TIMEOUT' "$log" | cut -c1-160)"
  fi
done

echo
echo "${#files[@]} SQL checks; $passed passed, $failed failed ($(( $(date +%s) - start ))s). Logs: $LOGS"
if [ "$failed" -gt 0 ]; then
  echo "Failed:"; printf '  %s\n' "${failures[@]}"
  exit 1
fi
