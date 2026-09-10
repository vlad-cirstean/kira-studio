#!/bin/sh
# P13 D3/OQ-1, extended by G34 D16 to two more token layers: every var(--prefix-...) reference
# in each layer's own source tree must resolve to a real definition in that layer's own
# definition files. A grep-and-comm guard, not a dependency (stylelint is not in this repo's
# toolchain) — its one known blind spot is a var() carrying a fallback (var(--x, red)), which is
# legitimate and is skipped by construction (the pattern below only matches a var() whose closing
# paren directly follows the property name). That blind spot is exactly right for the --kui- pass
# below: every --kui-* reference in packages/kira-ui/src/theme/controls.css carries a fallback on
# purpose (a host that has not loaded a bridge must still render something), so this guard leaves
# that file alone and only catches a bridge-less *consumer* reference.
#
# G34 D16: this is the guard that would have caught G34's own F5 (packages/git-ui/src/App.vue
# referencing five --kv-* tokens outside the ancestor that used to define them) — there was no
# --kv-* or --kui-* equivalent of this script before this phase.
set -e

cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
STATUS=0

check_layer() {
  prefix="$1"
  src="$2"
  defs_files="$3"
  out="$TMP/$4"

  grep -rhoE --include='*.vue' --include='*.css' -- "var\(--${prefix}[a-zA-Z0-9-]+\)" $src |
    sed -E "s/^var\((--${prefix}[a-zA-Z0-9-]+)\)\$/\1/" | sort -u >"$out.used"

  grep -hoE -- "--${prefix}[a-zA-Z0-9-]+:" $defs_files |
    sed -E 's/:$//' | sort -u >"$out.defined"

  missing=$(comm -23 "$out.used" "$out.defined")

  if [ -n "$missing" ]; then
    echo "check-tokens: undefined --${prefix}* custom properties referenced in $src:" >&2
    echo "$missing" >&2
    STATUS=1
    return
  fi

  echo "check-tokens: every --${prefix}* reference in $src resolves to a real definition."
}

FRONTEND_SRC=apps/kira-studio/frontend/src
GIT_UI_SRC=packages/git-ui/src
KIRA_UI_SRC=packages/kira-ui/src

check_layer 'kira-' "$FRONTEND_SRC" \
  "$FRONTEND_SRC/theme/tokens.css $FRONTEND_SRC/theme/base.css $FRONTEND_SRC/theme/primitives.css" kira
check_layer 'kv-' "$GIT_UI_SRC" \
  "$GIT_UI_SRC/theme/vscode-tokens.css $GIT_UI_SRC/theme/density.css $GIT_UI_SRC/theme/kira-structure.css" kv
check_layer 'kui-' "$KIRA_UI_SRC $GIT_UI_SRC" "$GIT_UI_SRC/theme/kui-bridge.css" kui

exit $STATUS
