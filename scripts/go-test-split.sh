#!/bin/sh
# go-test-split.sh <containers|rest> [go test args...] — runs half of `go test ./...`.
# Load balancing only, never a coverage filter: a package not matching the regex lands in `rest`.
set -eu

PATTERN='/internal/adapters/|/internal/ipcfixture|/flows/dockerflow|/flows/dbflow'

case "${1:-}" in
  containers) FILTER="-E" ;;
  rest) FILTER="-vE" ;;
  *)
    echo "usage: go-test-split.sh <containers|rest> [go test args...]" >&2
    exit 2
    ;;
esac
CMD="$1"
shift

if [ "$CMD" = containers ]; then
  echo "go-test-split: docker kernel $(docker info --format '{{.KernelVersion}}' 2>/dev/null || echo unknown)"
fi

PKGS="$(go list ./... | grep "$FILTER" "$PATTERN")"
# $PKGS is deliberately word-split into package paths.
# shellcheck disable=SC2086
exec go test "$@" $PKGS
