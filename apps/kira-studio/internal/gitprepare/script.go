package gitprepare

import (
	"os"
	"path/filepath"
)

// DefaultShell is D9/F16's own fallback — used whenever $SHELL is unset, not an absolute path, or
// not resolvable as an executable file. Never given "-l": /bin/sh is not asked to act as a login
// shell (D9's own argv table).
const DefaultShell = "/bin/sh"

// IsExecutableFile reports whether path names a regular (non-directory) file with at least one
// execute bit set — ResolveShell's own "resolvable as executable" test. A missing path, a
// directory, or a non-executable file all answer false, falling through to DefaultShell.
func IsExecutableFile(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

// ResolveShell is D9/D16's own shell-selection table, expressed as pure functions of an injected
// getenv/isExecutable pair so it is fully testable without touching the real environment or
// filesystem: $SHELL is used, with the login-shell flag, when it is set, an ABSOLUTE path (a bare
// command name would need a PATH lookup this app has no business doing on the user's behalf), and
// passes isExecutable; otherwise DefaultShell, with no login-shell flag (F16: a Finder/launchd-
// launched server inherits a minimal environment where $SHELL may be unset entirely or point
// somewhere the process cannot exec — a login shell resolves `npm`/`pnpm`/Homebrew for the common
// case; the documented cost is the profile-sourcing time this trades against the timeout budget).
func ResolveShell(getenv func(string) string, isExecutable func(string) bool) (shell string, loginShell bool) {
	sh := getenv("SHELL")
	if sh != "" && filepath.IsAbs(sh) && isExecutable(sh) {
		return sh, true
	}
	return DefaultShell, false
}

// BuildArgv is D9's own argv table, and the single most safety-critical function in this whole
// phase: scriptText is appended as the LAST element of a slice built from nothing but the shell
// path and string constants that precede it — never Sprintf'd, concatenated with "+", or
// strings.Join'd into anything. This is what makes "the script text travels as one argv element,
// verbatim, character for character" a property the compiler's own composite-literal-plus-append
// shape makes visually obvious, not merely a claim a test asserts (though TestBuildArgv_Golden
// asserts it too, byte for byte, in both shell branches).
func BuildArgv(shell string, loginShell bool, scriptText string) []string {
	if loginShell {
		return []string{shell, "-l", "-c", scriptText}
	}
	return []string{shell, "-c", scriptText}
}

// scrubbedEnvKeys is D12/F12's exact, exhaustive removal list — fourteen keys, REMOVED (never
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
	"GIT_ASKPASS",
	"SSH_ASKPASS",
	"SSH_ASKPASS_REQUIRE",
	"KIRA_ASKPASS_SOCK",
	"KIRA_ASKPASS_TOKEN",
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
// fake slice in every test), scrubbed of scrubbedEnvKeys' fourteen names, with three fixed hygiene
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
		if scrubbed[envKey(kv)] {
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
