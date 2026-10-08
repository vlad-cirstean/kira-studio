#!/bin/sh
# fetch-whisper.sh — builds the pinned whisper.cpp C library as static archives for Kira Space's
# local speech to text (P216) into apps/kira-space/build/whisper/<platform>/{include,lib}.
#
# Usage: scripts/fetch-whisper.sh <darwin-arm64|darwin-amd64|linux-x64>
#   darwin-*   the slices the macOS bundle links (Taskfile fetch:whisper)
#   linux-x64  development and tests only
# Prints the CGO_CFLAGS / CGO_LDFLAGS lines to export before `go build -tags whisper`.
#
# Lives in scripts/, the one place S10 allows a download. Idempotent. The source is a git clone
# pinned by commit SHA (v1.9.5); the release tarball hash was not reachable when this was written.
# The same SHA is in internal/memory/stt/spec.go; verify-packaging.sh S13 keeps them equal.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

WHISPER_TAG="v1.9.5"
WHISPER_COMMIT="d1be6fde11ac6e0407606b4e42fe72d34add8037"
PLATFORM="${1:-}"

COMMON="-DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_EXAMPLES=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DCMAKE_BUILD_TYPE=Release"
DARWIN="-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_BLAS=ON -DGGML_NATIVE=OFF"
case "$PLATFORM" in
  darwin-arm64) FLAGS="$COMMON $DARWIN -DCMAKE_OSX_ARCHITECTURES=arm64" ;;
  darwin-amd64) FLAGS="$COMMON $DARWIN -DCMAKE_OSX_ARCHITECTURES=x86_64 -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON" ;;
  linux-x64) FLAGS="$COMMON -DGGML_NATIVE=ON" ;;
  *)
    echo "fetch-whisper: unknown platform '$PLATFORM' (want darwin-arm64, darwin-amd64 or linux-x64)" >&2
    exit 1
    ;;
esac

BUILD_ROOT="$ROOT_DIR/apps/kira-space/build/whisper"
SRC="$BUILD_ROOT/src"
DEST="$BUILD_ROOT/$PLATFORM"
STAMP="$DEST/.stamp"
WANT="$WHISPER_COMMIT $FLAGS"

print_env() {
  echo "export CGO_CFLAGS=\"-I$DEST/include\""
  echo "export CGO_LDFLAGS=\"-L$DEST/lib\""
}

if [ -f "$DEST/lib/libwhisper.a" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$WANT" ]; then
  print_env
  exit 0
fi

require_cmd git "install git"
require_cmd cmake "install cmake"

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$BUILD_ROOT"
  rm -rf "$SRC"
  git clone --quiet --depth 1 --branch "$WHISPER_TAG" https://github.com/ggml-org/whisper.cpp "$SRC" >&2
fi
GOT="$(git -C "$SRC" rev-parse HEAD)"
if [ "$GOT" != "$WHISPER_COMMIT" ]; then
  echo "fetch-whisper: $WHISPER_TAG is commit $GOT, want $WHISPER_COMMIT" >&2
  exit 1
fi

OBJ="$BUILD_ROOT/obj-$PLATFORM"
rm -rf "$OBJ" "$DEST"
# shellcheck disable=SC2086 # FLAGS is a deliberate word list
cmake -S "$SRC" -B "$OBJ" -DCMAKE_INSTALL_PREFIX="$DEST" $FLAGS >&2
cmake --build "$OBJ" --config Release -j "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)" >&2
cmake --install "$OBJ" --config Release >&2
rm -rf "$OBJ"
printf '%s' "$WANT" >"$STAMP"
print_env
