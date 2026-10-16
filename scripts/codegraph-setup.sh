#!/bin/sh
# codegraph-setup.sh — installs and initializes CodeGraph (https://github.com/colbymchenry/codegraph)
# so a Claude session spawned into this worktree has an indexed knowledge graph to query from its
# first turn. Run once per fresh worktree, before spawning a Claude session into it — never as a
# SessionStart hook (moved out of one; see docs/DEV_ENVIRONMENT.md's CodeGraph section for why).
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

cd "$ROOT_DIR"

# npm, not the curl|sh installer: the npm registry is reachable under this session's egress policy
# in every environment this has been tested in, while raw.githubusercontent.com is not guaranteed
# to be.
if ! command -v codegraph >/dev/null 2>&1; then
  npm install -g @colbymchenry/codegraph
fi

require_cmd codegraph "npm install failed to put it on PATH"

if [ -d ".codegraph" ]; then
  codegraph sync .
else
  codegraph init .
fi

codegraph status .
