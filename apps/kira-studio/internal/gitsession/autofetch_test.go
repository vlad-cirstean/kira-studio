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
	t.Parallel()
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

// TestAutoFetch_ZeroIntervalPausesWithoutPermanentlyDisabling is G30 round-1 functional-
// correctness review finding #8's own proof: before this fix, autoFetchTick treated a user-set
// interval of zero identically to a genuine fetch failure — both called disableAutoFetch, whose
// `disabled` flag is meant as a PERMANENT, for-the-entry's-whole-life kill switch reserved for a
// real failure (TestAutoFetch_NeverPromptsAndDisablesAfterAuthFailure above). That conflation
// meant turning fetch.autoInterval to 0 and back to a positive value again left auto-fetch off
// forever, silently, since startAutoFetch's own `disabled` guard never distinguished "the user
// turned this off" from "this entry is broken".
func TestAutoFetch_ZeroIntervalPausesWithoutPermanentlyDisabling(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatalf("LookPath: %v", err)
	}

	dir := t.TempDir()
	runAutoFetchGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runAutoFetchGit(t, dir, "add", "f.txt")
	runAutoFetchGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")

	runner := gitclient.NewExecRunner()
	reg := NewRegistry(runner)
	// newRepoEntry captures reg.Settings by value at Acquire time (the func value present at that
	// call, not a live reference to the reg.Settings field) — so, unlike reassigning reg.Settings
	// itself, mutating a variable the closure reads from DOES reach every later entry.settings()
	// call, the same way a real settings change reaches autoFetchTick's own fresh re-read.
	currentMinutes := 5
	reg.Settings = func() ([]string, int, string) { return nil, currentMinutes, "" }

	entry, release, err := reg.Acquire(context.Background(), gitPath, dir)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	defer release()

	// The user turns auto-fetch off. The real timer armed above is never awaited — autoFetchTick
	// is invoked directly instead, simulating "the armed timer's own tick landed after the
	// setting changed", the same shortcut TestAutoFetch_NeverPromptsAndDisablesAfterAuthFailure
	// already takes to avoid a real one-minute-granularity wait.
	currentMinutes = 0
	entry.autoFetchTick()

	entry.autoFetch.mu.Lock()
	disabledAfterZero := entry.autoFetch.disabled
	timerAfterZero := entry.autoFetch.timer
	entry.autoFetch.mu.Unlock()
	if disabledAfterZero {
		t.Fatal("a user-set interval of zero must not trip the permanent disabled flag")
	}
	if timerAfterZero != nil {
		t.Fatal("a user-set interval of zero must clear the timer, not leave a stale one armed")
	}

	// The user turns auto-fetch back on — EnsureAutoFetch is the real off→on re-arm path
	// (D5's own precedent, invoked from Conn.Open in production).
	currentMinutes = 5
	entry.EnsureAutoFetch()

	entry.autoFetch.mu.Lock()
	timerAfterReenable := entry.autoFetch.timer
	entry.autoFetch.mu.Unlock()
	if timerAfterReenable == nil {
		t.Fatal("auto-fetch must be able to re-arm once the interval is positive again — it must never stay off forever just because it was off once")
	}
}

// TestRegistry_ReconcileAutoFetch_RearmsEveryPausedEntry is G31 round-2 functional-correctness
// review, finding #8: EnsureAutoFetch's own off→on re-arm (proven per-entry above) had exactly
// one caller, Conn.Open — nothing called it when fetch.autoInterval changed for a repository
// that was already open, since that instance-wide setting is written from Kira Studio's own
// settings pane (bridge/settings.go), a path gitsession cannot see. ReconcileAutoFetch is the
// seam that lets bridge/settings.go's SettingsService.Set reach every already-open entry after
// such a write, without either package needing to know about a specific repository. This proves
// it fans out to ALL currently held entries, not just one.
func TestRegistry_ReconcileAutoFetch_RearmsEveryPausedEntry(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Fatalf("LookPath: %v", err)
	}

	initAutoFetchRepo := func(t *testing.T) string {
		t.Helper()
		dir := t.TempDir()
		runAutoFetchGit(t, dir, "init", "-q", "-b", "main")
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		runAutoFetchGit(t, dir, "add", "f.txt")
		runAutoFetchGit(t, dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "base")
		return dir
	}
	dirA := initAutoFetchRepo(t)
	dirB := initAutoFetchRepo(t)

	runner := gitclient.NewExecRunner()
	reg := NewRegistry(runner)
	currentMinutes := 5
	reg.Settings = func() ([]string, int, string) { return nil, currentMinutes, "" }

	entryA, releaseA, err := reg.Acquire(context.Background(), gitPath, dirA)
	if err != nil {
		t.Fatalf("Acquire A: %v", err)
	}
	defer releaseA()
	entryB, releaseB, err := reg.Acquire(context.Background(), gitPath, dirB)
	if err != nil {
		t.Fatalf("Acquire B: %v", err)
	}
	defer releaseB()

	// Both pause, as if the user had just set fetch.autoInterval to 0.
	currentMinutes = 0
	entryA.autoFetchTick()
	entryB.autoFetchTick()
	for name, e := range map[string]*RepoEntry{"A": entryA, "B": entryB} {
		e.autoFetch.mu.Lock()
		timer := e.autoFetch.timer
		e.autoFetch.mu.Unlock()
		if timer != nil {
			t.Fatalf("entry %s: expected a cleared timer after pausing, got one still armed", name)
		}
	}

	// The user turns fetch.autoInterval back on — ReconcileAutoFetch is what
	// bridge/settings.go's SettingsService.Set calls in production.
	currentMinutes = 5
	reg.ReconcileAutoFetch()

	for name, e := range map[string]*RepoEntry{"A": entryA, "B": entryB} {
		e.autoFetch.mu.Lock()
		timer := e.autoFetch.timer
		e.autoFetch.mu.Unlock()
		if timer == nil {
			t.Fatalf("entry %s: ReconcileAutoFetch must re-arm every open entry, not just one", name)
		}
	}
}
