#!/bin/sh
# P94: build golangci-lint from source against THIS repo's Go toolchain.
# A prebuilt release binary is built with an older Go and refuses go.mod's `go 1.27.3`
# (plan §3). GOTOOLCHAIN must be pinned: `go install pkg@version` ignores the current
# module, so `auto` picks golangci-lint's own minimum (go1.26), not ours.
set -e
VERSION=v2.15.0
GOVERSION=go1.27.3
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
BIN="$(go env GOPATH)/bin/golangci-lint"

if [ -x "$BIN" ] && "$BIN" --version 2>/dev/null | grep -q "version ${VERSION#v} built with $GOVERSION"; then
  exit 0
fi
retry 3 0 env GOTOOLCHAIN=$GOVERSION go install "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$VERSION"
