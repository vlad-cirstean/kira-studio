#!/bin/sh
# P138: `ade` colours are `--kira-*` tokens; the only literals allowed are data values that encode
# queue state, not theme (P129 Part 1 §2.1): tones with their ink and the 20-slot work
# palette. Any other colour literal under `ade/`, comments
# included, fails. So does an allowlist entry with no hit left, keeping the list exactly the kept
# set. A kept value reused as chrome (selection, link, error text) is not visible here; review it.
# Docs: docs/v2.0/plans/P138-ade-theme-tokens.md §4.
set -e

cd "$(dirname "$0")/.."

ADE=apps/kira-space/frontend/src/ade
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export LC_ALL=C

# Lines starting with `;` are group comments.
grep -v '^;' >"$TMP/allow.raw" <<'EOF'
; tone tint, text, solid (`TONE`, tones.ts)
rgba(232,163,61,0.14)
#f0b85c
#e8a33d
rgba(239,107,91,0.14)
#f28b7d
#ef6b5b
rgba(108,197,138,0.14)
#7fd49b
#6cc58a
rgba(122,167,255,0.14)
#93b6ff
#7aa7ff
rgba(163,113,247,0.16)
#c3a3fb
#a371f7
#23252b
#b4b6bd
#6b6f7a
; Claude launch button solid (`CLAUDE_SOLID`, tones.ts)
#d97757
; ink on a tone solid (`TONE_INK`)
#15161a
#ffffff
; work palette (`PALETTE`, palette.ts)
#e07a4f
#e3a53c
#c9c23a
#8cc152
#4db86c
#35b5a0
#38a8cc
#4a8ee6
#6e79ea
#9a6ee2
#c566d8
#e062a8
#e35f79
#b88458
#94a35a
#58a08e
#7b92b8
#a57ec0
#d58c8c
#a3aab4
EOF
sort -u "$TMP/allow.raw" >"$TMP/allow"

grep -rnoiE --include='*.vue' --include='*.ts' --include='*.css' -- \
  '#[0-9a-f]{3,8}\b|(rgba?|hsla?|oklch|hwb|lab|lch)\([^)]*\)' "$ADE" |
  sed -E 's/^([^:]*:[0-9]+):(.*)$/\1	\2/' |
  awk -F'\t' '{ v = tolower($2); gsub(/ /, "", v); print $1 "\t" v }' >"$TMP/hits" || true

STATUS=0

awk -F'\t' 'NR == FNR { ok[$0]; next } !($2 in ok) { print $1 ": " $2 }' "$TMP/allow" "$TMP/hits" >"$TMP/bad"
if [ -s "$TMP/bad" ]; then
  echo "check-ade-colours: colour literal outside the kept set (use a --kira-* token or utility):" >&2
  cat "$TMP/bad" >&2
  STATUS=1
fi

cut -f2 "$TMP/hits" | sort -u >"$TMP/used"
comm -13 "$TMP/used" "$TMP/allow" >"$TMP/stale"
if [ -s "$TMP/stale" ]; then
  echo "check-ade-colours: allowlist entry with no hit left (remove it):" >&2
  cat "$TMP/stale" >&2
  STATUS=1
fi

if [ "$STATUS" -eq 0 ]; then
  echo "check-ade-colours: every colour literal under $ADE is in the kept set."
fi
exit "$STATUS"
