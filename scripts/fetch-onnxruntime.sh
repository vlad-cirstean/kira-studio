#!/bin/sh
# fetch-onnxruntime.sh — downloads the pinned ONNX Runtime release for Kira Space's local memory
# embeddings (P210) into apps/kira-space/build/onnxruntime/<platform>/, checksum-verified.
#
# Usage: scripts/fetch-onnxruntime.sh [osx-arm64|linux-x64]   (default osx-arm64, the shipped slice)
#   osx-arm64  the dylib the macOS bundle task copies into Contents/Frameworks
#   linux-x64  development and tests only: KIRA_ORT_LIB=<printed path>
#
# Lives in scripts/, the one place S10 allows a release-asset download. Idempotent. The version is
# pinned here and in internal/memory/embed/paths.go; verify-packaging.sh S12 keeps them equal.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

ORT_VERSION="1.29.1"
PLATFORM="${1:-osx-arm64}"

case "$PLATFORM" in
  osx-arm64)
    SHA256="c845ad2f4340669dc454c0ae092ccef7270d5bf858281890aef3c9bbf7da41e9"
    LIB="libonnxruntime.$ORT_VERSION.dylib"
    ;;
  linux-x64)
    SHA256="a28d7d65acafc06fb0f416cb409998773f5314c7eebf77caf907812831cdfc67"
    LIB="libonnxruntime.so.$ORT_VERSION"
    ;;
  *)
    echo "fetch-onnxruntime: unknown platform '$PLATFORM' (want osx-arm64 or linux-x64)" >&2
    exit 1
    ;;
esac

DEST="$ROOT_DIR/apps/kira-space/build/onnxruntime/$PLATFORM"
STAMP="$DEST/.archive-sha256"

if [ -f "$DEST/$LIB" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$SHA256" ]; then
  echo "$DEST/$LIB"
  exit 0
fi

require_cmd curl "install curl"
if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | cut -d' ' -f1; }
else
  hash_file() { shasum -a 256 "$1" | cut -d' ' -f1; }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

NAME="onnxruntime-$PLATFORM-$ORT_VERSION"
curl -fsSL -o "$TMP/$NAME.tgz" "https://github.com/microsoft/onnxruntime/releases/download/v$ORT_VERSION/$NAME.tgz"
GOT="$(hash_file "$TMP/$NAME.tgz")"
if [ "$GOT" != "$SHA256" ]; then
  echo "fetch-onnxruntime: checksum mismatch for $NAME.tgz: got $GOT, want $SHA256" >&2
  exit 1
fi

tar -xzf "$TMP/$NAME.tgz" -C "$TMP"
rm -rf "$DEST"
mkdir -p "$DEST"
cp "$TMP/$NAME/lib/$LIB" "$TMP/$NAME/LICENSE" "$TMP/$NAME/ThirdPartyNotices.txt" "$DEST/"
printf '%s' "$SHA256" >"$STAMP"
echo "$DEST/$LIB"
