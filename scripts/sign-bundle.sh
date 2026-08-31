#!/bin/sh
# sign-bundle.sh — P52 §10.1's four codesign lines, made real (P57 §4.13). Ad-hoc signs the
# vendored node binary individually before the deep-sign over the whole bundle, since codesign
# does not descend into a plain (non-framework) nested Mach-O on its own. Also signs the Kafka
# native module if present (see verify-packaging.sh's A2 comment) — it never is, and no longer
# needs to be: Kafka is served in-process by a native Go adapter since P58e M9.3, not by the Node
# engine child, so nothing ever vendors this module. P58f removes this block with the child.
#
# Paths are shell/build/darwin/Taskfile.yml's create:app:bundle output layout, not P52's — that
# plan explicitly warned its own paths were written from an earlier session and would need
# re-verifying against a real packaged bundle rather than copied. macOS only.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP="$ROOT_DIR/shell/bin/Kira Studio.app"

if [ ! -d "$APP" ]; then
  echo "sign-bundle.sh: \"$APP\" not found — run 'bun run package' (or 'cd shell && wails3 task darwin:package') first" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "sign-bundle.sh: codesign is macOS-only; nothing to do on $(uname -s)" >&2
  exit 1
fi

NODE_BIN="$APP/Contents/MacOS/runtime/node/bin/node"
if [ ! -f "$NODE_BIN" ]; then
  echo "sign-bundle.sh: \"$NODE_BIN\" missing — the bundle was not built with a vendored node runtime" >&2
  exit 1
fi
codesign --force --sign - "$NODE_BIN"

KAFKA_NATIVE="$APP/Contents/MacOS/runtime/engine/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node"
if [ -f "$KAFKA_NATIVE" ]; then
  codesign --force --sign - "$KAFKA_NATIVE"
else
  echo "sign-bundle.sh: note — \"$KAFKA_NATIVE\" not present, skipping (this module is unused: Kafka is served in-process by Go since P58e M9.3, not by the Node engine child)"
fi

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "sign-bundle.sh: signed and verified \"$APP\""
