#!/bin/bash
# Installs and initializes CodeGraph (https://github.com/colbymchenry/codegraph)
# so Claude Code has an indexed knowledge graph of this repo to query.
set -euo pipefail

# Only needed for Claude Code on the web / remote sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Installed via npm rather than the curl|sh installer: the npm registry is
# reachable under this session's egress policy in all the environments this
# hook has been tested in, while raw.githubusercontent.com is not guaranteed
# to be.
if ! command -v codegraph >/dev/null 2>&1; then
  npm install -g @colbymchenry/codegraph
fi

if ! command -v codegraph >/dev/null 2>&1; then
  echo "codegraph: install failed, CLI not found on PATH" >&2
  exit 1
fi

# Wires codegraph's MCP server into Claude Code's config and builds the graph
# for this repo, non-interactively. --init is skipped on repeat runs since a
# graph already exists; `sync` picks up anything that changed since last time.
if [ -d ".codegraph" ]; then
  codegraph install --yes --target=claude
  codegraph sync .
else
  codegraph install --yes --target=claude --init
fi

codegraph status .
