#!/bin/sh
# retry.sh <attempts> <seconds> <command>... — lib.sh's retry, callable from a workflow step (P365).
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
[ $# -ge 3 ] || { echo "usage: $0 <attempts> <seconds> <command>..." >&2; exit 2; }
retry "$@"
