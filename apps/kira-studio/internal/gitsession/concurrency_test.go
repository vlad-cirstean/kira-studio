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
