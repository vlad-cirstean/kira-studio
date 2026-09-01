#!/bin/sh
# install-deps.sh — installs both dependency domains this repo has: the Bun workspace (root +
# every apps/*/frontend) and the Go module (the Wails app + every adapter). Kept separate from
# wails-dev-setup.sh, which provisions dev *tooling* (the wails3 CLI, generated bindings) rather
# than dependencies — this is the half a fresh clone needs before that script's checks mean
# anything.
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if ! command -v bun >/dev/null 2>&1; then
  echo "install-deps: 'bun' not found — install it from https://bun.sh" >&2
  exit 1
fi
if ! command -v go >/dev/null 2>&1; then
  echo "install-deps: 'go' not found — install Go first (your OS package manager, or go.dev)" >&2
  exit 1
fi

echo "install-deps: bun install (workspace root + every apps/*/frontend)"
(cd "$ROOT_DIR" && bun install)

echo "install-deps: go mod download"
(cd "$ROOT_DIR" && go mod download)
