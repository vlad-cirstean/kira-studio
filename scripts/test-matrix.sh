#!/bin/sh
# test-matrix.sh — the on-demand complete auth/config permutation matrix runner (P25 §2.10,
# docs/v1.1/plans/P25-connection-auth-test-matrix.md). Not run as part of `bun run test:go` or
# ci.yml — the same "not run as part of the regular CI/test run" posture db-compat.sh already
# established for exactly this kind of real-container matrix (P16 D6).
#
# Modelled directly on db-compat.sh, which is this repo's own precedent for this problem: for
# each adapter, this runs its package's own KIRA_TEST_MATRIX-gated authmatrix_test.go (§3's
# Case/RunMatrix table) with the env var set, against a real container. Every row runs even when
# an earlier one fails (no `set -e` abort mid-matrix) — a run that dies on the first failing
# adapter is worth much less than one that reports a full result table, the same reasoning
# db-compat.sh's own comment already gives.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
cd "$ROOT_DIR"

ONLY=""
MIRROR=0
NO_PULL=0

usage() {
  echo "usage: $0 [--only <kind>] [--mirror] [--no-pull]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --mirror) MIRROR=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    -h|--help) usage ;;
    *) echo "test-matrix: unrecognized argument '$1'" >&2; usage ;;
  esac
done

# --- the matrix (P25 §2.4-§2.9): kind|go package|image(s) needed --------------------------------
# One row per adapter package's own authmatrix_test.go. Images are this script's own pinned
# defaults (testsupport's own constants) — a compat-matrix cross product (min/max × auth matrix)
# is explicitly out of scope (P25 doesn't ask for it, and db-compat.sh already covers the
# min/max axis on the general-tier suite).
MATRIX="
postgres|./apps/kira-studio/internal/adapters/postgres/...|postgres:17-alpine
mysqlfamily|./apps/kira-studio/internal/adapters/mysqlfamily/...|mariadb:11.4 mysql:8.4
clickhouse|./apps/kira-studio/internal/adapters/clickhouse/...|clickhouse/clickhouse-server:26.3
mongo|./apps/kira-studio/internal/adapters/mongo/...|mongo:8.3
redis|./apps/kira-studio/internal/adapters/redis/...|redis:8.10
kafka|./apps/kira-studio/internal/adapters/kafka/...|confluentinc/cp-kafka:8.0.7
sqs|./apps/kira-studio/internal/adapters/sqs/...|localstack/localstack:4
s3|./apps/kira-studio/internal/adapters/s3/...|localstack/localstack:4
sqlite|./apps/kira-studio/internal/adapters/sqlite/...|
"

OLDIFS="$IFS"
IFS='
'
FILTERED=""
for row in $MATRIX; do
  [ -z "$row" ] && continue
  kind="$(echo "$row" | cut -d'|' -f1)"
  if [ -n "$ONLY" ] && [ "$kind" != "$ONLY" ]; then continue; fi
  FILTERED="$FILTERED$row
"
done
IFS="$OLDIFS"

if [ -z "$FILTERED" ]; then
  echo "test-matrix: no rows matched --only='$ONLY'" >&2
  exit 2
fi

# --- AGENTS.md's mirror.gcr.io workaround: pull the mirrored name, retag it locally -----------
# The rule, identical to db-compat.sh's own: an unnamespaced official image (postgres, mysql,
# mariadb, mongo, redis) lives under library/ on the real registry; an already-namespaced one
# (clickhouse/clickhouse-server, confluentinc/cp-kafka, localstack/localstack) mirrors at the same
# path with no library/ inserted.
mirror_path_for() {
  case "$1" in
    postgres:*|mysql:*|mariadb:*|mongo:*|redis:*) echo "library/$1" ;;
    *) echo "$1" ;;
  esac
}

pull_image() {
  image="$1"
  if [ "$MIRROR" = "1" ]; then
    mirror_path="$(mirror_path_for "$image")"
    echo "test-matrix: pulling mirror.gcr.io/$mirror_path -> $image"
    docker pull "mirror.gcr.io/$mirror_path"
    docker tag "mirror.gcr.io/$mirror_path" "$image"
  else
    echo "test-matrix: pulling $image"
    docker pull "$image"
  fi
}

if [ "$NO_PULL" != "1" ]; then
  IMAGES="$(printf '%s' "$FILTERED" | cut -d'|' -f3 | tr ' ' '\n' | sort -u)"
  IFS='
'
  for image in $IMAGES; do
    [ -z "$image" ] && continue
    pull_image "$image"
  done
  IFS="$OLDIFS"
fi

# --- run every adapter's matrix, recording pass/fail without letting one abort the rest --------
RESULTS=""
FAILED=0

IFS='
'
for row in $FILTERED; do
  [ -z "$row" ] && continue
  IFS="$OLDIFS"
  kind="$(echo "$row" | cut -d'|' -f1)"
  pkg="$(echo "$row" | cut -d'|' -f2)"

  echo ""
  echo "=== test-matrix: $kind ==="
  set +e
  # -count=1 (db-compat.sh's own documented reason, carried over verbatim): go test's result cache
  # keys on env vars a test actually observed, and a skipped run may never read KIRA_TEST_MATRIX at
  # all, so a stale cache entry can report green without running anything.
  KIRA_TEST_MATRIX=1 go test -count=1 -timeout 30m "$pkg"
  status=$?
  set -e

  if [ "$status" = "0" ]; then
    RESULTS="$RESULTS$kind|PASS
"
  else
    RESULTS="$RESULTS$kind|FAIL
"
    FAILED=1
  fi
done
IFS="$OLDIFS"

echo ""
echo "=== test-matrix summary ==="
printf '%-14s %s\n' "KIND" "RESULT"
printf '%s' "$RESULTS" | while IFS='|' read -r kind result; do
  [ -z "$kind" ] && continue
  printf '%-14s %s\n' "$kind" "$result"
done

if [ "$FAILED" = "1" ]; then
  echo "test-matrix: FAILED — see above" >&2
  exit 1
fi

echo "test-matrix: all adapters passed"
