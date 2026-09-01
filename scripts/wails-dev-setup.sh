#!/bin/sh
# wails-dev-setup.sh — wired as `predev` (P57 M7: this is the only build now, so the `:wails`
# suffix retired with the Electron one it used to disambiguate from). `bun run dev` (`bun run
# build && cd apps/kira-studio && wails3 task dev`) is not self-contained: the `wails3` CLI is a Go binary
# bun/npm can't fetch, and the generated bindings `bun run build` needs are gitignored and don't
# exist in a fresh clone. This script checks each of those and does only the ones actually
# missing, so a fresh clone's first `bun run dev` just works and a warm one stays fast. P58f: there
# is no vendored Node runtime or bundled engine to check for any more — every adapter is served
# in-process by native Go.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! command -v go >/dev/null 2>&1; then
  echo "wails-dev-setup: 'go' not found — install Go first (your OS package manager, or go.dev), then re-run" >&2
  exit 1
fi

# Pinned in go.mod, not `@latest`: a stale `@latest` install has resolved to a newer beta
# than the runtime library go.mod pins, silently skewing the bindings generator against it.
PINNED_VERSION="$(grep -m1 'github.com/wailsapp/wails/v3 ' "$ROOT_DIR/go.mod" | awk '{print $2}')"
if [ -z "$PINNED_VERSION" ]; then
  echo "wails-dev-setup: could not read the wails/v3 version from go.mod" >&2
  exit 1
fi

GOBIN="$(go env GOPATH)/bin"
case ":$PATH:" in
  *":$GOBIN:"*) ;;
  *) PATH="$PATH:$GOBIN" ;;
esac
export PATH

INSTALLED_VERSION=""
if command -v wails3 >/dev/null 2>&1; then
  # `wails3 version` writes to stderr, not stdout — confirmed by direct experiment.
  INSTALLED_VERSION="$(wails3 version 2>&1 1>/dev/null | head -1 | tr -d '[:space:]')"
fi

if [ "$INSTALLED_VERSION" != "$PINNED_VERSION" ]; then
  if [ -n "$INSTALLED_VERSION" ]; then
    echo "wails-dev-setup: wails3 $INSTALLED_VERSION is installed but go.mod pins $PINNED_VERSION — reinstalling the pinned version"
  else
    echo "wails-dev-setup: wails3 not found — installing $PINNED_VERSION"
  fi
  if [ "$(uname -s)" = "Linux" ] && ! pkg-config --exists gtk4 webkitgtk-6.0 2>/dev/null; then
    echo "wails-dev-setup: the wails3 CLI needs GTK4/WebKitGTK dev headers to build on Linux (even" >&2
    echo "though the app itself targets macOS) — install them first, then re-run:" >&2
    echo "  sudo apt-get install -y libgtk-4-dev libwebkitgtk-6.0-dev pkg-config" >&2
    exit 1
  fi
  go install "github.com/wailsapp/wails/v3/cmd/wails3@$PINNED_VERSION"
  case ":$PATH:" in
    *":$GOBIN:"*) ;;
    *)
      echo "wails-dev-setup: add this to your shell profile so wails3 stays on PATH:" >&2
      echo "  export PATH=\"\$PATH:$GOBIN\"" >&2
      ;;
  esac
fi

if [ ! -d "$ROOT_DIR/apps/kira-studio/frontend/bindings" ]; then
  echo "wails-dev-setup: generating Wails bindings (apps/kira-studio/frontend/bindings is gitignored)"
  (cd "$ROOT_DIR/apps/kira-studio" && wails3 generate bindings -b -i -ts -names)
fi
