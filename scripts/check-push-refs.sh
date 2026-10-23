#!/bin/sh
# check-push-refs.sh — pre-push branch-name gate (P330). Reads git's pre-push stdin: one
# "<local ref> <local sha> <remote ref> <remote sha>" line per ref. A branch push must target main or
# chapter/v<major>.<minor>.<patch>; tag pushes, deletes and other refs pass. Exit 1 names each refusal.
set -eu

CHAPTER_RE='^chapter/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
bad=0
while read -r _lref lsha rref _rsha; do
  [ -n "${rref:-}" ] || continue
  # An all-zero local sha is a delete (40 zeros for SHA-1, 64 for SHA-256).
  case "$lsha" in *[!0]*) ;; *) continue ;; esac
  case "$rref" in
    refs/heads/*)
      name="${rref#refs/heads/}"
      if [ "$name" = main ] || printf '%s\n' "$name" | grep -Eq "$CHAPTER_RE"; then
        continue
      fi
      echo "pre-push: refusing branch '$name'. Push only main or chapter/v<major>.<minor>.<patch>, e.g. chapter/v0.2.12." >&2
      bad=1
      ;;
  esac
done
exit "$bad"
