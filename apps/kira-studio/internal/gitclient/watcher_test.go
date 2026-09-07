package gitclient

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"
)

// --- classify: the ordered-rule table, against both a same-dir and a linked-worktree summary ----

func TestClassify(t *testing.T) {
	main := RepoSummary{CommonDir: "/repo/.git", GitDir: "/repo/.git"}
	linked := RepoSummary{CommonDir: "/repo/.git", GitDir: "/repo/.git/worktrees/feature"}

	cases := []struct {
		name    string
		path    string
		wantSig Signal
		wantOK  bool
	}{
		{"loose ref", "/repo/.git/refs/heads/main", SignalRefsChanged, true},
		{"loose ref, nested namespace", "/repo/.git/refs/heads/feature/x", SignalRefsChanged, true},
		{"loose ref, in-flight write", "/repo/.git/refs/heads/main.lock", SignalRefsChanged, true},
		{"packed-refs", "/repo/.git/packed-refs", SignalRefsChanged, true},
		{"HEAD", "/repo/.git/HEAD", SignalRefsChanged, true},
		{"MERGE_HEAD", "/repo/.git/MERGE_HEAD", SignalRefsChanged, true},
		{"sequencer dir itself", "/repo/.git/sequencer", SignalRefsChanged, true},
		{"index", "/repo/.git/index", SignalWorktreeChanged, true},
		{"a file inside sequencer, not watched at that depth", "/repo/.git/sequencer/todo", "", false},
		{"a loose object", "/repo/.git/objects/ab/cdef0123456789", "", false},
		{"COMMIT_EDITMSG", "/repo/.git/COMMIT_EDITMSG", "", false},
	}
	for _, c := range cases {
		t.Run("main/"+c.name, func(t *testing.T) {
			sig, ok := classify(main, c.path)
			if ok != c.wantOK || (ok && sig != c.wantSig) {
				t.Errorf("classify(main, %q) = (%q, %v), want (%q, %v)", c.path, sig, ok, c.wantSig, c.wantOK)
			}
		})
	}

	// A linked worktree's own HEAD/MERGE_HEAD/index live under its own gitDir, not commonDir.
	linkedCases := []struct {
		name    string
		path    string
		wantSig Signal
		wantOK  bool
	}{
		{"linked worktree HEAD", "/repo/.git/worktrees/feature/HEAD", SignalRefsChanged, true},
		{"linked worktree MERGE_HEAD", "/repo/.git/worktrees/feature/MERGE_HEAD", SignalRefsChanged, true},
		{"linked worktree index", "/repo/.git/worktrees/feature/index", SignalWorktreeChanged, true},
		{"shared packed-refs still matches via commonDir", "/repo/.git/packed-refs", SignalRefsChanged, true},
		{"shared loose ref still matches via commonDir/refs", "/repo/.git/refs/heads/main", SignalRefsChanged, true},
	}
	for _, c := range linkedCases {
		t.Run("linked/"+c.name, func(t *testing.T) {
			sig, ok := classify(linked, c.path)
			if ok != c.wantOK || (ok && sig != c.wantSig) {
				t.Errorf("classify(linked, %q) = (%q, %v), want (%q, %v)", c.path, sig, ok, c.wantSig, c.wantOK)
			}
		})
	}
}

func TestStripLockSuffix(t *testing.T) {
	if got := stripLockSuffix("main.lock"); got != "main" {
		t.Errorf("stripLockSuffix(main.lock) = %q, want main", got)
	}
	if got := stripLockSuffix("main"); got != "main" {
		t.Errorf("stripLockSuffix(main) = %q, want main (no suffix to strip)", got)
	}
}

// --- RepoWatcher against a real repository ------------------------------------------------------

// awaitSignal reads from ch until it sees want or the generous timeout elapses, tolerating other
// signals arriving first (a commit can plausibly touch more than one watched path).
func awaitSignal(t *testing.T, ch <-chan Signal, want Signal) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case sig := <-ch:
			if sig == want {
				return
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %s", want)
		}
	}
}

func newWatcherFixture(t *testing.T) (dir string, summary RepoSummary, w *RepoWatcher) {
	t.Helper()
	dir = initFixtureRepo(t)
	gitPath := requireRealGit(t)
	summary, err := Identify(context.Background(), NewExecRunner(), gitPath, dir)
	if err != nil {
		t.Fatalf("identify: %v", err)
	}
	w, err = NewRepoWatcher(summary)
	if err != nil {
		t.Fatalf("NewRepoWatcher: %v", err)
	}
	t.Cleanup(func() { _ = w.Close() })
	return dir, summary, w
}

func TestRepoWatcher_CommitProducesRefsChanged(t *testing.T) {
	dir, _, w := newWatcherFixture(t)
	runGit(t, dir, "commit", "--allow-empty", "-q", "-m", "second")
	awaitSignal(t, w.Signals(), SignalRefsChanged)
}

