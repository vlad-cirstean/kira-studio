#!/bin/sh
# run-ipc-backend.sh — P50 §2.6/D1. Runs every tests/ipc/**/*.backend.spec.ts file (plus the
# harness's own Docker-free self-test) esbuild-bundled, then executed under the vendored Node
# (node:test/node:assert/strict) rather than Bun: Bun cannot load some of the adapters this tier
# drives (sqlite needs node:sqlite, kafka needs the native-ABI driver — see AGENTS.md). This no
# longer needs Electron at all (P57 D15/§4.11) — the harness's own src/main imports are gone, and
# neither src/engine/{control,rpc}.ts nor any adapter under src/engine/adapters/ ever imported
# `electron` in the first place.
#
# One node process per spec file, sequentially (D2): each file's container helper
# (tests/db/support/*.ts) is a module-scope memo assuming one file per process, and this tier's
# value is correctness, not wall clock — N concurrent processes would mean N concurrent database
# containers for no reason this tier needs.
set -eu

NODE_BIN="shell/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  echo "run-ipc-backend.sh: $NODE_BIN not found — run scripts/vendor-node.sh first" >&2
  exit 1
fi

OUT_DIR="out/tests/ipc"
FIXTURES_DIR="out/tests/fixtures"

mkdir -p "$OUT_DIR" "$FIXTURES_DIR"
# tests/db/support/*.ts's own .sql-reading helpers resolve their seed file relative to
# __dirname — which, once bundled, is $OUT_DIR, not tests/db/fixtures. Copying the fixtures
# beside the bundle output fixes this with no edit to tests/db/ itself.
cp -R tests/db/fixtures/. "$FIXTURES_DIR/"

fail=0
for spec in tests/ipc/support/harness.spec.ts tests/ipc/*/*.backend.spec.ts; do
  [ -f "$spec" ] || continue
  name=$(basename "$spec" .ts)
  bundle="$OUT_DIR/$name.cjs"
  echo "--- $spec ---"
  bunx esbuild "$spec" --bundle --platform=node --format=cjs \
    --loader:.sql=text \
    --external:@confluentinc/kafka-javascript \
    --external:ssh2 --external:cpu-features \
    --outfile="$bundle"
  "$NODE_BIN" "$bundle" || fail=1
done

exit $fail
