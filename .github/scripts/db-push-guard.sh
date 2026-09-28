#!/usr/bin/env bash
# Plan and verification guard for `supabase db push`.
#
# Usage:
#   db-push-guard.sh [--verify] [supabase flags...]
#
# Extra flags are forwarded to the CLI: `--linked` for production (the CLI
# default once the repo is linked), `--local` to try it against the local stack.
#
# Plan mode (default), before `supabase db push`. Runs
# `supabase db push --dry-run` and fails:
#   - if the dry-run itself fails (history mismatch, connection error, ...);
#   - if it would push any baseline migration 0001-0013. Those were applied by
#     hand in production before the CLI was adopted. Seeing them here means the
#     one-time `supabase migration repair --status applied 0001 ... 0013` was
#     not done, and pushing would run them again;
#   - if its output cannot be understood (fail closed).
#
# Verify mode (--verify), after `supabase db push`. Fails unless:
#   - the dry-run succeeds and says the database is up to date, and
#   - `supabase migration list` shows every local migration applied on the
#     remote database and no remote-only migration.
#
# Output format (CLI 2.106.0): the dry-run plan goes to stderr, one file per
# line (" • 0014_proteger_rol.sql"), or "<Remote|Local> database is up to
# date." when there is nothing to push. The parser does not depend on the
# bullet or the header: it takes every "<digits>_<name>.sql" token on every
# line. `migration list` prints a "Local | Remote | Time (UTC)" table.
#
# Runs the same in GitHub Actions and locally (Git Bash, Linux, macOS with
# bash >= 4.4). In Actions it also writes `has_changes` and `pending` to
# $GITHUB_OUTPUT (plan mode) and a section to $GITHUB_STEP_SUMMARY; without
# those variables it only prints to the terminal.
#
# Every CLI output is scrubbed before it is printed or written to the step
# summary: the values of SUPABASE_DB_PASSWORD and SUPABASE_ACCESS_TOKEN and any
# "scheme://user:password@" credentials become "***". Step summaries are not
# guaranteed to be masked like the log.
set -uo pipefail

readonly BASELINE_VERSIONS=" 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 "

mode=plan
if [[ ${1:-} == --verify ]]; then
  mode=verify
  shift
fi

summary() {
  if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
    printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"
  fi
}

gh_output() {
  if [[ -n ${GITHUB_OUTPUT:-} ]]; then
    printf '%s\n' "$@" >> "$GITHUB_OUTPUT"
  fi
}

# fail_msg TITLE MESSAGE: a GitHub annotation in Actions, plain text elsewhere.
fail_msg() {
  if [[ ${GITHUB_ACTIONS:-} == true ]]; then
    printf '::error title=%s::%s\n' "$1" "$2"
  else
    printf 'ERROR: %s. %s\n' "$1" "$2" >&2
  fi
}

