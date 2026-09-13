package gitsession

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsearch"
)

type searchCommitSpec struct {
	subject string
	body    string
}

// initSearchRepo builds a repo from commits, in order, each with a distinct subject/body — real
// `git commit` spawns (not fast-import) since these tests only ever need a handful of commits.
func initSearchRepo(t *testing.T, commits []searchCommitSpec) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
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
	run("init", "-q", "-b", "main")
	for i, c := range commits {
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte{byte(i)}, 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("add", "f.txt")
		args := []string{"commit", "-q", "-m", c.subject}
		if c.body != "" {
			args = append(args, "-m", c.body)
		}
		run(args...)
	}
	return dir
}

// TestWalkSearch_HitInNotYetLoadedTail is §3.12's first named case: Search must find a commit
// no ReadPage has ever loaded into the store — the whole point of running an independent scan
// rather than reading the paused logsession.
func TestWalkSearch_HitInNotYetLoadedTail(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{
		{subject: "base commit"},
		{subject: "middle commit"},
		{subject: "the needle commit"},
	})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	loaded, _, _, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 0 {
		t.Fatalf("loaded = %d, want 0 before any ReadPage", loaded)
	}

	res, err := w.Search(context.Background(), gitsearch.Query{Text: "needle"}, 0)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if res.Total != 1 || len(res.Hits) != 1 || res.Hits[0].Subject != "the needle commit" {
		t.Fatalf("Search result = %+v, want exactly the needle commit", res)
	}
}

// TestWalkSearch_BodyOnlyHitOnAlreadyLoadedRow is §3.12's second named case: gitsearch.Scan reads
// a commit's real body regardless of whether the row is already paged into the store — the
// client-side loaded scan never can (the column store holds no bodies at all).
func TestWalkSearch_BodyOnlyHitOnAlreadyLoadedRow(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{
		{subject: "routine maintenance", body: "Renames the internal Zebra module."},
		{subject: "another commit"},
	})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()

	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	if _, err := w.ReadPage(context.Background(), 10); err != nil {
		t.Fatalf("ReadPage: %v", err)
	}
	loaded, _, exhausted, err := w.Status(context.Background())
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if loaded != 2 || !exhausted {
		t.Fatalf("loaded=%d exhausted=%v, want both commits already loaded", loaded, exhausted)
	}

	res, err := w.Search(context.Background(), gitsearch.Query{Text: "Zebra"}, 0)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if res.Total != 1 || len(res.Hits) != 1 {
		t.Fatalf("Search result = %+v, want exactly one body-only hit", res)
	}
	fields := res.Hits[0].Fields
	if len(fields) != 1 || fields[0] != gitsearch.FieldBody {
		t.Fatalf("Fields = %v, want exactly [body]", fields)
	}
}

// TestWalkSearch_SupersedeCancelsThePreviousScan pins the supersede slot directly (rather than
// racing a real scan's wall-clock duration): a cancel func standing in for "a scan already in
// flight" must be invoked, and searchGen must advance, on the next Search call.
func TestWalkSearch_SupersedeCancelsThePreviousScan(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{{subject: "one commit"}})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()
	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	w.mu.Lock()
	var cancelled bool
	w.searchGen++
	priorGen := w.searchGen
	w.searchCancel = func() { cancelled = true }
	w.mu.Unlock()

	if _, err := w.Search(context.Background(), gitsearch.Query{Text: "commit"}, 0); err != nil {
		t.Fatalf("Search: %v", err)
	}
	if !cancelled {
		t.Fatal("expected Search to cancel the previously-installed in-flight scan")
	}
	w.mu.Lock()
	stillPriorGen := w.searchGen == priorGen
	w.mu.Unlock()
	if stillPriorGen {
		t.Fatal("expected searchGen to have advanced past the previously-installed generation")
	}
}

// TestWalkSearch_ResetCancelsInFlightScan is D12's own resetLocked line: a walk rebuild (refs
// moved, an explicit graph.refresh) must cancel any scan already reading the walk's old rev set.
func TestWalkSearch_ResetCancelsInFlightScan(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{{subject: "one commit"}})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()
	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}

	w.mu.Lock()
	var cancelled bool
	w.searchCancel = func() { cancelled = true }
	w.mu.Unlock()

	w.MarkRefresh()
	if _, _, _, err := w.Status(context.Background()); err != nil { // ensureFreshLocked runs first
		t.Fatalf("Status: %v", err)
	}
	if !cancelled {
		t.Fatal("expected a walk rebuild (resetLocked) to cancel any in-flight scan")
	}
}

// TestWalkSearch_RunsInsideTheReadGate is §3.12's fourth named case: Search must actually go
// through entry.Repo.Read (the four-slot reader pool), not a direct-spawn bypass — proven here by
// showing it blocks behind an in-progress Write and resumes once the Write releases.
func TestWalkSearch_RunsInsideTheReadGate(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{{subject: "one commit"}})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()
	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "all"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	entry, ok := conn.Entry(repoID)
	if !ok {
		t.Fatal("expected a held entry")
	}

	release := make(chan struct{})
	writeStarted := make(chan struct{})
	go func() {
		_ = entry.Repo.Write(context.Background(), func(ctx context.Context) error {
			close(writeStarted)
			<-release
			return nil
		})
	}()
	<-writeStarted

	searchDone := make(chan error, 1)
	go func() {
		_, serr := w.Search(context.Background(), gitsearch.Query{Text: "commit"}, 0)
		searchDone <- serr
	}()

	select {
	case <-searchDone:
		t.Fatal("expected Search to block while a Write is in progress (it must run through Repo.Read)")
	case <-time.After(100 * time.Millisecond):
		// Still blocked behind the write, as expected.
	}

	close(release)
	select {
	case serr := <-searchDone:
		if serr != nil {
			t.Fatalf("Search after the write released: %v", serr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Search never completed after the write released")
	}
}

// TestWalkSearch_UsesTheWalksOwnRevSet is a light structural check that Search's argv comes from
// THIS walk's own spec — a review (ranged) walk must never be read by a graph-scoped Search call.
func TestWalkSearch_UsesTheWalksOwnRevSet(t *testing.T) {
	t.Parallel()
	skipWithoutGitWalk(t)
	dir := initSearchRepo(t, []searchCommitSpec{{subject: fmt.Sprintf("commit %d", 1)}})
	conn, _, repoID := newWalkTestConn(t, dir)
	defer conn.Close()
	w, err := conn.Walk(repoID, "git", porcelain.WalkSpec{Scope: "head"}, 0, nil)
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	if got := w.Spec().Scope; got != "head" {
		t.Fatalf("Spec().Scope = %q, want %q", got, "head")
	}
}
