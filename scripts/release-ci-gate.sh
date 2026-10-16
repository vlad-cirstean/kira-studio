#!/bin/sh
# release-ci-gate.sh <sha> <ref> [--dry-run] — release gate (P295): waits for a green pr.yml run on
# <sha>, so a tag never publishes a commit whose PR CI is red. No run (never ran, or only
# cancelled by a newer push) dispatches pr.yml on <ref> once, then waits for it.
# Needs gh, jq, GH_TOKEN, GITHUB_REPOSITORY (the dispatch needs actions: write).
# Exit: 0 green, 1 red or timed out, 2 usage, 3 --dry-run would dispatch.
set -eu

POLL_SECONDS="${GATE_POLL_SECONDS:-30}"
DEADLINE_SECONDS="${GATE_DEADLINE_SECONDS:-2400}"

SHA=""
REF=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) echo "usage: $0 <sha> <ref> [--dry-run]" >&2; exit 2 ;;
    *)
      if [ -z "$SHA" ]; then SHA="$arg"
      elif [ -z "$REF" ]; then REF="$arg"
      else echo "usage: $0 <sha> <ref> [--dry-run]" >&2; exit 2
      fi
      ;;
  esac
done
if [ -z "$SHA" ] || [ -z "$REF" ]; then
  echo "usage: $0 <sha> <ref> [--dry-run]" >&2
  exit 2
fi
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
command -v gh >/dev/null 2>&1 || { echo "release-ci-gate: gh not found" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "release-ci-gate: jq not found" >&2; exit 1; }

FULL_SHA="$(gh api "repos/$GITHUB_REPOSITORY/commits/$SHA" --jq .sha)"

# Prints "<id> <event> <status> <conclusion> <url>" per run, newest first.
list_runs() {
  gh api "repos/$GITHUB_REPOSITORY/actions/workflows/pr.yml/runs?head_sha=$FULL_SHA&per_page=100" \
    --jq '.workflow_runs[] | "\(.id) \(.event) \(.status) \(.conclusion // "-") \(.html_url)"'
}

START="$(date +%s)"
DISPATCHED=0
while :; do
  RUNS="$(list_runs)"
  GREEN="$(printf '%s\n' "$RUNS" | awk '$3 == "completed" && $4 == "success" {print $5; exit}')"
  if [ -n "$GREEN" ]; then
    echo "release-ci-gate: PR CI green on $FULL_SHA: $GREEN"
    exit 0
  fi
  PENDING="$(printf '%s\n' "$RUNS" | awk '$3 == "queued" || $3 == "waiting" || $3 == "requested" || $3 == "pending" || $3 == "in_progress" {print $5}')"
  if [ -n "$PENDING" ]; then
    echo "release-ci-gate: waiting on PR CI: $(printf '%s' "$PENDING" | tr '\n' ' ')"
  else
    RED="$(printf '%s\n' "$RUNS" | awk '$3 == "completed" && ($4 == "failure" || $4 == "timed_out" || $4 == "startup_failure" || $4 == "action_required") {print $5}')"
    if [ -n "$RED" ]; then
      echo "release-ci-gate: PR CI failed on $FULL_SHA:" >&2
      printf '%s\n' "$RED" >&2
      echo "release-ci-gate: rerun PR CI for this commit, then rerun this release's failed jobs" >&2
      exit 1
    fi
    if [ "$DRY_RUN" = "1" ]; then
      echo "release-ci-gate: no usable PR CI run on $FULL_SHA; would dispatch pr.yml on $REF"
      exit 3
    fi
    if [ "$DISPATCHED" = "0" ]; then
      echo "release-ci-gate: no usable PR CI run on $FULL_SHA; dispatching pr.yml on $REF"
      gh workflow run pr.yml --ref "$REF"
      DISPATCHED=1
    else
      echo "release-ci-gate: waiting for the dispatched run to appear"
    fi
  fi
  if [ $(($(date +%s) - START)) -ge "$DEADLINE_SECONDS" ]; then
    echo "release-ci-gate: timed out after ${DEADLINE_SECONDS}s; last state:" >&2
    printf '%s\n' "$RUNS" >&2
    exit 1
  fi
  sleep "$POLL_SECONDS"
done
