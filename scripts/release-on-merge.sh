#!/bin/sh
# release-on-merge.sh — tags a merged chapter PR's merge commit and dispatches release.yml (P330).
#   pr <number> [--head-sha <sha>] [--wait <seconds>] [--dry-run]
#   sweep [--dry-run]    every PR into main merged in the last 48h
# Idempotent: a tag already at the merge commit is kept, and a release run that exists is not
# dispatched again. Needs gh, GH_TOKEN, GH_REPO (contents: write, actions: write).
# Exit: 0 done or nothing to do, 1 failure, 2 usage.
set -eu

CHAPTER_RE='^chapter/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
POLL_SECONDS=15
DRY_RUN=0

usage() {
  echo "usage: $0 pr <number> [--head-sha <sha>] [--wait <seconds>] [--dry-run] | sweep [--dry-run]" >&2
  exit 2
}

# tag_commit <tag>: prints the commit the tag points at; prints nothing when the tag does not exist.
tag_commit() {
  _err="$(mktemp)"
  if _ref="$(gh api "repos/$GH_REPO/git/ref/tags/$1" --jq '.object.type + " " + .object.sha' 2>"$_err")"; then
    rm -f "$_err"
    _type="${_ref%% *}"
    _sha="${_ref#* }"
    if [ "$_type" = tag ]; then
      _sha="$(gh api "repos/$GH_REPO/git/tags/$_sha" --jq .object.sha)" || return 1
    fi
    echo "$_sha"
    return 0
  fi
  if grep -q 'HTTP 404' "$_err"; then rm -f "$_err"; return 0; fi
  cat "$_err" >&2
  rm -f "$_err"
  return 1
}

# post_merge <merge sha>: once per merge, dispatches cache-warm.yml and pages.yml on main. A merge by
# github-actions starts neither workflow on its own. Runs before tagging, so a refused tag still warms.
post_merge() {
  _runs="$(gh run list --workflow cache-warm.yml --limit 100 --json displayTitle --jq ".[] | select(.displayTitle == \"Cache warm $1\") | .displayTitle")" || return 1
  [ -z "$_runs" ] || return 0
  if [ "$DRY_RUN" = 1 ]; then echo "would dispatch cache-warm.yml and pages.yml for $1"; return 0; fi
  gh workflow run cache-warm.yml --ref main -f "merge_sha=$1" || return 1
  gh workflow run pages.yml --ref main || return 1
  echo "dispatched cache-warm.yml and pages.yml for $1"
}

# handle_pr <number> <head sha or empty> <wait seconds>
handle_pr() {
  _pr="$1"; _want_head="$2"; _wait="$3"
  case "$_pr" in ''|*[!0-9]*) echo "bad PR number '$_pr'" >&2; return 1 ;; esac
  _start="$(date +%s)"
  while :; do
    _row="$(gh api "repos/$GH_REPO/pulls/$_pr" --jq '[.state, (.merged | tostring), (.merge_commit_sha // "-"), .base.ref, .head.ref, .head.sha, (.head.repo.full_name // "-")] | join(" ")')" || return 1
    read -r _state _merged _merge_sha _base _head _head_sha _head_repo <<EOF
$_row
EOF
    if [ "$_base" != main ] || [ "$_head_repo" != "$GH_REPO" ] || ! printf '%s\n' "$_head" | grep -Eq "$CHAPTER_RE"; then
      echo "PR #$_pr ($_head into $_base) is not a chapter PR; nothing to release"
      return 0
    fi
    if [ -n "$_want_head" ] && [ "$_head_sha" != "$_want_head" ]; then
      echo "PR #$_pr head moved past $_want_head; a later run handles it"
      return 0
    fi
    [ "$_merged" = true ] && break
    if [ "$_state" = closed ]; then echo "PR #$_pr closed unmerged; nothing to release"; return 0; fi
    if [ $(($(date +%s) - _start)) -ge "$_wait" ]; then
      echo "PR #$_pr not merged after ${_wait}s; the hourly sweep handles a later merge"
      return 0
    fi
    sleep "$POLL_SECONDS"
  done

  post_merge "$_merge_sha" || return 1
  _tag="${_head#chapter/}"
  _existing="$(tag_commit "$_tag")" || return 1
  if [ -z "$_existing" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      echo "would tag $_tag at $_merge_sha and dispatch release.yml"
      return 0
    fi
    if gh api -X POST "repos/$GH_REPO/git/refs" -f "ref=refs/tags/$_tag" -f "sha=$_merge_sha" >/dev/null; then
      echo "tagged $_tag at $_merge_sha"
    else
      _existing="$(tag_commit "$_tag")" || return 1
      if [ "$_existing" != "$_merge_sha" ]; then
        echo "could not create tag $_tag at $_merge_sha. From a machine with push access:" >&2
        echo "  git fetch origin && git tag $_tag $_merge_sha && git push origin $_tag" >&2
        echo "That tag push starts release.yml." >&2
        return 1
      fi
    fi
  elif [ "$_existing" != "$_merge_sha" ]; then
    echo "tag $_tag already exists at $_existing, not at PR #$_pr's merge commit $_merge_sha; the version was already released" >&2
    return 1
  fi

  if gh api "repos/$GH_REPO/releases/tags/$_tag" --jq .draft 2>/dev/null | grep -qx false; then
    echo "release $_tag is already published"
    return 0
  fi
  _runs="$(gh run list --workflow release.yml --limit 100 --json displayTitle --jq ".[] | select(.displayTitle == \"Release $_tag\") | .displayTitle")" || return 1
  if [ -n "$_runs" ]; then
    echo "release.yml already ran for $_tag; rerun its failed jobs from the Actions tab if it failed"
    return 0
  fi
  if [ "$DRY_RUN" = 1 ]; then echo "would dispatch release.yml for $_tag"; return 0; fi
  gh workflow run release.yml --ref main -f "tag=$_tag" || return 1
  echo "dispatched release.yml for $_tag"
}

sweep() {
  _since=$(($(date +%s) - 172800))
  _prs="$(gh api "repos/$GH_REPO/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50" \
    --jq ".[] | select(.merged_at != null and (.merged_at | fromdateiso8601) >= $_since) | .number")" || return 1
  _fail=0
  for _n in $_prs; do
    handle_pr "$_n" "" 0 || _fail=1
  done
  return "$_fail"
}

: "${GH_REPO:?GH_REPO not set}"
command -v gh >/dev/null 2>&1 || { echo "release-on-merge: gh not found" >&2; exit 1; }
MODE="${1:-}"
[ $# -gt 0 ] && shift
PR=""
HEAD_SHA=""
WAIT=0
case "$MODE" in
  pr) [ $# -gt 0 ] || usage; PR="$1"; shift ;;
  sweep) ;;
  *) usage ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --head-sha) [ $# -ge 2 ] || usage; HEAD_SHA="$2"; shift 2 ;;
    --wait) [ $# -ge 2 ] || usage; WAIT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) usage ;;
  esac
done
case "$WAIT" in ''|*[!0-9]*) usage ;; esac
if [ "$MODE" = pr ]; then handle_pr "$PR" "$HEAD_SHA" "$WAIT"; else sweep; fi
