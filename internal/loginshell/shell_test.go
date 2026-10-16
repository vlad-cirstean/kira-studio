package loginshell_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/internal/loginshell"
)

// TestBuildArgv_Golden is the exit-criteria's own golden test: the argv is EXACTLY
// [shell, "-l", "-c", script] in the login-shell branch, and EXACTLY [shell, "-c", script] in the
// /bin/sh fallback branch — scriptText is the literal, unmodified last element in both cases,
// asserted with a script text containing shell metacharacters, quotes, newlines and a NUL-adjacent
// byte sequence, so any hidden concatenation/escaping would visibly corrupt it.
func TestBuildArgv_Golden(t *testing.T) {
	script := "echo \"hi $HOME\" && npm ci; printf 'a\\nb\\tc' | grep -F 'x`y'"

	got := loginshell.BuildArgv("/usr/local/bin/zsh", true, script)
	want := []string{"/usr/local/bin/zsh", "-l", "-c", script}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("login shell argv = %#v, want %#v", got, want)
	}
	if got[len(got)-1] != script {
		t.Fatalf("last argv element = %q, want the exact script text", got[len(got)-1])
	}

	got = loginshell.BuildArgv(loginshell.DefaultShell, false, script)
	want = []string{"/bin/sh", "-c", script}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("/bin/sh argv = %#v, want %#v", got, want)
	}
}

// TestBuildArgv_EmptyScriptIsStillOneElement: an empty script string is still exactly one argv
// element (never omitted, never causing a shorter argv) — `sh -c ""` is a well-defined no-op.
func TestBuildArgv_EmptyScriptIsStillOneElement(t *testing.T) {
	got := loginshell.BuildArgv(loginshell.DefaultShell, false, "")
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

	shell, login := loginshell.ResolveShell(getenv, isExecutable)
	if shell != "/opt/homebrew/bin/fish" || !login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenUnset(t *testing.T) {
	getenv := func(string) string { return "" }
	isExecutable := func(string) bool { return true }
	shell, login := loginshell.ResolveShell(getenv, isExecutable)
	if shell != loginshell.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenRelative(t *testing.T) {
	getenv := func(string) string { return "bash" } // not absolute
	isExecutable := func(string) bool { return true }
	shell, login := loginshell.ResolveShell(getenv, isExecutable)
	if shell != loginshell.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}

func TestResolveShell_FallsBackWhenNotExecutable(t *testing.T) {
	getenv := func(string) string { return "/bin/bash" }
	isExecutable := func(string) bool { return false }
	shell, login := loginshell.ResolveShell(getenv, isExecutable)
	if shell != loginshell.DefaultShell || login {
		t.Fatalf("got shell=%q login=%v", shell, login)
	}
}
