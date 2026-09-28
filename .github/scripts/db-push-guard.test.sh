#!/usr/bin/env bash
# Tests for db-push-guard.sh.
#
# The real Supabase CLI is never called: a stub placed first on PATH replays
# canned outputs and exit codes for `db push --dry-run` and `migration list`,
# and refuses any other command (so a real push can never happen from here).
#
# Run: bash .github/scripts/db-push-guard.test.sh
# Exits non-zero if any check fails.
set -uo pipefail

guard_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db-push-guard.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir "$work/bin"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >> "$STUB_CALLS"' \
  'case " $* " in' \
  '  " db push --dry-run "*)' \
  '    printf "%s\n" "${STUB_PUSH_OUTPUT-}" >&2' \
  '    exit "${STUB_PUSH_STATUS:-0}" ;;' \
  '  " migration list "*)' \
  '    printf "%s\n" "${STUB_LIST_OUTPUT-}"' \
  '    exit "${STUB_LIST_STATUS:-0}" ;;' \
  '  *)' \
  '    echo "supabase stub: refusing unexpected command: $*" >&2' \
  '    exit 97 ;;' \
  'esac' > "$work/bin/supabase"
chmod +x "$work/bin/supabase"

lines() { printf '%s\n' "$@"; }

checks=0
failures=0
case_no=0
current=""
status=""
out=""
gh_out=""
gh_summary=""
calls=""

show_debug() {
  local name line
  for name in out gh_out gh_summary calls; do
    printf '#   --- %s\n' "$name"
    while IFS= read -r line; do
      printf '#   %s\n' "$line"
    done <<< "${!name}"
  done
}

report() { # report RESULT DESCRIPTION
  checks=$((checks + 1))
  if (( $1 == 0 )); then
    printf 'ok %d - %s: %s\n' "$checks" "$current" "$2"
  else
    failures=$((failures + 1))
    printf 'not ok %d - %s: %s\n' "$checks" "$current" "$2"
    show_debug
  fi
}

expect_status() { [[ $status == "$1" ]]; report $? "exit status $1 (got $status)"; }
expect_in() { [[ ${!1} == *"$2"* ]]; report $? "$1 contains '$2'"; }
expect_not_in() { [[ ${!1} != *"$2"* ]]; report $? "$1 does not contain '$2'"; }
expect_empty() { [[ -z ${!1} ]]; report $? "$1 is empty"; }

# new_case NAME: resets the stub and the secrets for a new scenario.
new_case() {
  current=$1
  export STUB_PUSH_OUTPUT="" STUB_PUSH_STATUS=0 STUB_LIST_OUTPUT="" STUB_LIST_STATUS=0
  unset SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN
}

# collect DIR: reads the files written by the last run and checks that the
# stub only saw read-only commands.
collect() {
  gh_out="$(<"$1/output")"
  gh_summary="$(<"$1/summary")"
  calls="$(<"$1/calls")"
  local call
  while IFS= read -r call; do
    if [[ -n $call && $call != "db push --dry-run"* && $call != "migration list"* ]]; then
      failures=$((failures + 1))
      printf 'not ok - %s: unexpected CLI call "%s"\n' "$current" "$call"
    fi
  done <<< "$calls"
}

# run_guard ARGS...: runs the guard as in GitHub Actions.
run_guard() {
  local dir="$work/case$((++case_no))"
  mkdir "$dir"
  : > "$dir/output"
  : > "$dir/summary"
  : > "$dir/calls"
  out="$(PATH="$work/bin:$PATH" STUB_CALLS="$dir/calls" GITHUB_ACTIONS=true \
    GITHUB_OUTPUT="$dir/output" GITHUB_STEP_SUMMARY="$dir/summary" \
    bash "$guard_script" "$@" 2>&1)"
  status=$?
  collect "$dir"
}

# run_guard_locally ARGS...: runs the guard as on a laptop (no GITHUB_*).
run_guard_locally() {
  local dir="$work/case$((++case_no))"
  mkdir "$dir"
  : > "$dir/output"
  : > "$dir/summary"
  : > "$dir/calls"
  out="$(env -u GITHUB_ACTIONS -u GITHUB_OUTPUT -u GITHUB_STEP_SUMMARY \
    PATH="$work/bin:$PATH" STUB_CALLS="$dir/calls" \
    bash "$guard_script" "$@" 2>&1)"
  status=$?
  collect "$dir"
}

