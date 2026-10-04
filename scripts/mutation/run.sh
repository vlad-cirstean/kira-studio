#!/bin/sh
# run.sh — report-only mutation testing (P151). Never wired into hooks or CI gates.
#
#   sh scripts/mutation/run.sh go|ts|all [target...] [--changed REF] [--resume RUN_DIR] [--dirty]
#
# Targets: Go package dirs (go) or area names from tools/mutation/areas.json (ts).
# Env: MUTATION_WORKERS (default max(1, nproc/2)).
# Runs on a tracked-files snapshot in a temp dir, never the live checkout. Reports land in
# tools/mutation/out/<utc>-<sha>/ (gitignored); out/latest points at the newest run.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=../lib.sh
. "$SCRIPT_DIR/../lib.sh"
# lib.sh assumes callers sit directly in scripts/.
ROOT_DIR="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

require_cmd git "install git"
require_cmd jq "install jq"
require_cmd tar "install tar"

usage() {
  sed -n '2,9p' "$0" >&2
  exit 2
}

[ $# -ge 1 ] || usage
MODE="$1"
shift
case "$MODE" in go | ts | all) ;; *) usage ;; esac

TARGETS=""
CHANGED=""
RESUME=""
DIRTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --changed) CHANGED="${2:?--changed needs a ref}"; shift 2 ;;
    --resume) RESUME="${2:?--resume needs a run dir}"; shift 2 ;;
    --dirty) DIRTY=1; shift ;;
    -*) usage ;;
    *) TARGETS="$TARGETS $1"; shift ;;
  esac
done
if [ "$MODE" = all ] && [ -n "$TARGETS" ]; then
  echo "run.sh: targets need an explicit go|ts mode" >&2
  exit 2
fi

NPROC="$(nproc 2>/dev/null || sysctl -n hw.ncpu)"
HALF=$((NPROC / 2))
[ "$HALF" -ge 1 ] || HALF=1
WORKERS="${MUTATION_WORKERS:-$HALF}"

TOOLS_DIR="$ROOT_DIR/tools/mutation"
OUT_BASE="$TOOLS_DIR/out"
mkdir -p "$OUT_BASE"

if [ -n "$RESUME" ]; then
  RUN_DIR="$(CDPATH= cd -- "$RESUME" && pwd -P)"
  SNAP_REF="$(jq -r .snapshotRef "$RUN_DIR/meta.json")"
else
  SNAP_REF="HEAD"
  if [ "$DIRTY" = 1 ]; then
    SNAP_REF="$(git -C "$ROOT_DIR" stash create || true)"
    [ -n "$SNAP_REF" ] || SNAP_REF="HEAD"
  fi
  SNAP_REF="$(git -C "$ROOT_DIR" rev-parse "$SNAP_REF")"
  SHORT="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  RUN_DIR="$OUT_BASE/$(date -u +%Y%m%d-%H%M%S)-$SHORT"
  mkdir -p "$RUN_DIR"
  jq -n --arg commit "$(git -C "$ROOT_DIR" rev-parse HEAD)" --arg snap "$SNAP_REF" \
    --argjson dirty "$DIRTY" --arg nproc "$NPROC" \
    '{commit: $commit, snapshotRef: $snap, dirty: ($dirty == 1), nproc: ($nproc | tonumber), segments: []}' \
    >"$RUN_DIR/meta.json"
fi
ln -sfn "$RUN_DIR" "$OUT_BASE/latest"

RUN_TMP="$(mktemp -d)"
trap 'rm -rf "$RUN_TMP"' EXIT INT TERM
# gremlins workdirs, Stryker sandboxes and runner temp files all follow TMPDIR.
export TMPDIR="$RUN_TMP"
SNAP="$RUN_TMP/src"
mkdir -p "$SNAP"

echo "mutation: snapshot $SNAP_REF -> $SNAP"
git -C "$ROOT_DIR" archive "$SNAP_REF" | tar -x -C "$SNAP"
# Dependency trees are untracked; symlink them rather than copy ~800MB.
for nm in "$ROOT_DIR/node_modules" "$ROOT_DIR"/apps/*/node_modules "$ROOT_DIR"/packages/*/node_modules; do
  [ -e "$nm" ] || continue
  ln -s "$nm" "$SNAP${nm#"$ROOT_DIR"}"
done

# Resumable-unit helper: unit_done <kind> <slug> succeeds when the unit already has a result.
unit_done() { [ -f "$RUN_DIR/$1/$2.info.json" ]; }

# shellcheck source=go.sh
. "$SCRIPT_DIR/go.sh"

START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_S="$(date +%s)"
case "$MODE" in
  go) mutation_go ;;
  ts) echo "run.sh: ts mode not available yet" >&2; exit 2 ;;
  all) mutation_go ;;
esac
END_S="$(date +%s)"

jq --arg mode "$MODE" --arg start "$START" --argjson sec "$((END_S - START_S))" \
  --argjson workers "$WORKERS" --arg changed "$CHANGED" \
  '.segments += [{mode: $mode, start: $start, seconds: $sec, workers: $workers, changed: $changed}]' \
  "$RUN_DIR/meta.json" >"$RUN_DIR/meta.json.new"
mv "$RUN_DIR/meta.json.new" "$RUN_DIR/meta.json"

if [ -f "$TOOLS_DIR/summarize.ts" ]; then
  require_cmd bun "install it from https://bun.sh"
  bun "$TOOLS_DIR/summarize.ts" "$RUN_DIR"
fi
echo "mutation: done in $((END_S - START_S))s -> $RUN_DIR"
