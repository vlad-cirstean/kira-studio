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

# MCP registration itself is static, committed config now (.mcp.json +
# .claude/settings.json's permissions/hooks) rather than written here, so it
# survives regardless of hook-vs-MCP-bootstrap ordering. This just needs the
# binary on PATH (above) and the index built/kept in sync.
if [ -d ".codegraph" ]; then
  codegraph sync .
else
  codegraph init .
fi

codegraph status .
