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
# P12 round 2 finding #15: the local var is deliberately not named GOBIN — Go's own toolchain
# assigns that name meaning (it overrides `go install`'s target directory), so a caller with GOBIN
# already exported would have it silently rewritten process-wide by this function.
ensure_gopath_on_path() {
  _gopath_bin="$(go env GOPATH)/bin"
  case ":$PATH:" in
    *":$_gopath_bin:"*) ;;
    *) PATH="$PATH:$_gopath_bin" ;;
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

# pull_images <label> <mirror 0|1> <image>... — pulls every image in parallel; returns 1 if any
# failed. Mirror mode pulls mirror.gcr.io/<path> (docs/DEV_ENVIRONMENT.md: Docker Hub blob CDN is
# blocked in the sandbox) and re-tags it to the plain name; an unnamespaced image lives under
# library/ there. Fatal on failure by the callers' choice: a mid-run pull failure reads worse than
# a pre-flight one.
pull_images() {
  _label="$1"
  _mirror="$2"
  shift 2
  [ $# -gt 0 ] || return 0
  _dir="$(mktemp -d)"
  _n=0
  for _img in "$@"; do
    _n=$((_n + 1))
    (
      if [ "$_mirror" = "1" ]; then
        case "$_img" in
          */*) _src="mirror.gcr.io/$_img" ;;
          *) _src="mirror.gcr.io/library/$_img" ;;
        esac
        docker pull -q "$_src" >/dev/null 2>"$_dir/$_n.err" && docker tag "$_src" "$_img" 2>>"$_dir/$_n.err"
      else
        docker pull -q "$_img" >/dev/null 2>"$_dir/$_n.err"
      fi
    ) &
    echo "$! $_img" >>"$_dir/pids"
  done
  _failed=0
  while read -r _pid _img; do
    if wait "$_pid"; then
      echo "$_label: pulled $_img"
    else
      echo "$_label: FAILED to pull $_img" >&2
      _failed=1
    fi
  done <"$_dir/pids"
  rm -rf "$_dir"
  return "$_failed"
}
