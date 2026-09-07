package gitsession

import (
	"bytes"
	"context"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
)

// --- fakes shared across this package's tests ---------------------------------------------------
// Pure Go, no filesystem and no real git: Identify's own rev-parse/symbolic-ref sequence is
// answered deterministically from spec.Dir (the path Acquire/Open were called with), and the
// watcher is a bare channel any test can drive by hand.

type fakeProcess struct{ stdout []byte }

func (p *fakeProcess) Stdout() io.ReadCloser { return io.NopCloser(bytes.NewReader(p.stdout)) }
func (p *fakeProcess) Wait() (gitclient.Result, error) {
	return gitclient.Result{ExitCode: 0}, nil
}
func (p *fakeProcess) Close() error { return nil }

// identifyRunner answers exactly the sequence gitclient.Identify makes, so every "repository" this
// package's tests open is really just a distinct path with no filesystem behind it at all.
type identifyRunner struct{}

func (identifyRunner) Start(_ context.Context, _ string, spec gitclient.Spec) (gitclient.Process, error) {
	args := spec.Args
	last := ""
	if len(args) > 0 {
		last = args[len(args)-1]
	}
	var out string
	switch {
	case last == "--is-bare-repository":
		out = "false\n"
	case last == "--absolute-git-dir", last == "--git-common-dir":
		out = spec.Dir + "/.git\n"
	case last == "--show-toplevel":
		out = spec.Dir + "\n"
	case len(args) > 0 && args[0] == "symbolic-ref":
		out = "main\n"
	case last == "HEAD":
		out = "deadbeef\n"
	}
	return &fakeProcess{stdout: []byte(out)}, nil
}

// fakeWatcher is a hand-drivable watcher: Fire sends a signal, Close closes Signals. Every
// construction is counted (via the shared counter passed to newFakeWatcherFactory) so a test can
// assert entry identity across an expire-then-reacquire without a production-only accessor.
type fakeWatcher struct {
	sig       chan gitclient.Signal
	closeOnce sync.Once
	closed    chan struct{}
}

func newFakeWatcher() *fakeWatcher {
	return &fakeWatcher{sig: make(chan gitclient.Signal), closed: make(chan struct{})}
}

func (w *fakeWatcher) Signals() <-chan gitclient.Signal { return w.sig }

func (w *fakeWatcher) Close() error {
	w.closeOnce.Do(func() {
		close(w.sig)
		close(w.closed)
	})
	return nil
}

func (w *fakeWatcher) Fire(sig gitclient.Signal) { w.sig <- sig }

// newFakeWatcherFactory returns a Registry.newWatcher func and a counter of how many watchers it
// constructed — the identity proof registry_test.go needs without a production Len()/accessor.
func newFakeWatcherFactory() (func(gitclient.RepoSummary) (watcher, error), *int32) {
	var count int32
	factory := func(gitclient.RepoSummary) (watcher, error) {
		atomic.AddInt32(&count, 1)
		return newFakeWatcher(), nil
	}
	return factory, &count
}

func newTestRegistry() *Registry {
	reg := NewRegistry(identifyRunner{})
	factory, _ := newFakeWatcherFactory()
	reg.newWatcher = factory
	return reg
}

// --- Acquire/release: refcount, linger, re-acquire ------------------------------------------------

func TestRegistry_TwoAcquiresSameRepoOneEntry(t *testing.T) {
	reg := newTestRegistry()
	e1, release1, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	e2, release2, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire (again): %v", err)
	}
	if e1 != e2 {
		t.Fatal("two Acquires for the same path returned different *RepoEntry values")
	}
	release1()
	release2()
}

func TestRegistry_OneReleaseKeepsEntryAliveWhileSecondHolds(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Millisecond

	_, release1, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	_, release2, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	release1()

	// Give a (deliberately short) linger window a chance to expire, and prove it did NOT: the
	// second holder is still live.
	time.Sleep(20 * time.Millisecond)

	reg.mu.Lock()
	_, stillPresent := reg.entries["/repo/.git"]
	reg.mu.Unlock()
	if !stillPresent {
		t.Fatal("entry torn down while a second connection still holds it")
	}
	release2()
}

func TestRegistry_ReleaseToZeroArmsLingerNotImmediateTeardown(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour // long enough that this test would time out if teardown were immediate.

	_, release, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	release()

	reg.mu.Lock()
	sl, ok := reg.entries["/repo/.git"]
	reg.mu.Unlock()
	if !ok {
		t.Fatal("entry removed immediately at refcount zero, want it lingering")
	}
	if sl.lingerTimer == nil {
		t.Fatal("refcount zero did not arm a linger timer")
	}
}

func TestRegistry_ReacquireInsideLingerWindowReusesEntryAndCancelsTimer(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = 200 * time.Millisecond

	e1, release, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	release()

	e2, release2, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("re-Acquire: %v", err)
	}
	if e1 != e2 {
		t.Fatal("re-acquire inside the linger window built a new *RepoEntry instead of reusing it")
	}
	reg.mu.Lock()
	sl := reg.entries["/repo/.git"]
	timerCancelled := sl.lingerTimer == nil
	reg.mu.Unlock()
	if !timerCancelled {
		t.Fatal("re-acquire did not cancel the armed linger timer")
	}
	release2()
}

func TestRegistry_ExpiryTearsDownAndLaterAcquireBuildsNewEntry(t *testing.T) {
	reg := newTestRegistry()
	factory, count := newFakeWatcherFactory()
	reg.newWatcher = factory
	reg.LingerFor = 20 * time.Millisecond

	e1, release, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	release()
	if got := atomic.LoadInt32(count); got != 1 {
		t.Fatalf("watcher constructions after first Acquire = %d, want 1", got)
	}

	deadline := time.After(2 * time.Second)
	for {
		reg.mu.Lock()
		_, present := reg.entries["/repo/.git"]
		reg.mu.Unlock()
		if !present {
			break
		}
		select {
		case <-deadline:
			t.Fatal("entry never expired")
		case <-time.After(5 * time.Millisecond):
		}
	}

	e2, release2, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("re-Acquire after expiry: %v", err)
	}
	defer release2()
	if e1 == e2 {
		t.Fatal("re-acquire after expiry reused the torn-down *RepoEntry")
	}
	if got := atomic.LoadInt32(count); got != 2 {
		t.Fatalf("watcher constructions after expiry+re-acquire = %d, want 2", got)
	}
}

func TestRegistry_ReleaseTwiceIsANoOp(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour

	_, release, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	release()
	release() // must not decrement refs a second time, or panic.

	reg.mu.Lock()
	sl := reg.entries["/repo/.git"]
	refs := sl.refs
	reg.mu.Unlock()
	if refs != 0 {
		t.Fatalf("refs = %d after two releases of one Acquire, want 0", refs)
	}
}

func TestRegistry_CloseTearsDownEverythingImmediately(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour

	_, release1, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo-a")
	if err != nil {
		t.Fatalf("Acquire a: %v", err)
	}
	e2, _, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo-b")
	if err != nil {
		t.Fatalf("Acquire b: %v", err)
	}
	release1() // repo-a: refcount zero, would normally linger for an hour.

	reg.Close()

	reg.mu.Lock()
	remaining := len(reg.entries)
	reg.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("entries remaining after Close = %d, want 0", remaining)
	}
	w2 := e2.watcher.(*fakeWatcher)
	select {
	case <-w2.closed:
	default:
		t.Fatal("Close did not tear down a still-held (refs > 0) entry's watcher")
	}
}
