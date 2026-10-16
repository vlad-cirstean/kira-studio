package claudeheadless

import "strings"

// inheritedSessionEnv would leak the calling Claude Code session's context into the child or nest
// it. Auth and provider variables are deliberately kept: an allowlist would silently break
// Bedrock/Vertex/proxy setups.
var inheritedSessionEnv = []string{
	"CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD", "CLAUDE_ADDITIONAL_DIRECTORIES", "CLAUDE_PID",
	"CLAUDE_CODE_SSE_PORT",
}

// ScrubSessionEnv drops the variables that tie a child to the Claude Code session running this
// process.
func ScrubSessionEnv(environ []string) []string {
	out := make([]string, 0, len(environ))
	for _, kv := range environ {
		name, _, _ := strings.Cut(kv, "=")
		drop := false
		for _, d := range inheritedSessionEnv {
			if name == d {
				drop = true
				break
			}
		}
		if !drop {
			out = append(out, kv)
		}
	}
	return out
}
