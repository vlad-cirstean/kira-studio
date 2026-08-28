#!/bin/sh
# native-electron-build.sh — P32 D6. Exactly one ABI matters in this repo: Electron's own
# (node_modules/electron/abi_version — 148 for the pinned electron@43.4.1). @confluentinc/
# kafka-javascript is a NAN addon (V8 C++ API): the prebuilds Confluent publishes are per-*Node*-
# version only (P32 F19, no Electron prebuild exists at all), and Bun cannot load this addon under
# any ABI regardless (P32 F21 — a matching-ABI load itself crashes on an undefined
# v8::FunctionTemplate::SetClassName). So the binary `bun install` leaves behind is a bootstrap
# only — useful for a driver-level Node spike, never the thing the shipped app loads — and this
# script is what guarantees the on-disk .node is actually built for Electron's ABI before anything
# that loads the driver (dev, test:e2e, test:db:kafka, packaging) runs.
#
# Cannot run in Claude Code's Linux web container: Electron's headers host
# (artifacts.electronjs.org) is proxy-blocked there (P32 F20), so step 4 below has nowhere to
# download headers from. Must run on the macOS/Colima box, or wherever Electron's headers are
# reachable.
set -eu

MODULE_DIR="node_modules/@confluentinc/kafka-javascript"
BUILD_DIR="$MODULE_DIR/build/Release"
NATIVE_FILE="$BUILD_DIR/confluent-kafka-javascript.node"
MARKER="$BUILD_DIR/.native-abi"
CACHE_DIR=".cache/native/confluent-kafka-javascript"

if [ ! -d "$MODULE_DIR" ]; then
  echo "native-electron-build: $MODULE_DIR is missing — run bun install first" >&2
  exit 1
fi

TARGET_ABI="$(cat node_modules/electron/abi_version)"

# 1/2: the common case — the on-disk binary already matches Electron's ABI. One `cat`.
if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$TARGET_ABI" ]; then
  exit 0
fi

mkdir -p "$CACHE_DIR"

# 3: a prior build for this exact ABI is cached (e.g. after an Electron downgrade back to a
# version already built once) — a file copy, not a rebuild.
if [ -f "$CACHE_DIR/$TARGET_ABI.node" ]; then
  echo "native-electron-build: restoring cached build for Electron ABI $TARGET_ABI"
  mkdir -p "$BUILD_DIR"
  cp "$CACHE_DIR/$TARGET_ABI.node" "$NATIVE_FILE"
  echo "$TARGET_ABI" > "$MARKER"
  exit 0
fi

# 4: no cached build for this ABI — a from-source librdkafka build against Electron's own headers
# (minutes, not seconds). node-gyp cleans $BUILD_DIR before rebuilding, which would otherwise
# destroy `bun install`'s own Node-ABI bootstrap binary on a failed attempt (verified empirically:
# a rebuild that dies partway leaves $BUILD_DIR missing entirely) — so the bootstrap is backed up
# first and restored if the rebuild fails, leaving a failed run no worse off than before it ran.
BOOTSTRAP_BACKUP="$(mktemp -d)/bootstrap.node"
if [ -f "$NATIVE_FILE" ]; then
  cp "$NATIVE_FILE" "$BOOTSTRAP_BACKUP"
fi

echo "native-electron-build: building @confluentinc/kafka-javascript for Electron ABI $TARGET_ABI"
if ! bunx electron-rebuild --only @confluentinc/kafka-javascript; then
  echo "native-electron-build: electron-rebuild failed" >&2
  if [ -f "$BOOTSTRAP_BACKUP" ]; then
    mkdir -p "$BUILD_DIR"
    cp "$BOOTSTRAP_BACKUP" "$NATIVE_FILE"
    echo "native-electron-build: restored the pre-rebuild bootstrap binary (still Node-ABI, not Electron's — loads under node/electron-rebuild spikes only, never under Bun or the packaged app)" >&2
  fi
  exit 1
fi

if [ ! -f "$NATIVE_FILE" ]; then
  echo "native-electron-build: electron-rebuild did not produce $NATIVE_FILE" >&2
  exit 1
fi

cp "$NATIVE_FILE" "$CACHE_DIR/$TARGET_ABI.node"
echo "$TARGET_ABI" > "$MARKER"
