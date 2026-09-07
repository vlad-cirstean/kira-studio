package gitsession

import (
	"context"
	"sync"
	"testing"
	"time"
)

// This file is G8's own concurrency tier (D9): every test here is designed to fail only for a
// concurrency reason (ordering, a lost release, a double-close, a race on shared state) and is run
// at `-race -count=10` by name (every test here begins TestConcurrent, D16's own filter). Each of
// the first several reproduces one of G8's findings on the pre-fix tree — the exact pre-fix output
// is quoted in its own comment so a future reader can tell a regression test from a speculative one.

// TestConcurrent_OpenAfterCloseIsARelease is F1's deterministic ordering: Close() then Open() for
// the same connection must release rather than store the ref Open takes, and the caller still gets
// a correct summary back. On the pre-fix tree this leaves refs=1 forever (F1's own probe: "after
// Close-then-Open: entry present=true refs=1 heldLen=1").
func TestConcurrent_OpenAfterCloseIsARelease(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})

	c.Close()
	summary, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Open after Close: %v", err)
	}
	if summary.RepoID != "/repo" {
		t.Fatalf("Open after Close returned repoID %q, want /repo — the caller must still get a correct answer", summary.RepoID)
	}

	reg.mu.Lock()
	sl, ok := reg.entries["/repo"]
	var refs int
	if ok {
		refs = sl.refs
	}
	reg.mu.Unlock()
	if ok && refs != 0 {
		t.Fatalf("refs = %d after Open on an already-closed connection, want 0 or the entry gone (F1)", refs)
	}

	c.mu.Lock()
	held := len(c.held)
	c.mu.Unlock()
	if held != 0 {
		t.Fatalf("Conn.held has %d entries after Open on an already-closed connection, want 0", held)
	}
}

// TestConcurrent_OpenRacingCloseNeverLeaksAHold is F1's own probe, promoted to a permanent
// regression test: 200 iterations of a real Open racing a real Close on the same connection. On
// the pre-fix tree this reproduced "leaked holds in 200 Open/Close races: 160" — an Open that wins
// the race against Close's map swap stores its hold into the map Close already replaced, and
// nothing ever releases it. After the fix every iteration ends at refcount zero.
func TestConcurrent_OpenRacingCloseNeverLeaksAHold(t *testing.T) {
	const n = 200
	reg := newTestRegistry()
	reg.LingerFor = time.Hour

	leaks := 0
	for i := 0; i < n; i++ {
		path := "/repo"
		c := NewConn(ConnID("c"), "client-1", "label-1", func(string, any) {})

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = c.Open(context.Background(), reg, "/usr/bin/git", path)
		}()
		go func() {
			defer wg.Done()
			c.Close()
		}()
		wg.Wait()

		// Whichever order they ran in, the connection ends up closed and must hold nothing.
		c.mu.Lock()
		held := len(c.held)
		c.mu.Unlock()
		if held != 0 {
			leaks++
		}

		reg.mu.Lock()
		sl, ok := reg.entries[path]
		refs := 0
		if ok {
			refs = sl.refs
		}
		reg.mu.Unlock()
		if refs != 0 {
			leaks++
			// Clean this iteration's leaked ref so it cannot pollute the next iteration's count.
			reg.mu.Lock()
			delete(reg.entries, path)
			reg.mu.Unlock()
		}
	}
	if leaks != 0 {
		t.Fatalf("leaked holds/refs in %d Open/Close races: %d (want 0) — F1", n, leaks)
	}
}

// TestConcurrent_SubscribeRacingTeardown is F2(a)'s own probe: 200 iterations of a real Subscribe
// racing a real Registry.Close (which tears entries down regardless of refcount, D14) — reachable
// whenever a repo.open/repo.close is still in flight when the app quits. On the pre-fix tree this
// panics with "assignment to entry in nil map" the moment Subscribe's own critical section runs
// after teardown has already nilled e.subs.
func TestConcurrent_SubscribeRacingTeardown(t *testing.T) {
	const n = 200
	for i := 0; i < n; i++ {
		reg := newTestRegistry()
		entry, _, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			unsub := entry.Subscribe(ConnID("c"), func(Event) {})
			unsub()
		}()
		go func() {
			defer wg.Done()
			reg.Close()
		}()
		wg.Wait()
	}
}

