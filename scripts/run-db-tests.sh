#!/bin/sh
# run-db-tests.sh — P57 D17. tests/db/ is almost entirely a `bun test` suite, but
# tests/db/kafka.spec.ts is the one exception: Bun cannot load @confluentinc/kafka-javascript's
# native addon under any ABI (P32 F21), so that one file runs esbuild-bundled under a real Node
# process instead — the vendored one (shell/runtime/node/), exactly as the addon landed on disk
# from `bun install`, with no Electron-ABI rebuild step (P51 part 4 already proved the addon loads
# under a stock Node with no ABI dance at all). `--path-ignore-patterns` is what lets kafka.spec.ts
# live beside every other tests/db/ spec instead of in its own excluded directory.
set -eu

bun test tests/db --path-ignore-patterns '**/kafka.spec.ts'

NODE_BIN="shell/runtime/node/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  echo "run-db-tests.sh: $NODE_BIN not found — run scripts/vendor-node.sh first" >&2
  exit 1
fi

OUT_DIR="out/tests/db"
mkdir -p "$OUT_DIR"
bunx esbuild tests/db/kafka.spec.ts --bundle --platform=node --format=cjs \
  --external:@confluentinc/kafka-javascript --external:ssh2 --external:cpu-features \
  --outfile="$OUT_DIR/kafka.spec.cjs"
"$NODE_BIN" "$OUT_DIR/kafka.spec.cjs"
