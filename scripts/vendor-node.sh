#!/bin/sh
# Vendors a real Node runtime into shell/runtime/node/, the ordinary kind anyone downloads from
# nodejs.org — not the system `node`, not Electron's embedded one (P51 §1.2, P52 §3.1).
#
# Trims lib/node_modules/npm (17 MB, npm's own CLI — not needed to run a fixed engine/index.js)
# and include/ (64 MB, C headers needed only to compile native addons *against* this Node, never
# at runtime) — P51 part 4's measured 81 MB saving, applied at vendor time rather than left as a
# manual step.
set -eu

NODE_VERSION=22.20.0
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEST="$ROOT_DIR/shell/runtime/node"

case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) echo "vendor-node.sh: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) echo "vendor-node.sh: unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

if [ "$OS" = "darwin" ]; then
  EXT=tar.gz
else
  EXT=tar.xz
fi

ARCHIVE="node-v${NODE_VERSION}-${OS}-${ARCH}.${EXT}"
URL="https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE}"

# Pinned per P51/AGENTS.md: proxy.golang.org and nodejs.org are reachable even where
# wails.io/v3.wails.io are not — this is the same download part 4 used on real macOS hardware.
# SHA-256 values pinned from nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt.
case "${OS}-${ARCH}" in
  darwin-arm64) EXPECTED_SHA256=cc04a76a09f79290194c0646f48fec40354d88969bec467789a5d55dd097f949 ;;
  linux-x64)    EXPECTED_SHA256=00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc ;;
  *)
    echo "vendor-node.sh: no pinned checksum for ${OS}-${ARCH} — add one from" \
         "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt before vendoring on this platform." >&2
    exit 1
    ;;
esac

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "vendor-node.sh: downloading ${URL}"
curl -fsSL -o "$WORK_DIR/$ARCHIVE" "$URL"

ACTUAL_SHA256="$(sha256sum "$WORK_DIR/$ARCHIVE" | cut -d' ' -f1)"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "vendor-node.sh: checksum mismatch for $ARCHIVE" >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  exit 1
fi

tar -x -C "$WORK_DIR" -f "$WORK_DIR/$ARCHIVE"
EXTRACTED="$WORK_DIR/node-v${NODE_VERSION}-${OS}-${ARCH}"

rm -rf "$EXTRACTED/include" "$EXTRACTED/lib/node_modules/npm"

# bin/npm and bin/npx are symlinks into the node_modules/npm dir just removed — left in place
# they're dangling, which breaks `codesign --deep --strict` (it fails resource validation trying
# to stat a symlink target that doesn't exist), and neither is ever invoked at runtime: the engine
# child is always spawned as `node <script>` directly, never via npm/npx. corepack's symlink
# points elsewhere (lib/node_modules/corepack, not touched above) and stays valid, but it is
# equally unneeded at runtime, so it goes too for the same reason npm/npx do.
rm -f "$EXTRACTED/bin/npm" "$EXTRACTED/bin/npx" "$EXTRACTED/bin/corepack"

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$EXTRACTED" "$DEST"

echo "vendor-node.sh: vendored node v${NODE_VERSION} (${OS}-${ARCH}) into $DEST"
"$DEST/bin/node" --version