func TestRepoWatcher_AddProducesWorktreeChanged(t *testing.T) {
	dir, _, w := newWatcherFixture(t)
	if err := os.WriteFile(filepath.Join(dir, "new-file.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGit(t, dir, "add", "new-file.txt")
	awaitSignal(t, w.Signals(), SignalWorktreeChanged)
}

// TestRepoWatcher_BurstCoalesces proves D11's coalescing: a burst of N ref-creating commands
// produces far fewer than N signals — the honest assertion, not an exact count (AGENTS.md's own
// note on timing assertions this container cannot make honestly).
func TestRepoWatcher_BurstCoalesces(t *testing.T) {
	dir, _, w := newWatcherFixture(t)
	const n = 20
	for i := 0; i < n; i++ {
		runGit(t, dir, "branch", "burst-"+strconv.Itoa(i))
	}

	got := 0
	deadline := time.After(3 * time.Second)
loop:
	for {
		select {
		case <-w.Signals():
			got++
		case <-deadline:
			break loop
		}
	}
	if got == 0 {
		t.Fatal("no signal arrived for a burst of 20 branch creations")
	}
	if got >= n {
		t.Fatalf("got %d signals for a burst of %d writes, want far fewer (coalesced)", got, n)
	}
}

// TestRepoWatcher_NewRefNamespaceSeenOnSecondUpdateToo is D10's own proof: a branch under a
// brand-new refs/heads/<namespace>/ directory must be seen — and, critically, so must a SECOND
// update to it, which only works if the watcher actually added the new directory to its watch set
// rather than merely happening to observe the first event from a parent watch.
func TestRepoWatcher_NewRefNamespaceSeenOnSecondUpdateToo(t *testing.T) {
	dir, _, w := newWatcherFixture(t)
	runGit(t, dir, "branch", "feature/new")
	awaitSignal(t, w.Signals(), SignalRefsChanged)

	// Drain any immediately-following coalesced signal before the second update, so the next
	// awaitSignal genuinely observes a fresh firing.
	drainDeadline := time.After(300 * time.Millisecond)
drain:
	for {
		select {
		case <-w.Signals():
		case <-drainDeadline:
			break drain
		}
	}

	runGit(t, dir, "branch", "-f", "feature/new", "HEAD")
	awaitSignal(t, w.Signals(), SignalRefsChanged)
}

func TestRepoWatcher_Close_StopsSignals(t *testing.T) {
	_, _, w := newWatcherFixture(t)
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, ok := <-w.Signals(); ok {
		t.Fatal("Signals still open after Close")
	}
	// Idempotent.
	if err := w.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

// TestRepoWatcher_SymlinkedRepoStillClassifies guards D7/F9: a repository opened through a
// symlinked ancestor must still classify. `git rev-parse --absolute-git-dir`/`--git-common-dir`
// do not resolve symlinks (F9), so without NewRepoWatcher resolving CommonDir/GitDir once up
// front, a real macOS FSEvents backend — which always reports realpaths — would prefix-match
// nothing and this would hang forever.
//
// This is a partial guard, not a reproduction of that failure: fsnotify (this platform's backend)
// echoes back whatever path it was told to watch, unresolved or not, so it cannot by itself
// exhibit F9's mismatch the way FSEvents does. What it does prove is that resolveOrKeep runs,
// that it does not desync the backend's watch roots from classify's comparison target, and that a
// repository whose CommonDir/GitDir contain a symlink component still works end to end. §7.3 step
// 1 is what exercises the real macOS failure mode.
func TestRepoWatcher_SymlinkedRepoStillClassifies(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no symlink semantics to exercise on Windows-like platforms")
	}
	realDir := initFixtureRepo(t)
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(filepath.Dir(realDir), link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	symlinkedRoot := filepath.Join(link, filepath.Base(realDir))

	gitPath := requireRealGit(t)
	summary, err := Identify(context.Background(), NewExecRunner(), gitPath, symlinkedRoot)
	if err != nil {
		t.Fatalf("identify through symlink: %v", err)
	}

	w, err := NewRepoWatcher(summary)
	if err != nil {
		t.Fatalf("NewRepoWatcher: %v", err)
	}
	t.Cleanup(func() { _ = w.Close() })

	runGit(t, symlinkedRoot, "commit", "--allow-empty", "-q", "-m", "through symlink")
	awaitSignal(t, w.Signals(), SignalRefsChanged)
}

// fakeBackend is an in-package backend implementation for driving RepoWatcher's own logic (the
// debounce and the Rescan rule, D6) with no filesystem and no real git.
type fakeBackend struct {
	events chan rawEvent
}

func (b *fakeBackend) Events() <-chan rawEvent { return b.events }
func (b *fakeBackend) Close() error            { return nil }

// TestRepoWatcher_RescanRaisesBothSignals is the first automated coverage of the overflow/dropped-
// events rule (D9/G2 D10) — real fsnotify overflow and real FSEvents drop flags are not producible
// on demand, but the rule itself lives above the backend seam, so exercising it through a fake
// backend covers both real backends at once.
func TestRepoWatcher_RescanRaisesBothSignals(t *testing.T) {
	fake := &fakeBackend{events: make(chan rawEvent, 1)}
	w := newRepoWatcherWith(RepoSummary{CommonDir: "/repo/.git", GitDir: "/repo/.git"}, fake)
	t.Cleanup(func() { _ = w.Close() })

	fake.events <- rawEvent{Rescan: true}

	awaitSignal(t, w.Signals(), SignalRefsChanged)
	awaitSignal(t, w.Signals(), SignalWorktreeChanged)
}
