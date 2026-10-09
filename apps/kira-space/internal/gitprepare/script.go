package gitprepare

import "strings"

// scrubbedEnvKeys is D12/F12's exact, exhaustive removal list — eighteen keys plus the GIT_CONFIG_KEY_*/GIT_CONFIG_VALUE_* prefixes, REMOVED (never
// merely overwritten with an empty value, which would still leave the key present for a script
// that checks `[ -n "$GIT_DIR" ]` rather than reading its value) from the inherited environment
// before any KIRA_*/hygiene addition below. Every key here carries either a mis-targeting hazard
// (a GIT_* variable pointing the child's own incidental git invocations at the WRONG repository/
// worktree/config layer — this process's, not necessarily the child's own cwd's) or a credential-
// handle hazard (GIT_ASKPASS/SSH_ASKPASS*/KIRA_ASKPASS_* could hand the script a live prompt-
// interposition channel this app itself uses for real credentials).
var scrubbedEnvKeys = []string{
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

// scrubbedEnvPrefixes covers git's indexed injected-config variables (GIT_CONFIG_KEY_<n>/_VALUE_<n>).
var scrubbedEnvPrefixes = []string{"GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"}

func scrubbedEnvKey(k string) bool {
	for _, p := range scrubbedEnvPrefixes {
		if strings.HasPrefix(k, p) {
			return true
		}
	}
	return false
}

// Vars is D9's own app-data-via-environment table — the ONLY channel app-supplied values reach the
// script through (never the command string itself). WorktreeBranch is "" for a detached worktree,
// in which case KIRA_WORKTREE_BRANCH is omitted from the environment entirely (never set to the
// empty string, which a script's own `[ -n "$KIRA_WORKTREE_BRANCH" ]` check would then need to
// special-case rather than simply not seeing the key at all).
type Vars struct {
	WorktreePath   string
	WorktreeBranch string
	RepoRoot       string
	RepoCommonDir  string
}

// envKey returns the portion of one os.Environ()-shaped "KEY=value" entry before the first "=".
func envKey(kv string) string {
	for i := 0; i < len(kv); i++ {
		if kv[i] == '=' {
			return kv[:i]
		}
	}
	return kv
}

// BuildEnv builds the CHILD'S ENTIRE environment (D12/F12) — base is normally os.Environ() (a
// fake slice in every test), scrubbed of scrubbedEnvKeys' names, with three fixed hygiene
// values and the five KIRA_* values (D9) appended after. Later entries winning over earlier
// duplicates (Go's os/exec, and every real exec(3), both honour last-one-wins for a repeated key)
// is exactly why the scrub happens FIRST and unconditionally: a base environment that happens to
// already define GIT_TERMINAL_PROMPT or NO_COLOR is still overridden the same way it would be if
// scrubbed and re-added in one pass, but a scrubbed key is well and truly gone, not shadowed.
func BuildEnv(base []string, vars Vars) []string {
	scrubbed := make(map[string]bool, len(scrubbedEnvKeys))
	for _, k := range scrubbedEnvKeys {
		scrubbed[k] = true
	}

	env := make([]string, 0, len(base)+9)
	for _, kv := range base {
		if k := envKey(kv); scrubbed[k] || scrubbedEnvKey(k) {
			continue
		}
		env = append(env, kv)
	}

	env = append(env,
		"GIT_TERMINAL_PROMPT=0",
		"NO_COLOR=1",
		"TERM=dumb",
		"KIRA_PREPARE=1",
		"KIRA_WORKTREE_PATH="+vars.WorktreePath,
		"KIRA_REPO_ROOT="+vars.RepoRoot,
		"KIRA_REPO_COMMON_DIR="+vars.RepoCommonDir,
	)
	if vars.WorktreeBranch != "" {
		env = append(env, "KIRA_WORKTREE_BRANCH="+vars.WorktreeBranch)
	}
	return env
}
