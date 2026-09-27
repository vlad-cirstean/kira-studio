package ade

import "strings"

// newCommand is a fresh session's own base launch — the app picks the Claude session id up front
// (§1.4: `--session-id <uuid>`) so no SessionStart round trip is needed to learn it. claudeBin is
// "claude" in production; TrackerDeps.ClaudeBin exists only so a test can point it at an absolute
// path to a fake script, sidestepping PATH resolution entirely (real launches always resolve
// "claude" the same way any other shell command does).
func newCommand(claudeBin, claudeSessionID string) string {
	return claudeBin + " --session-id " + claudeSessionID
}

// resumeCommand picks a previously stopped session back up by its own Claude session id.
func resumeCommand(claudeBin, claudeSessionID string) string {
	return claudeBin + " --resume " + claudeSessionID
}

// quotePOSIX wraps s as one single-quoted POSIX shell word — the command runs as
// `$SHELL -l -i -c <command>` (internal/terminal's own convention), so every literal piece of the
// composed command (the prompt here; hooks.json's own path in agenthooks.shellSingleQuote) must
// survive that one shell parse. Trivial, so hand-rolled rather than a library (CLAUDE.md's own
// bar for when hand-rolling is fine): close the quote, emit an escaped literal quote, reopen it.
// Newlines stay literal inside single quotes, which the shell accepts unchanged.
func quotePOSIX(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