# scrub TEXT: prints TEXT with secrets and URL credentials replaced by ***.
scrub() {
  local text=$1 secret rest='' match
  for secret in "${SUPABASE_DB_PASSWORD:-}" "${SUPABASE_ACCESS_TOKEN:-}"; do
    if [[ -n $secret ]]; then
      text=${text//"$secret"/"***"}
    fi
  done
  while [[ $text =~ ://([^:/@[:space:]]+):([^@[:space:]]+)@ ]]; do
    match=${BASH_REMATCH[0]}
    rest+="${text%%"$match"*}://${BASH_REMATCH[1]}:***@"
    text=${text#*"$match"}
  done
  printf '%s' "$rest$text"
}

# details TITLE TEXT: a collapsed block with TEXT in the step summary.
details() {
  summary "" "<details><summary>$1</summary>" "" '```text' "$2" '```' "" "</details>" ""
}

run_dry_run() {
  dry_run_output="$(supabase db push --dry-run "$@" 2>&1)"
  dry_run_status=$?
  dry_run_output="$(scrub "$dry_run_output")"
  printf '%s\n' "$dry_run_output"

  # Every migration file named anywhere in the output, in order, without
  # duplicates. All tokens of a line count, not just the first one.
  pending=()
  local line rest file
  while IFS= read -r line; do
    rest=$line
    while [[ $rest =~ [0-9]+_[A-Za-z0-9_.-]*\.sql ]]; do
      file=${BASH_REMATCH[0]}
      rest=${rest#*"$file"}
      if [[ " ${pending[*]} " != *" $file "* ]]; then
        pending+=("$file")
      fi
    done
  done <<< "$dry_run_output"
}

dry_run_is_up_to_date() {
  (( ${#pending[@]} == 0 )) && [[ $dry_run_output == *"database is up to date"* ]]
}

plan() {
  run_dry_run "$@"

  local file version
  local baseline_hits=()
  for file in "${pending[@]}"; do
    version=${file%%_*}
    if [[ $BASELINE_VERSIONS == *" $version "* ]]; then
      baseline_hits+=("$file")
    fi
  done

  summary "### Supabase migration plan" ""
  if (( dry_run_status == 0 && ${#pending[@]} > 0 )); then
    summary "Migrations that \`supabase db push\` would apply, in order:" ""
    for file in "${pending[@]}"; do
      summary "- \`$file\`"
    done
  elif (( dry_run_status == 0 )); then
    summary "Nothing to push."
  fi
  details "Dry-run output" "$dry_run_output"

  if (( dry_run_status != 0 )); then
    summary "**Blocked:** the dry-run failed (exit $dry_run_status)."
    fail_msg "db push dry-run failed" "supabase db push --dry-run exited with status $dry_run_status. If the log mentions the migration history, see the Migraciones section in CONTEXTO.md."
    exit "$dry_run_status"
  fi

  if (( ${#baseline_hits[@]} > 0 )); then
    summary "**Blocked:** it would re-apply baseline migrations: ${baseline_hits[*]}"
    fail_msg "Baseline migrations would be re-applied" "The dry-run would push ${baseline_hits[*]}. Migrations 0001-0013 were applied by hand in production. Run the one-time 'supabase migration repair --linked --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013' first (CONTEXTO.md, Migraciones). Nothing was pushed."
    exit 1
  fi

  if (( ${#pending[@]} == 0 )) && ! dry_run_is_up_to_date; then
    summary "**Blocked:** unrecognised dry-run output."
    fail_msg "Unrecognised dry-run output" "No migration files and no 'database is up to date' message found in the dry-run output. Refusing to continue; check the log and update .github/scripts/db-push-guard.sh if the CLI output format changed."
    exit 1
  fi

  if (( ${#pending[@]} > 0 )); then
    gh_output "has_changes=true" "pending=${pending[*]}"
  else
    gh_output "has_changes=false" "pending="
  fi
}

verify() {
  run_dry_run "$@"

  local list_output list_status line local_version remote_version
  local rows=0
  local not_applied=() remote_only=()
  list_output="$(supabase migration list "$@" 2>&1)"
  list_status=$?
  list_output="$(scrub "$list_output")"
  printf '%s\n' "$list_output"

  # Table rows look like "   0014           | 0014           | 0014". The
  # header and the separator line do not start with a digit.
  while IFS= read -r line; do
    if [[ $line =~ ^[[:space:]]*([0-9]*)[[:space:]]*\|[[:space:]]*([0-9]*)[[:space:]]*\| ]]; then
      local_version=${BASH_REMATCH[1]}
      remote_version=${BASH_REMATCH[2]}
      if [[ -z $local_version && -z $remote_version ]]; then
        continue
      fi
      rows=$((rows + 1))
      if [[ -z $remote_version ]]; then
        not_applied+=("$local_version")
      elif [[ -z $local_version ]]; then
        remote_only+=("$remote_version")
      fi
    fi
  done <<< "$list_output"

  summary "### Post-deploy migration check" ""
  details "Dry-run output" "$dry_run_output"
  details "supabase migration list" "$list_output"

  local problems=()
  if (( dry_run_status != 0 )); then
    problems+=("the dry-run failed (exit $dry_run_status)")
  elif (( ${#pending[@]} > 0 )); then
    problems+=("migrations still pending: ${pending[*]}")
  elif ! dry_run_is_up_to_date; then
    problems+=("unrecognised dry-run output")
  fi
  if (( list_status != 0 )); then
    problems+=("supabase migration list failed (exit $list_status)")
  elif (( rows == 0 )); then
    problems+=("unrecognised supabase migration list output")
  fi
  if (( ${#not_applied[@]} > 0 )); then
    problems+=("local migrations not applied remotely: ${not_applied[*]}")
  fi
  if (( ${#remote_only[@]} > 0 )); then
    problems+=("remote migrations missing locally: ${remote_only[*]}")
  fi

  if (( ${#problems[@]} > 0 )); then
    local problem joined
    summary "**Failed:**" ""
    for problem in "${problems[@]}"; do
      summary "- $problem"
    done
    printf -v joined '%s; ' "${problems[@]}"
    fail_msg "Post-deploy migration check failed" "${joined%; }. Check the log; the database may be partially migrated (CONTEXTO.md, Migraciones)."
    exit 1
  fi

  summary "All $rows local migrations are applied on the remote database."
}

"$mode" "$@"
