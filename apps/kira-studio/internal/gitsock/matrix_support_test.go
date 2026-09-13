package gitsock

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// opRunIgnoringEvents is opRunOK, tolerant of a stray 'evt' frame arriving before op.run's own
// response (requestIgnoringEvents' own reason) -- needed by any matrix test that issues an op.run
// on a connection that may still have an undrained repo.changed queued from an earlier write.
func opRunIgnoringEvents(t *testing.T, c *testClient, repoID string, op gitsession.OpRequest) gitsession.OpResult {
	t.Helper()
	resp := requestIgnoringEvents(t, c, "op.run", gitrpc.OpRunParams{RepoID: repoID, Op: op})
	if resp.T != "res" || resp.OK == nil || !*resp.OK {
		t.Fatalf("op.run: got %+v", resp)
	}
	return unmarshalResult[gitsession.OpResult](t, resp.Result)
}

// Shared support for matrix_test.go's M1-M4 (D2/D15): two paired clients, one or two
// repositories, and the goroutine/process containment checks M3/M6 need. Nothing here is edited by
// any other file in this phase (D15) -- integration_test.go's own harness (newIntegrationServer,
// pairAndReady, openRepoOK, initFixtureRepo, testClient) stays untouched.

// pairTwoClients pairs two fresh clients against server, labeled for legible failure messages.
func pairTwoClients(t *testing.T, server *Server, sockPath string) (a, b *testClient) {
	t.Helper()
	return pairAndReady(t, server, sockPath, "matrix-a"), pairAndReady(t, server, sockPath, "matrix-b")
}

// initTwoFixtureRepos builds two independent, unrelated fixture repositories -- M3's own "two
// different repositories" shape.
func initTwoFixtureRepos(t *testing.T) (repoA, repoB string) {
	t.Helper()
	return initFixtureRepo(t), initFixtureRepo(t)
}

// waitFor polls cond every 5ms until it reports true or timeout elapses, failing the test if it
// never does -- used wherever a matrix test needs to wait for asynchronous teardown (D8) rather
// than assume it has already happened by the time control returns.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatal("condition never became true within the deadline")
	}
}

// assertNoGoroutineGrowth is D10's own scoped containment check, in place of goleak (declined:
// goleak's package-scoped model would sit on top of this package's 70+ existing tests that spawn
// real git/fsnotify/SQLite, needing a hand-maintained ignore list that only rots). It records
// runtime.NumGoroutine(), runs fn n times, and polls for the count to settle back within a small
// margin over a bounded window -- catching a genuine per-iteration leak without false-failing on
// GC/finalizer timing.
func assertNoGoroutineGrowth(t *testing.T, n int, fn func()) {
	t.Helper()
	runtime.GC()
	time.Sleep(20 * time.Millisecond)
	before := runtime.NumGoroutine()

	for i := 0; i < n; i++ {
		fn()
	}

	const margin = 5
	deadline := time.Now().Add(5 * time.Second)
	after := before
	for time.Now().Before(deadline) {
		runtime.GC()
		after = runtime.NumGoroutine()
		if after <= before+margin {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	buf := make([]byte, 1<<20)
	written := runtime.Stack(buf, true)
	t.Fatalf("goroutines grew from %d to %d after %d iterations (margin %d)\n%s", before, after, n, margin, buf[:written])
}

// countGitProcessesUnder counts running `git` processes whose /proc/<pid>/cwd resolves inside dir
// -- F15/D10's Linux-only proxy for "no orphaned git children survive"; skipped with a clear
// message on any other GOOS since only Linux's /proc gives this cheaply.
func countGitProcessesUnder(t *testing.T, dir string) int {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("countGitProcessesUnder: /proc is Linux-only")
	}
	absDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		absDir = dir
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		t.Fatalf("readdir /proc: %v", err)
	}
	count := 0
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil {
			continue // not a pid directory.
		}
		comm, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "comm"))
		if err != nil || strings.TrimSpace(string(comm)) != "git" {
			continue
		}
		cwd, err := os.Readlink(filepath.Join("/proc", entry.Name(), "cwd"))
		if err != nil {
			continue // exited between ReadDir and here -- not a leak, just a race with reaping.
		}
		if cwd == absDir || strings.HasPrefix(cwd, absDir+string(filepath.Separator)) {
			count++
		}
	}
	return count
}
