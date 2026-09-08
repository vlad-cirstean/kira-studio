package gitsession

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// §8.1(e)'s own TestIntegration_AutoFetchNeverPrompts, at the package that can actually drive it
// without waiting out a real one-minute timer (D23's own interval unit): autoFetchTick is called
// directly against a REAL git repository and a REAL HTTP 401 stand-in (D24, matching gitsock's own
// credential-relay fixture) — the tick's own conn is always nil, so "never prompts" is checked by
// the tick simply completing at all (a nil Conn's Prompter would have nothing to relay to) rather
// than by asserting the absence of an event on a connection that was never given one.

func newDenyingHTTPServerForAutoFetch(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("WWW-Authenticate", `Basic realm="test"`)
		w.WriteHeader(http.StatusUnauthorized)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return fmt.Sprintf("http://%s/repo.git", ln.Addr().String())
}

func runAutoFetchGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func TestAutoFetch_NeverPromptsAndDisablesAfterAuthFailure(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatalf("LookPath: %v", err)
	}

	url := newDenyingHTTPServerForAutoFetch(t)
	dir := t.TempDir()
	runAutoFetchGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runAutoFetchGit(t, dir, "add", "f.txt")
	runAutoFetchGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")
	runAutoFetchGit(t, dir, "remote", "add", "origin", url)

	runner := gitclient.NewExecRunner()
	reg := NewRegistry(runner)
	// An arbitrary positive interval — irrelevant here since autoFetchTick is called directly
	// rather than waiting on the real (one-minute-granularity) timer newRepoEntry also arms.
	reg.Settings = func() ([]string, int, string) { return nil, 5, "" }

	entry, release, err := reg.Acquire(context.Background(), gitPath, dir)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	defer release()

	done := make(chan struct{})
	go func() {
		entry.autoFetchTick()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("autoFetchTick hung — a background fetch against an auth-requiring remote must never block on a credential prompt it has no connection to relay to")
	}

	entry.autoFetch.mu.Lock()
	disabled := entry.autoFetch.disabled
	entry.autoFetch.mu.Unlock()
	if !disabled {
		t.Fatal("auto-fetch must disable itself after a real failure (AuthFailed)")
	}
}
