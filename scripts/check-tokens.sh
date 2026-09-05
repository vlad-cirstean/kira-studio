#!/bin/sh
# P13 D3/OQ-1: every var(--kira-...) reference in the renderer must resolve to a real
# definition in theme/{tokens,base,primitives}.css. A grep-and-comm guard, not a dependency
# (stylelint is not in this repo's toolchain) — its one known blind spot is a var() carrying
# a fallback (var(--x, red)), which is legitimate and is skipped by construction (the pattern
# below only matches a var() whose closing paren directly follows the property name).
set -e

cd "$(dirname "$0")/.."

SRC=apps/kira-studio/frontend/src
DEFS_FILES="$SRC/theme/tokens.css $SRC/theme/base.css $SRC/theme/primitives.css"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

grep -rhoE --include='*.vue' --include='*.css' -- 'var\(--kira-[a-zA-Z0-9-]+\)' "$SRC" |
  sed -E 's/^var\((--kira-[a-zA-Z0-9-]+)\)$/\1/' | sort -u >"$TMP/used"

grep -hoE -- '--kira-[a-zA-Z0-9-]+:' $DEFS_FILES |
  sed -E 's/:$//' | sort -u >"$TMP/defined"

MISSING=$(comm -23 "$TMP/used" "$TMP/defined")

if [ -n "$MISSING" ]; then
  echo "check-tokens: undefined custom properties referenced in $SRC:" >&2
  echo "$MISSING" >&2
  exit 1
fi

echo "check-tokens: every --kira-* reference resolves to a real definition."
