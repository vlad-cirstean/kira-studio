#!/bin/sh
# pull-test-images.sh — pulls every Testcontainers image through mirror.gcr.io in parallel and
# re-tags it to the plain name (Docker Hub blob CDN is blocked in the sandbox; the mirror is not).
# A failed pull is reported, never fatal: testcontainers pulls that image itself at test time.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MIRROR=mirror.gcr.io

pull_one() {
  _img="$1"
  case "$_img" in
    */*) _mirrored="$MIRROR/$_img" ;;
    *) _mirrored="$MIRROR/library/$_img" ;;
  esac
  if docker image inspect "$_img" >/dev/null 2>&1; then
    echo "present $_img"
  elif docker pull -q "$_mirrored" >/dev/null 2>&1 && docker tag "$_mirrored" "$_img"; then
    echo "pulled  $_img"
  else
    echo "FAILED  $_img (testcontainers will pull it from Docker Hub)"
  fi
}

IMAGES="$(cd "$ROOT_DIR" && go run ./apps/kira-studio/internal/adapters/testsupport/cmd/testimages)
alpine:3.20
bash:5.2"

for _i in $IMAGES; do
  pull_one "$_i" &
done
wait
exit 0
