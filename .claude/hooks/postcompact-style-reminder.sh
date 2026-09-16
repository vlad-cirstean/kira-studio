#!/bin/sh
# PostCompact hook: compaction condenses CLAUDE.md down to a one-line gist in the summary, so the
# working agreement's actual rules (communication style, phase process, testing bar, etc.) are gone
# right after. Re-inject the whole file verbatim rather than a hand-picked excerpt, since any
# excerpt goes stale the moment CLAUDE.md changes.
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CLAUDE_MD="$SCRIPT_DIR/CLAUDE.md"

if [ ! -f "$CLAUDE_MD" ]; then
  exit 0
fi

jq -Rs '{hookSpecificOutput: {hookEventName: "PostCompact", additionalContext: ("Full CLAUDE.md, reloaded after compaction (its rules apply to chat replies too, not just docs/commits):\n\n" + .)}}' "$CLAUDE_MD"
