package ghclient

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestBuildEnv_AppendsHygieneOntoBase(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/kira"}
	got := buildEnv(base)
	want := append(slices.Clone(base), ghHygieneEnv...)
	if !slices.Equal(got, want) {
		t.Fatalf("buildEnv(%v) = %v, want %v", base, got, want)
	}
}

// TestGhHygieneEnv_NeverSetsAGitHubCredential is the exit-criterion regression guard, in code
// rather than only a grep: neither GH_TOKEN nor GITHUB_TOKEN is ever a key this package's own
// hygiene table sets — whatever the calling process's own os.Environ() carries for either name
// passes through buildEnv completely untouched (it's part of `base`, never appended here).
func TestGhHygieneEnv_NeverSetsAGitHubCredential(t *testing.T) {
	for _, kv := range ghHygieneEnv {
		key := strings.SplitN(kv, "=", 2)[0]
		if key == "GH_TOKEN" || key == "GITHUB_TOKEN" {
			t.Fatalf("ghHygieneEnv sets %q — this package must never set a GitHub credential", key)
		}
	}
}

func writeScript(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-gh")
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write fake gh script: %v", err)
	}
	return path
}

// TestExecRunner_Run drives the real execRunner against a fake script standing in for `gh` — never
// a real `gh` binary (F13: not installed in this container) — proving argv/env/exit-code plumbing
// end to end.
func TestExecRunner_Run(t *testing.T) {
	script := writeScript(t, "#!/bin/sh\necho -n \"$1\"\necho -n \"|$GH_PROMPT_DISABLED|$NO_COLOR\" >&2\nexit 3\n")
	r := NewExecRunner()
	res, err := r.Run(context.Background(), script, Spec{Args: []string{"hello"}})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if string(res.Stdout) != "hello" {
		t.Fatalf("Stdout = %q, want %q", res.Stdout, "hello")
	}
	if string(res.Stderr) != "|1|1" {
		t.Fatalf("Stderr = %q, want hygiene env reflected", res.Stderr)
	}
	if res.ExitCode != 3 {
		t.Fatalf("ExitCode = %d, want 3", res.ExitCode)
	}
}

// TestExecRunner_TimeoutKillsProcess proves D2's own bounded-timeout discipline without a real 10s
// wait: a Spec.Timeout shorter than the script's own sleep must make Run return promptly rather
// than block until the sleep finishes.
func TestExecRunner_TimeoutKillsProcess(t *testing.T) {
	script := writeScript(t, "#!/bin/sh\nsleep 30\necho done\n")
	r := NewExecRunner()
	start := time.Now()
	_, err := r.Run(context.Background(), script, Spec{Args: nil, Timeout: 50 * time.Millisecond})
	elapsed := time.Since(start)
	if elapsed > 5*time.Second {
		t.Fatalf("Run took %v, want well under the script's own 30s sleep", elapsed)
	}
	if err == nil {
		t.Fatal("Run returned nil error for a killed/timed-out process, want a non-nil error")
	}
}
