#!/bin/sh
# sign-bundle.sh — P52 §10.1's four codesign lines, made real (P57 §4.13). P58f: there is no
# vendored node binary and no Kafka native module to sign individually any more — every adapter,
# Kafka included, is served in-process by native Go since P58e/P58f. One deep sign over the whole
# bundle is all that is left.
#
# Paths are apps/kira-studio/build/darwin/Taskfile.yml's create:app:bundle output layout, not P52's — that
# plan explicitly warned its own paths were written from an earlier session and would need
# re-verifying against a real packaged bundle rather than copied. macOS only.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
APP="$ROOT_DIR/apps/kira-studio/bin/Kira Studio.app"

if [ ! -d "$APP" ]; then
  echo "sign-bundle.sh: \"$APP\" not found — run 'bun run package' (or 'cd apps/kira-studio && wails3 task darwin:package') first" >&2
  exit 1
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "sign-bundle.sh: codesign is macOS-only; nothing to do on $(uname -s)" >&2
  exit 1
fi

codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "sign-bundle.sh: signed and verified \"$APP\""
