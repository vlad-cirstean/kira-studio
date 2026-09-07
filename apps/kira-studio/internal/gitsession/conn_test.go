package gitsession

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestConn_OpenTwiceSamePathOneRefOneHold(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour

	var emitted []string
	c := NewConn("c1", "client-1", "label-1", func(method string, _ any) { emitted = append(emitted, method) })

	s1, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	s2, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Open (again): %v", err)
	}
	if s1.RepoID != s2.RepoID {
		t.Fatalf("RepoID changed across a repeat Open: %q vs %q", s1.RepoID, s2.RepoID)
	}

	reg.mu.Lock()
	sl := reg.entries[s1.RepoID]
	refs := sl.refs
	reg.mu.Unlock()
	if refs != 1 {
		t.Fatalf("registry refcount after two Opens of the same repo by one connection = %d, want 1", refs)
	}

	c.mu.Lock()
	holds := len(c.held)
	c.mu.Unlock()
	if holds != 1 {
		t.Fatalf("Conn.held has %d entries after two Opens of the same repo, want 1", holds)
	}
}

func TestConn_CloseRepoFullyReleases(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Millisecond

	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	summary, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo")
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	if !c.CloseRepo(summary.RepoID) {
		t.Fatal("CloseRepo on a held repo reported false")
	}
	if c.CloseRepo(summary.RepoID) {
		t.Fatal("CloseRepo on an already-closed repo reported true")
	}

	reg.mu.Lock()
	sl, ok := reg.entries[summary.RepoID]
	var refs int
	if ok {
		refs = sl.refs
	}
	reg.mu.Unlock()
	if ok && refs != 0 {
		t.Fatalf("refs = %d after CloseRepo, want 0 (or the entry to already be gone)", refs)
	}
}

func TestConn_CloseReleasesEveryHoldAndUnsubscribes(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour

	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	sA, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo-a")
	if err != nil {
		t.Fatalf("Open a: %v", err)
	}
	sB, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo-b")
	if err != nil {
		t.Fatalf("Open b: %v", err)
	}

	c.Close()

	for _, repoID := range []string{sA.RepoID, sB.RepoID} {
		reg.mu.Lock()
		sl, ok := reg.entries[repoID]
		var refs int
		if ok {
			refs = sl.refs
		}
		reg.mu.Unlock()
		if ok && refs != 0 {
			t.Fatalf("repo %s refs = %d after Conn.Close, want 0", repoID, refs)
		}
	}

	c.mu.Lock()
	remaining := len(c.held)
	c.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("Conn.held has %d entries after Close, want 0", remaining)
	}
}

// TestConn_ConcurrentOpenSameRepoTakesOneRef exercises the race D15's own second held-check exists
// for: rpcstream dispatches every request on its own goroutine, so two repo.open calls for the same
// path from one connection can race each other.
func TestConn_ConcurrentOpenSameRepoTakesOneRef(t *testing.T) {
	reg := newTestRegistry()
	reg.LingerFor = time.Hour
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})

	const n = 20
	var wg sync.WaitGroup
	var mu sync.Mutex
	var repoID string
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, err := c.Open(context.Background(), reg, "/usr/bin/git", "/repo")
			if err != nil {
				t.Errorf("Open: %v", err)
				return
			}
			mu.Lock()
			repoID = s.RepoID
			mu.Unlock()
		}()
	}
	wg.Wait()

	reg.mu.Lock()
	sl := reg.entries[repoID]
	refs := sl.refs
	reg.mu.Unlock()
	if refs != 1 {
		t.Fatalf("refs after %d concurrent Opens of the same repo by one connection = %d, want 1", n, refs)
	}
	c.mu.Lock()
	holds := len(c.held)
	c.mu.Unlock()
	if holds != 1 {
		t.Fatalf("Conn.held has %d entries after concurrent Opens, want 1", holds)
	}
}
