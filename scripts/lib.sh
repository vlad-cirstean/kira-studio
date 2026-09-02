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

# Prints the SHA-256 of a file — `sha256sum` (Linux) and `shasum -a 256` (macOS, this app's only
# supported platform, which has no `sha256sum` at all) are the two implementations that actually
# exist here; `command -v` picks whichever is present rather than assuming one.
sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "$(basename -- "$0"): neither sha256sum nor shasum found — install one, then re-run" >&2
    exit 1
  fi
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
