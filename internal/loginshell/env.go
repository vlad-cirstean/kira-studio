package loginshell

import "strings"

// gitEnvKeys is D12/F12's exact, exhaustive removal list — eighteen keys plus the GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_* prefixes, REMOVED (never
// merely overwritten with an empty value, which would still leave the key present for a script
// that checks `[ -n "$GIT_DIR" ]` rather than reading its value) from the inherited environment
// before any KIRA_*/hygiene addition below. Every key here carries either a mis-targeting hazard
// (a GIT_* variable pointing the child's own incidental git invocations at the WRONG repository/
// worktree/config layer — this process's, not necessarily the child's own cwd's) or a credential-
// handle hazard (GIT_ASKPASS/SSH_ASKPASS*/KIRA_ASKPASS_* could hand the script a live prompt-
// interposition channel this app itself uses for real credentials).
var gitEnvKeys = []string{
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_SYSTEM",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_NAMESPACE",
	"GIT_SSH_COMMAND",
	"GIT_ASKPASS",
	"SSH_ASKPASS",
	"SSH_ASKPASS_REQUIRE",
	"KIRA_ASKPASS_SOCK",
	"KIRA_ASKPASS_TOKEN",
}

// gitEnvPrefixes covers git's indexed injected-config variables (GIT_CONFIG_KEY_<n>/_VALUE_<n>).
var gitEnvPrefixes = []string{"GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"}

func gitEnvKey(k string) bool {
	for _, p := range gitEnvPrefixes {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// ScrubGitEnv returns environ without the git and askpass variables that would mis-target or
// hijack a child's own git calls.
func ScrubGitEnv(environ []string) []string {
	scrubbed := make(map[string]bool, len(gitEnvKeys))
	for _, k := range gitEnvKeys {
		scrubbed[k] = true
	}
	out := make([]string, 0, len(environ))
	for _, kv := range environ {
		k, _, _ := strings.Cut(kv, "=")
		if scrubbed[k] || gitEnvKey(k) {
			continue
		}
		out = append(out, kv)
	}
	return out
}
