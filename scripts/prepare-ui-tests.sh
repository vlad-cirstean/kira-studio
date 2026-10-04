#!/bin/sh
# prepare-ui-tests.sh — fetches the Playwright webkit browser plus the exact system packages it
# needs, so `bun run test:ui:*` works in a fresh worktree/container (see docs/DEV_ENVIRONMENT.md,
# "Playwright UI tier"). Chromium is pre-configured; this never touches it. Never runs
# `playwright install-deps` (pulls far more than webkit needs). Idempotent. Skip: KIRA_SKIP_WEBKIT=1.
# Failure (offline, apt error) warns with the manual command and still exits 0.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

WEBKIT_PKGS="libevent-2.1-7t64 libgstreamer-plugins-bad1.0-0 libflite1 gstreamer1.0-libav libavif16"

if [ "${KIRA_SKIP_WEBKIT:-}" = "1" ]; then
  echo "prepare-ui-tests: KIRA_SKIP_WEBKIT=1, skipping"
  exit 0
fi

warn() {
  echo "prepare-ui-tests: WARNING: $1" >&2
  echo "prepare-ui-tests: fix manually (from repo root):" >&2
  echo "  sudo apt-get update && sudo apt-get install -y --no-install-recommends $WEBKIT_PKGS" >&2
  echo "  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD= bunx playwright install webkit" >&2
  exit 0
}

# The revision dir is pinned by the repo's own @playwright/test, so ask it rather than glob.
have_browser() {
  _loc="$(cd "$ROOT_DIR" && bunx playwright install --dry-run webkit 2>/dev/null |
    awk '/Install location:/ {print $3; exit}')"
  [ -n "$_loc" ] && [ -d "$_loc" ]
}

# ---- system packages (Debian/Ubuntu only) --------------------------------------------------------
MISSING=""
if [ "$(uname -s)" = "Linux" ] && command -v dpkg >/dev/null 2>&1; then
  for _p in $WEBKIT_PKGS; do
    dpkg -s "$_p" >/dev/null 2>&1 || MISSING="$MISSING $_p"
  done
fi

if [ -n "$MISSING" ]; then
  echo "prepare-ui-tests: installing webkit system packages:$MISSING"
  SUDO=""
  [ "$(id -u)" -eq 0 ] || SUDO="sudo"
  # $MISSING is deliberately word-split into package names.
  # shellcheck disable=SC2086
  { $SUDO apt-get update -qq && $SUDO apt-get install -y --no-install-recommends $MISSING; } ||
    warn "apt-get failed installing:$MISSING"
else
  echo "prepare-ui-tests: webkit system packages already present"
fi

# ---- browser -------------------------------------------------------------------------------------
if have_browser; then
  echo "prepare-ui-tests: playwright webkit already present, skipping"
else
  echo "prepare-ui-tests: bunx playwright install webkit"
  # Env may set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 for chromium; override for this explicit install.
  (cd "$ROOT_DIR" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 bunx playwright install webkit) ||
    warn "playwright install webkit failed"
fi

echo "prepare-ui-tests: done"
