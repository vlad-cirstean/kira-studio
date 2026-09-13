package gitsession

import (
	"context"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func TestConn_OpenTwiceSamePathOneRefOneHold(t *testing.T) {
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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
	t.Parallel()
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

// revListShas returns `git rev-list --reverse HEAD`'s own shas, oldest first — used to build a
// real <base>..<branch> range against a real repository.
func revListShas(t *testing.T, dir string) []string {
	t.Helper()
	cmd := exec.Command("git", "rev-list", "--reverse", "HEAD")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git rev-list: %v\n%s", err, out)
	}
	return strings.Fields(string(out))
}

// TestConn_ReviewWalkDoesNotDisturbTheGraphWalk is D3's whole correctness claim: build both walks
// on one Conn against one repository, page and stream each, and assert the graph's store row
// count, nextSeq (observed via Status/Stream chunk seq) and log session are untouched across the
// review walk's whole life, including its replacement by a second range.
func TestConn_ReviewWalkDoesNotDisturbTheGraphWalk(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 6)
	shas := revListShas(t, repoDir)
	if len(shas) != 6 {
		t.Fatalf("got %d commits, want 6", len(shas))
	}
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	// Build and fully page the graph walk first.
	graphWalk, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("graph Walk: %v", err)
	}
	if _, err := graphWalk.ReadPage(context.Background(), 1); err != nil {
		t.Fatalf("graph ReadPage: %v", err)
	}
	loaded, _, exhausted, err := graphWalk.Status(context.Background())
	if err != nil {
		t.Fatalf("graph Status: %v", err)
	}
	if loaded != 6 || !exhausted {
		t.Fatalf("graph walk after ReadPage: loaded=%d exhausted=%v, want loaded=6 exhausted=true", loaded, exhausted)
	}

	assertGraphUnchanged := func(when string) {
		t.Helper()
		w, ok := conn.WalkFor(repoID)
		if !ok {
			t.Fatalf("%s: WalkFor reports no graph walk", when)
		}
		if w != graphWalk {
			t.Fatalf("%s: WalkFor returned a different *Walk than the one built before any review walk existed", when)
		}
		l, _, e, err := w.Status(context.Background())
		if err != nil {
			t.Fatalf("%s: graph Status: %v", when, err)
		}
		if l != 6 || !e {
			t.Fatalf("%s: graph walk = {loaded:%d exhausted:%v}, want {6 true} -- disturbed by the review walk", when, l, e)
		}
	}

	// Open a review walk (shas[0]..main), stream and page it.
	reviewSpec := porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: shas[0], Branch: "main"}}
	reviewWalk, err := conn.Walk(repoID, "git", reviewSpec, 0, nil)
	if err != nil {
		t.Fatalf("review Walk: %v", err)
	}
	if reviewWalk == graphWalk {
		t.Fatal("review Walk returned the SAME *Walk as the graph walk -- the two slots collided")
	}
	if err := reviewWalk.Stream(context.Background(), nil, 500, func(StreamChunk) error { return nil }); err != nil {
		t.Fatalf("review Stream: %v", err)
	}
	reviewLoaded, _, reviewExhausted, err := reviewWalk.Status(context.Background())
	if err != nil {
		t.Fatalf("review Status: %v", err)
	}
	if reviewLoaded != 5 || !reviewExhausted {
		// shas[0]..main is 5 commits (every commit but the range's own base).
		t.Fatalf("review walk = {loaded:%d exhausted:%v}, want {5 true}", reviewLoaded, reviewExhausted)
	}
	assertGraphUnchanged("after the review walk's own stream")

	if got, ok := conn.ReviewWalkFor(repoID); !ok || got != reviewWalk {
		t.Fatal("ReviewWalkFor does not return the review walk just built")
	}

	// Replace the review walk with a second range -- must not touch the graph, and must not reuse
	// the first review walk (there is never more than one per (connection, repository)).
	secondSpec := porcelain.WalkSpec{Range: &porcelain.RangeSpec{Base: shas[1], Branch: "main"}}
	secondReviewWalk, err := conn.Walk(repoID, "git", secondSpec, 0, nil)
	if err != nil {
		t.Fatalf("second review Walk: %v", err)
	}
	if secondReviewWalk == reviewWalk {
		t.Fatal("a review Walk with a different range returned the SAME *Walk -- the incumbent was not replaced")
	}
	if err := secondReviewWalk.Stream(context.Background(), nil, 500, func(StreamChunk) error { return nil }); err != nil {
		t.Fatalf("second review Stream: %v", err)
	}
	secondLoaded, _, secondExhausted, err := secondReviewWalk.Status(context.Background())
	if err != nil {
		t.Fatalf("second review Status: %v", err)
	}
	if secondLoaded != 4 || !secondExhausted {
		t.Fatalf("second review walk = {loaded:%d exhausted:%v}, want {4 true}", secondLoaded, secondExhausted)
	}
	assertGraphUnchanged("after replacing the review walk with a second range")

	if got, ok := conn.ReviewWalkFor(repoID); !ok || got != secondReviewWalk {
		t.Fatal("ReviewWalkFor does not return the SECOND review walk after replacement")
	}
}

// TestConn_MarkWalksStaleRacesSafelyWithWalkRebuild is G32 round-3 architecture/security review,
// finding #6's own regression proof. Walk's own `*slot = w` / `(*slot).dispose(); *slot = nil`
// (rebuilding pair.graph/pair.review on a spec change) only ever runs under c.mu — but
// markWalksStale used to read those same two fields AFTER releasing c.mu, exactly the "in the real
// system" scenario Open's own entry.Subscribe callback creates: refsChanged fires on the watcher's
// notification goroutine, concurrently with an RPC handler goroutine rebuilding a walk via
// graph.stream/review.stream. One goroutine repeatedly alternates the graph slot between two specs
// (forcing repeated dispose-and-replace, exactly Walk's own mutation path) while a second
// concurrently calls markWalksStale — go test -race is what actually proves this, by flagging the
// unsynchronized read/write pre-fix and staying silent post-fix.
func TestConn_MarkWalksStaleRacesSafelyWithWalkRebuild(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	repoDir := initWalkRepo(t, 6)
	conn, _, repoID := newWalkTestConn(t, repoDir)
	defer conn.Close()

	if _, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil); err != nil {
		t.Fatalf("initial Walk: %v", err)
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		specs := []porcelain.WalkSpec{{Scope: "all"}, {Scope: "head"}}
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			if _, err := conn.Walk(repoID, "git", specs[i%2], 0, nil); err != nil {
				return
			}
		}
	}()

	for i := 0; i < 500; i++ {
		conn.markWalksStale(repoID)
	}
	close(stop)
	wg.Wait()
}
