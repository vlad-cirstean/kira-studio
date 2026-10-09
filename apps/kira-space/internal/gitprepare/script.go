package gitprepare

import "github.com/kirathecat/kira-studio/internal/loginshell"

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

// BuildEnv builds the CHILD'S ENTIRE environment (D12/F12) — base is normally os.Environ() (a
// fake slice in every test), scrubbed of loginshell.ScrubGitEnv's names, with three fixed hygiene
// values and the five KIRA_* values (D9) appended after. Later entries winning over earlier
// duplicates (Go's os/exec, and every real exec(3), both honour last-one-wins for a repeated key)
// is exactly why the scrub happens FIRST and unconditionally: a base environment that happens to
// already define GIT_TERMINAL_PROMPT or NO_COLOR is still overridden the same way it would be if
// scrubbed and re-added in one pass, but a scrubbed key is well and truly gone, not shadowed.
func BuildEnv(base []string, vars Vars) []string {
	env := append(make([]string, 0, len(base)+9), loginshell.ScrubGitEnv(base)...)

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
