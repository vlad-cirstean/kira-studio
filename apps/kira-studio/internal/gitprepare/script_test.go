package gitprepare_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitprepare"
)

// TestBuildArgv_Golden is the exit-criteria's own golden test: the argv is EXACTLY
// [shell, "-l", "-c", script] in the login-shell branch, and EXACTLY [shell, "-c", script] in the
// /bin/sh fallback branch — scriptText is the literal, unmodified last element in both cases,
// asserted with a script text containing shell metacharacters, quotes, newlines and a NUL-adjacent
// byte sequence, so any hidden concatenation/escaping would visibly corrupt it.
func TestBuildArgv_Golden(t *testing.T) {
	script := "echo \"hi $HOME\" && npm ci; printf 'a\\nb\\tc' | grep -F 'x`y'"

	got := gitprepare.BuildArgv("/usr/local/bin/zsh", true, script)
	want := []string{"/usr/local/bin/zsh", "-l", "-c", script}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("login shell argv = %#v, want %#v", got, want)
	}
	if got[len(got)-1] != script {
		t.Fatalf("last argv element = %q, want the exact script text", got[len(got)-1])
	}

	got = gitprepare.BuildArgv(gitprepare.DefaultShell, false, script)
	want = []string{"/bin/sh", "-c", script}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("/bin/sh argv = %#v, want %#v", got, want)
	}
}

// TestBuildArgv_EmptyScriptIsStillOneElement: an empty script string is still exactly one argv
// element (never omitted, never causing a shorter argv) — `sh -c ""` is a well-defined no-op.
func TestBuildArgv_EmptyScriptIsStillOneElement(t *testing.T) {
	got := gitprepare.BuildArgv(gitprepare.DefaultShell, false, "")
	want := []string{"/bin/sh", "-c", ""}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestResolveShell_UsesLoginShellWhenAbsoluteAndExecutable(t *testing.T) {
	getenv := func(k string) string {
		if k == "SHELL" {
			return "/opt/homebrew/bin/fish"
		}
		return ""
	}
	isExecutable := func(p string) bool { return p == "/opt/homebrew/bin/fish" }

	shell, login := gitprepare.ResolveShell(getenv, isExecutable)
	if shell != "/opt/homebrew/bin/fish" || !login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenUnset(t *testing.T) {
	getenv := func(string) string { return "" }
	isExecutable := func(string) bool { return true }
	shell, login := gitprepare.ResolveShell(getenv, isExecutable)
	if shell != gitprepare.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenRelative(t *testing.T) {
	getenv := func(string) string { return "bash" } // not absolute
	isExecutable := func(string) bool { return true }
	shell, login := gitprepare.ResolveShell(getenv, isExecutable)
	if shell != gitprepare.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenNotExecutable(t *testing.T) {
	getenv := func(string) string { return "/bin/bash" }
	isExecutable := func(string) bool { return false }
	shell, login := gitprepare.ResolveShell(getenv, isExecutable)
	if shell != gitprepare.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

// scrubbedKeys mirrors script.go's own private list for test purposes — kept in sync by
// TestBuildEnv_ScrubsEveryNamedKey enumerating them explicitly (a typo in either place would fail
// the test, not silently pass).
var scrubbedKeysForTest = []string{
	"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM",
	"GIT_ASKPASS", "SSH_ASKPASS", "SSH_ASKPASS_REQUIRE",
	"KIRA_ASKPASS_SOCK", "KIRA_ASKPASS_TOKEN",
}

// TestBuildEnv_ScrubsEveryNamedKey is the exit-criteria's own env-scrub test: a base environment
// containing all fourteen named keys produces a child environment containing NONE of them.
func TestBuildEnv_ScrubsEveryNamedKey(t *testing.T) {
	if len(scrubbedKeysForTest) != 14 {
		t.Fatalf("test's own list has %d keys, want 14", len(scrubbedKeysForTest))
	}
	base := make([]string, 0, len(scrubbedKeysForTest)+2)
	for _, k := range scrubbedKeysForTest {
		base = append(base, k+"=poison")
	}
	base = append(base, "HOME=/home/user", "PATH=/usr/bin:/bin")

	env := gitprepare.BuildEnv(base, gitprepare.Vars{
		WorktreePath: "/repos/wt", RepoRoot: "/repos/wt", RepoCommonDir: "/repos/.git",
	})

	present := make(map[string]bool, len(env))
	for _, kv := range env {
		present[kv] = true
		for _, k := range scrubbedKeysForTest {
			if len(kv) > len(k) && kv[:len(k)+1] == k+"=" {
				t.Fatalf("scrubbed key %q survived into the child env as %q", k, kv)
			}
		}
	}
	if !present["HOME=/home/user"] || !present["PATH=/usr/bin:/bin"] {
		t.Fatalf("an unrelated base env entry was dropped: %v", env)
	}
}

func hasExact(env []string, kv string) bool {
	for _, e := range env {
		if e == kv {
			return true
		}
	}
	return false
}

func TestBuildEnv_AddsHygieneAndKiraVars(t *testing.T) {
	env := gitprepare.BuildEnv(nil, gitprepare.Vars{
		WorktreePath: "/repos/wt", WorktreeBranch: "feature/x", RepoRoot: "/repos/main", RepoCommonDir: "/repos/main/.git",
	})
	for _, want := range []string{
		"GIT_TERMINAL_PROMPT=0", "NO_COLOR=1", "TERM=dumb", "KIRA_PREPARE=1",
		"KIRA_WORKTREE_PATH=/repos/wt", "KIRA_WORKTREE_BRANCH=feature/x",
		"KIRA_REPO_ROOT=/repos/main", "KIRA_REPO_COMMON_DIR=/repos/main/.git",
	} {
		if !hasExact(env, want) {
			t.Fatalf("missing %q in %v", want, env)
		}
	}
}

// TestBuildEnv_OmitsBranchWhenDetached: KIRA_WORKTREE_BRANCH must be ABSENT, not empty, for a
// detached worktree.
func TestBuildEnv_OmitsBranchWhenDetached(t *testing.T) {
	env := gitprepare.BuildEnv(nil, gitprepare.Vars{WorktreePath: "/repos/wt", RepoRoot: "/repos/wt", RepoCommonDir: "/repos/.git"})
	for _, kv := range env {
		if len(kv) >= len("KIRA_WORKTREE_BRANCH=") && kv[:len("KIRA_WORKTREE_BRANCH=")] == "KIRA_WORKTREE_BRANCH=" {
			t.Fatalf("KIRA_WORKTREE_BRANCH must be absent for a detached worktree, got %q", kv)
		}
	}
}

// TestBuildEnv_MaliciousBranchNameStaysOneEnvValue proves F11's own safety claim directly: a branch
// name containing shell metacharacters becomes exactly one environment VALUE — BuildEnv never
// splits, re-quotes, or otherwise treats it as anything but an opaque string appended after "=".
func TestBuildEnv_MaliciousBranchNameStaysOneEnvValue(t *testing.T) {
	evil := "x$(rm -rf /); echo pwned"
	env := gitprepare.BuildEnv(nil, gitprepare.Vars{WorktreePath: "/repos/wt", WorktreeBranch: evil, RepoRoot: "/repos/wt", RepoCommonDir: "/repos/.git"})
	if !hasExact(env, "KIRA_WORKTREE_BRANCH="+evil) {
		t.Fatalf("branch value was not passed through verbatim as one env entry: %v", env)
	}
}
