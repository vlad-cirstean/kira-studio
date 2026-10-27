#!/bin/sh
# ci-apt-install.sh <package>... — apt install for Linux CI runners, bounded and retried (P365).
# A slow mirror trickles data, so no apt timeout fires (PR #13: libwebkitgtk hung 865 s).
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
[ $# -ge 1 ] || { echo "usage: $0 <package>..." >&2; exit 2; }

# A conf file, not -o flags: Playwright's own apt-get calls read it too.
printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-ci-retries >/dev/null

MIRRORS=/etc/apt/apt-mirrors.txt
round=1
while :; do
  if retry 3 45 sudo apt-get update &&
    sudo timeout --kill-after=10 150 apt-get install -y "$@"; then
    exit 0
  fi
  [ "$round" -lt 2 ] || { echo "ci-apt-install: failed after $round rounds" >&2; exit 1; }
  # The runner lists mirrors in order (Azure first); a retry against the slow one stays slow.
  # The edit persists, so a later Playwright apt step uses the next mirror too.
  if [ -f "$MIRRORS" ] && [ "$(grep -c . "$MIRRORS")" -gt 1 ]; then
    echo "ci-apt-install: dropping mirror: $(head -n 1 "$MIRRORS")" >&2
    sudo sed -i 1d "$MIRRORS"
  fi
  sleep 10
  round=$((round + 1))
done