// TestConcurrent_UnsubscribeAfterTeardown is F2(b)'s own probe: a Subscribe that completes BEFORE
// teardown, whose unsubscribe is then called AFTER teardown already closed every subscriber it
// found. On the pre-fix tree this panics with "close of closed channel" — teardown's own close and
// this unsubscribe's close both fire on the same subscriber.
func TestConcurrent_UnsubscribeAfterTeardown(t *testing.T) {
	const n = 200
	for i := 0; i < n; i++ {
		reg := newTestRegistry()
		entry, _, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
		if err != nil {
			t.Fatalf("Acquire: %v", err)
		}
		unsub := entry.Subscribe(ConnID("c"), func(Event) {})
		reg.Close() // tears the entry down immediately, closing the subscriber above itself.
		unsub()     // must be a safe no-op, not a double close.
	}
}

// TestConcurrent_CatFileAfterTeardownIsRefused is F3's own probe: CatFile() after teardown must
// return nil (never a live, unmemoised session nothing will ever close) so its callers can refuse
// with ErrRepoTornDown instead of leaking a `cat-file --batch` pair. On the pre-fix tree this
// returns a fresh, live session every time.
func TestConcurrent_CatFileAfterTeardownIsRefused(t *testing.T) {
	reg := newTestRegistry()
	entry, _, err := reg.Acquire(context.Background(), "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	reg.Close()

	if s := entry.CatFile(); s != nil {
		t.Fatal("CatFile() after teardown returned a live session, want nil (F3)")
	}
	// A second call must not construct anything either.
	if s := entry.CatFile(); s != nil {
		t.Fatal("a second CatFile() after teardown returned a live session, want nil")
	}
}

// TestConcurrent_AutoFetchArmsOnOpen is F4's own probe: a repository opened while the auto-fetch
// interval reads as 0 gets no timer at construction (correct); the off→on direction is what G7's
// startAutoFetch-only-from-newRepoEntry wiring never handled — on the pre-fix tree no LATER Open,
// however many windows, ever arms one. A second Open (already armed) must arm no second timer, and
// an entry `disabled` by a real fetch failure must never be resurrected by an Open.
func TestConcurrent_AutoFetchArmsOnOpen(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour
	minutes := 0
	reg.Settings = func() ([]string, int) { return nil, minutes }

	c1 := NewConn("c1", "client-1", "label-1", func(string, any) {})
	if _, err := c1.Open(context.Background(), reg, "/usr/bin/git", "/repo"); err != nil {
		t.Fatalf("Open: %v", err)
	}

	reg.mu.Lock()
	entry := reg.entries["/repo"].entry
	reg.mu.Unlock()
	defer reg.Close()

	entry.autoFetch.mu.Lock()
	armedAtConstruction := entry.autoFetch.timer != nil
	entry.autoFetch.mu.Unlock()
	if armedAtConstruction {
		t.Fatal("timer armed at construction despite a 0 interval")
	}

	// The setting flips on; a SECOND connection's Open must arm the timer this repository never
	// got (F4 — the off->on direction newRepoEntry-only arming never handles).
	minutes = 5
	c2 := NewConn("c2", "client-2", "label-2", func(string, any) {})
	if _, err := c2.Open(context.Background(), reg, "/usr/bin/git", "/repo"); err != nil {
		t.Fatalf("Open (2nd conn): %v", err)
	}
	entry.autoFetch.mu.Lock()
	timer1 := entry.autoFetch.timer
	entry.autoFetch.mu.Unlock()
	if timer1 == nil {
		t.Fatal("no timer armed after Open with a non-zero interval (F4)")
	}

	// A THIRD Open must not replace the already-armed timer with a second one.
	c3 := NewConn("c3", "client-3", "label-3", func(string, any) {})
	if _, err := c3.Open(context.Background(), reg, "/usr/bin/git", "/repo"); err != nil {
		t.Fatalf("Open (3rd conn): %v", err)
	}
	entry.autoFetch.mu.Lock()
	timer2 := entry.autoFetch.timer
	entry.autoFetch.mu.Unlock()
	if timer1 != timer2 {
		t.Fatal("a second Open on an already-armed entry armed a NEW timer")
	}

	// A `disabled` entry (a real fetch failure already killed its timer, G7 D23) must never be
	// resurrected by a later Open.
	entry.disableAutoFetch()
	c4 := NewConn("c4", "client-4", "label-4", func(string, any) {})
	if _, err := c4.Open(context.Background(), reg, "/usr/bin/git", "/repo"); err != nil {
		t.Fatalf("Open (4th conn): %v", err)
	}
	entry.autoFetch.mu.Lock()
	timer3, disabled := entry.autoFetch.timer, entry.autoFetch.disabled
	entry.autoFetch.mu.Unlock()
	if timer3 != nil || !disabled {
		t.Fatal("Open resurrected a disabled auto-fetch entry")
	}
}
