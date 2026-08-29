#!/bin/sh
# Fetches the two binary artifacts a Neutralino-packaged engine process needs that this repo
# cannot build itself: a real Node.js runtime (Neutralino has no embedded Node, unlike Electron)
# and @confluentinc/kafka-javascript's native addon built for that runtime's ABI on macOS.
#
# Both are ordinary downloads, no compiler needed — see
# docs/v1/plans/P51-neutralino-migration-spike.md §9.3 for why this matters: P32 D6's
# Electron-ABI rebuild (scripts/native-electron-build.sh) is blocked in this sandbox because
# artifacts.electronjs.org is proxy-blocked; neither nodejs.org nor Confluent's own GitHub
# Releases are, and a plain Node engine process needs no Electron-ABI rebuild at all — Confluent
# publishes a real prebuild per Node ABI.
#
# Output goes to neutralino/engine-runtime/ (gitignored — these are build-time fetches, not
# repo content, same treatment as neutralino/bin/).
#
# Both binaries are stripped of debug symbols after download (P51 §9.4 — measured ~19% off the
# Node binary, ~8% off the kafka addon, both still valid Mach-O; this must happen before signing,
# never after, since stripping invalidates any existing signature). GNU binutils' `strip` cannot
# read Mach-O at all ("file format not recognized") — this needs `llvm-strip` specifically on
# Linux, or macOS's own Xcode-CLT `strip` when this script runs on a real Mac. Neither present:
# skip stripping and say so, same pattern verify-packaging.sh uses for its own runner-gated checks.
set -eu

repo_root=$(cd "$(dirname "$0")/.." && pwd)
out_dir="$repo_root/neutralino/engine-runtime"
arch="${1:-arm64}"

node_version=$(node -p "process.version" | sed 's/^v//')
node_abi=$(node -p "process.versions.modules")
kafka_version=$(node -p "require('$repo_root/node_modules/@confluentinc/kafka-javascript/package.json').version")

mkdir -p "$out_dir"

strip_macho() {
  if command -v llvm-strip >/dev/null 2>&1; then
    llvm-strip -S -x "$1"
  elif [ "$(uname -s)" = "Darwin" ] && command -v strip >/dev/null 2>&1; then
    strip -S -x "$1"
  else
    echo "fetch-neutralino-engine-runtime: note — no Mach-O-capable strip found (need llvm-strip, or macOS's own strip); leaving $1 unstripped"
  fi
}

# --- Node.js runtime (darwin) ---------------------------------------------------------------
node_dir="$out_dir/node-v$node_version-darwin-$arch"
if [ ! -x "$node_dir/bin/node" ]; then
  echo "fetch-neutralino-engine-runtime: downloading Node v$node_version darwin-$arch..."
  curl -sSL -o "$out_dir/node.tar.gz" \
    "https://nodejs.org/dist/v$node_version/node-v$node_version-darwin-$arch.tar.gz"
  tar -xzf "$out_dir/node.tar.gz" -C "$out_dir"
  rm -f "$out_dir/node.tar.gz"
  strip_macho "$node_dir/bin/node"
fi
echo "node runtime: $node_dir/bin/node ($(du -h "$node_dir/bin/node" | cut -f1))"

# --- @confluentinc/kafka-javascript native addon (darwin, matching this repo's Node ABI) ----
kafka_dir="$out_dir/kafka-native-darwin-$arch"
kafka_node="$kafka_dir/confluent-kafka-javascript.node"
if [ ! -f "$kafka_node" ]; then
  echo "fetch-neutralino-engine-runtime: downloading kafka-javascript native addon for node-v$node_abi darwin-$arch..."
  mkdir -p "$kafka_dir"
  asset="confluent-kafka-javascript-v$kafka_version-node-v$node_abi-darwin-unknown-$arch.tar.gz"
  curl -sSL -o "$out_dir/kafka.tar.gz" \
    "https://github.com/confluentinc/confluent-kafka-javascript/releases/download/v$kafka_version/$asset"
  tar -xzf "$out_dir/kafka.tar.gz" -C "$kafka_dir" Release/confluent-kafka-javascript.node --strip-components=1
  rm -f "$out_dir/kafka.tar.gz"
  strip_macho "$kafka_node"
fi
echo "kafka native addon: $kafka_node ($(du -h "$kafka_node" | cut -f1))"
