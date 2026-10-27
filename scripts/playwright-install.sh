#!/bin/sh
# playwright-install.sh <browser>... — Playwright install with system libraries, safe to retry (P372).
# A prior attempt killed mid-unpack leaves dpkg interrupted; repair it so the retry can run.
set -eu
sudo dpkg --configure -a
exec bunx playwright install --with-deps "$@"
