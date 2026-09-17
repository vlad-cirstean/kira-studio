package agenthooks

import (
	"fmt"
	"strings"
)

// buildShim renders the shim script every hook event runs (§5.2) — curlPath is resolved once by
// New (exec.LookPath("curl")) and written in verbatim, so a PATH difference inside the launched
// session can never change which binary runs. Always exits 0: a non-zero exit from a PreToolUse
// hook blocks the agent's own tool call, and this shim only reports. stderr is discarded for the
// same reason — a stale socket must not print into the agent's transcript on every tool call.
//
// Refuses — a hard error, not a best-effort escape — curlPath or sockPath containing a double
// quote or a newline, gitaskpass.buildShim's own precedent for an argv element that cannot be
// double-quoted safely. Neither an exec.LookPath result nor a mkdtemp-derived path ever contains
// either; the check exists so a future change here cannot silently produce a broken command.
func buildShim(curlPath, sockPath string) (string, error) {
	for _, arg := range []string{curlPath, sockPath} {
		if strings.ContainsAny(arg, "\"\n") {
			return "", fmt.Errorf("agenthooks: shim argument cannot be safely quoted: %q", arg)
		}
	}
	return fmt.Sprintf(`#!/bin/sh
# Kira Studio agent hook (P86). Always exits 0: a non-zero exit from a PreToolUse hook blocks the
# agent's own tool call, and this shim only reports. stderr is discarded for the same reason — a
# stale socket must not print into the agent's transcript on every tool call.
exec 2>/dev/null
"%s" --silent --max-time 2 --output /dev/null \
  --unix-socket "%s" \
  --header "Authorization: Bearer $KIRA_AGENT_HOOK_TOKEN" \
  --header "X-Kira-Terminal: $KIRA_TERMINAL_ID" \
  --header "Content-Type: application/json" \
  --data-binary @- \
  http://localhost/hook
exit 0
`, curlPath, sockPath), nil
}