dry_run_header=(
  "DRY RUN: migrations will *not* be pushed to the database."
  "Connecting to remote database..."
)
list_header=(
  ""
  "  "
  "   Local          | Remote         | Time (UTC)          "
  "  ----------------|----------------|---------------------"
)

# ---------------------------------------------------------------------------
# Plan mode.
# ---------------------------------------------------------------------------
new_case "plan: only 0014 pending"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Would push these migrations:" " • 0014_proteger_rol.sql")"
run_guard --linked
expect_status 0
expect_in calls "db push --dry-run --linked"
expect_in gh_out "has_changes=true"
expect_in gh_out "pending=0014_proteger_rol.sql"
expect_in gh_summary '- `0014_proteger_rol.sql`'

new_case "plan: 0014 and timestamped migrations pending"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Would push these migrations:" \
  " • 0014_proteger_rol.sql" " • 20260928010451_pedido_totales.sql" " • 20260928010452_ventas_validas.sql")"
run_guard --linked
expect_status 0
expect_in gh_out "pending=0014_proteger_rol.sql 20260928010451_pedido_totales.sql 20260928010452_ventas_validas.sql"

new_case "plan: duplicated file names are listed once"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 0014_proteger_rol.sql" "Pushing 0014_proteger_rol.sql")"
run_guard --linked
expect_status 0
expect_in gh_out "pending=0014_proteger_rol.sql"
expect_not_in gh_out "pending=0014_proteger_rol.sql 0014_proteger_rol.sql"

new_case "plan: baseline migrations pending"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Would push these migrations:" \
  " • 0001_init.sql" " • 0002_imagenes_multiples.sql" " • 0013_origen_pedido.sql" " • 0014_proteger_rol.sql")"
run_guard --linked
expect_status 1
expect_in out "Baseline migrations would be re-applied"
expect_in out "0001_init.sql 0002_imagenes_multiples.sql 0013_origen_pedido.sql"
expect_not_in out "0014_proteger_rol.sql 0001"
expect_empty gh_out
expect_in gh_summary "**Blocked:** it would re-apply baseline migrations"

new_case "plan: baseline as the second token of a line"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 0014_proteger_rol.sql 0001_init.sql")"
run_guard --linked
expect_status 1
expect_in out "Baseline migrations would be re-applied"
expect_in out "0001_init.sql"
expect_empty gh_out

new_case "plan: baseline glued after a comma"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "0014_proteger_rol.sql,0013_origen_pedido.sql")"
run_guard --linked
expect_status 1
expect_in out "0013_origen_pedido.sql"
expect_empty gh_out

new_case "plan: remote database up to date"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
run_guard --linked
expect_status 0
expect_in gh_out "has_changes=false"
expect_in gh_summary "Nothing to push."

new_case "plan: local database up to date (--local)"
STUB_PUSH_OUTPUT="$(lines "DRY RUN: migrations will *not* be pushed to the database." "Local database is up to date.")"
run_guard --local
expect_status 0
expect_in calls "db push --dry-run --local"
expect_in gh_out "has_changes=false"

new_case "plan: unrecognised output"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Something the guard has never seen.")"
run_guard --linked
expect_status 1
expect_in out "Unrecognised dry-run output"
expect_empty gh_out

new_case "plan: empty output"
STUB_PUSH_OUTPUT=""
run_guard --linked
expect_status 1
expect_in out "Unrecognised dry-run output"
expect_empty gh_out

new_case "plan: dry-run exits non-zero"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 0014_proteger_rol.sql" "failed to connect to postgres")"
STUB_PUSH_STATUS=3
run_guard --linked
expect_status 3
expect_in out "db push dry-run failed"
expect_empty gh_out
expect_in gh_summary "the dry-run failed (exit 3)"

