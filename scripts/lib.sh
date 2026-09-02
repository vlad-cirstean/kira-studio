# lib.sh — sourced by every other script in this directory, never executed on its own (P20 D6).
# Collects what four of those scripts each computed the same way, and two needed and didn't have
# (P20 F14): the repo root, a command-exists preflight, the `$(go env GOPATH)/bin` bootstrap
# (P20 F15), and the two `go.mod` reads `scripts/setup.sh` needs to install the right `wails3`.
#
# `$0` is the *sourcing* script's own path — this file only ever runs `.`-sourced — and every
# caller lives directly in this directory, so `dirname "$0"/..` is the repo root exactly as each
# copy computed it inline before.
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

# require_cmd <command> <install hint>
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$(basename -- "$0"): '$1' not found — $2" >&2
    exit 1
  fi
}

# Puts the Go toolchain's install bin dir on PATH for the rest of this process, so a `go install`ed
# CLI (wails3) is callable without depending on the invoking shell's own profile.
ensure_gopath_on_path() {
  GOBIN="$(go env GOPATH)/bin"
  case ":$PATH:" in
    *":$GOBIN:"*) ;;
    *) PATH="$PATH:$GOBIN" ;;
  esac
  export PATH
}

# The github.com/wailsapp/wails/v3 version go.mod pins. Pinned, not `@latest`: a stale `@latest`
# install has resolved to a newer beta than the runtime library go.mod pins, silently skewing the
# bindings generator against it.
pinned_wails_version() {
  grep -m1 'github.com/wailsapp/wails/v3 ' "$ROOT_DIR/go.mod" | awk '{print $2}'
}

# go.mod's own `go` directive (e.g. "1.27.0") — the toolchain `wails3` must be built with (P20 F7):
# `GOTOOLCHAIN=auto go install` picks the toolchain from the *target module's* own directive, not
# this repo's, so an unpinned install silently degrades the bindings generator's type-checker.
go_directive() {
  awk '/^go /{print $2; exit}' "$ROOT_DIR/go.mod"
}