new_case "plan: secrets are scrubbed from the log and the summary"
export SUPABASE_DB_PASSWORD='s3cr3t-P@ss/w0rd' SUPABASE_ACCESS_TOKEN='sbp_0123456789abcdef'
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" \
  "using password s3cr3t-P@ss/w0rd and token sbp_0123456789abcdef" \
  "dial postgresql://postgres.nmjwuxupovkqrxmttgrw:s3cr3t-P%40ss%2Fw0rd@aws-0.pooler.supabase.com:6543/postgres failed" \
  "Remote database is up to date.")"
run_guard --linked
expect_status 0
expect_not_in out "s3cr3t"
expect_not_in out "sbp_0123456789abcdef"
expect_not_in gh_summary "s3cr3t"
expect_not_in gh_summary "sbp_0123456789abcdef"
expect_in gh_summary "postgresql://postgres.nmjwuxupovkqrxmttgrw:***@aws-0.pooler.supabase.com"
expect_in gh_summary "using password *** and token ***"

new_case "plan: runs locally without GitHub variables"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 0014_proteger_rol.sql")"
run_guard_locally
expect_status 0
expect_in calls "db push --dry-run"
expect_in out "0014_proteger_rol.sql"
expect_not_in out "::error"

new_case "plan: blocks locally with a plain error message"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 0001_init.sql")"
run_guard_locally --linked
expect_status 1
expect_in out "ERROR: Baseline migrations would be re-applied"
expect_not_in out "::error"

# ---------------------------------------------------------------------------
# Verify mode.
# ---------------------------------------------------------------------------
new_case "verify: everything applied"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" \
  "   0013           | 0013           | 0013                " \
  "   0014           | 0014           | 0014                " \
  "   20260928010451 | 20260928010451 | 2026-09-28 01:04:51 ")"
run_guard --verify --linked
expect_status 0
expect_in calls "db push --dry-run --linked"
expect_in calls "migration list --linked"
expect_in gh_summary "All 3 local migrations are applied on the remote database."
expect_empty gh_out

new_case "verify: dry-run still has pending migrations"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" " • 20260928010452_ventas_validas.sql")"
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" "   0014           | 0014           | 0014                ")"
run_guard --verify --linked
expect_status 1
expect_in out "migrations still pending: 20260928010452_ventas_validas.sql"

new_case "verify: a local migration is not applied remotely"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" \
  "   0014           | 0014           | 0014                " \
  "   20260928010452 |                | 2026-09-28 01:04:52 ")"
run_guard --verify --linked
expect_status 1
expect_in out "local migrations not applied remotely: 20260928010452"
expect_in gh_summary "**Failed:**"

new_case "verify: a remote migration is missing locally"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" \
  "   0014           | 0014           | 0014                " \
  "                  | 20260101000000 | 2026-01-01 00:00:00 ")"
run_guard --verify --linked
expect_status 1
expect_in out "remote migrations missing locally: 20260101000000"

new_case "verify: unrecognised migration list output"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="$(lines "Some new format the guard does not know")"
run_guard --verify --linked
expect_status 1
expect_in out "unrecognised supabase migration list output"

new_case "verify: migration list exits non-zero"
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="failed to connect"
STUB_LIST_STATUS=1
run_guard --verify --linked
expect_status 1
expect_in out "supabase migration list failed (exit 1)"

new_case "verify: dry-run exits non-zero"
STUB_PUSH_OUTPUT="failed to connect"
STUB_PUSH_STATUS=1
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" "   0014           | 0014           | 0014                ")"
run_guard --verify --linked
expect_status 1
expect_in out "the dry-run failed (exit 1)"

new_case "verify: secrets are scrubbed from the migration list"
export SUPABASE_DB_PASSWORD='s3cr3t-P@ss/w0rd'
STUB_PUSH_OUTPUT="$(lines "${dry_run_header[@]}" "Remote database is up to date.")"
STUB_LIST_OUTPUT="$(lines "${list_header[@]}" "   0014           | 0014           | 0014                " "password s3cr3t-P@ss/w0rd")"
run_guard --verify --linked
expect_status 0
expect_not_in out "s3cr3t"
expect_not_in gh_summary "s3cr3t"

printf '\n%d checks, %d failed\n' "$checks" "$failures"
(( failures == 0 ))
