package ade

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fetchStamp(t *testing.T, h *boardHarness, repoID string) int64 {
	t.Helper()
	board, err := h.board.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range board.Repos {
		if r.CodeRepoID == repoID && r.LastFetchAt != nil {
			return *r.LastFetchAt
		}
	}
	return 0
}

func TestTaskBoard_RefreshAllFetchesEveryBoardRepo(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	_, dirA := initQueueRepo(t)
	_, dirB := initQueueRepo(t)
	_, dirIdle := initQueueRepo(t)
	h.addRepo("a", dirA)
	h.addRepo("b", dirB)
	h.addRepo("idle", dirIdle)
	for _, d := range []string{dirA, dirB} {
		runGitQueue(t, d, "checkout", "-q", "-b", "feat", "main")
		commitFile(t, d, "f.txt", "f\n", "f")
	}
	h.addTask("T1", "task", branchSpec{id: "ba", repo: "a", name: "feat", kind: "mine"})
	h.addTask("T2", "task", branchSpec{id: "bb", repo: "b", name: "feat", kind: "mine"})

	beforeA, beforeB := fetchStamp(t, h, "a"), fetchStamp(t, h, "b")
	time.Sleep(20 * time.Millisecond)

	res, err := h.board.Refresh(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Repos) != 2 {
		t.Fatalf("refresh-all answered %d repos, want the 2 the board shows", len(res.Repos))
	}
	for _, row := range res.Repos {
		if row.Error != nil {
			t.Fatalf("refresh %s: %+v", row.CodeRepoID, row.Error)
		}
	}
	if fetchStamp(t, h, "a") <= beforeA || fetchStamp(t, h, "b") <= beforeB {
		t.Fatal("a refreshed repo's lastFetchAt did not advance")
	}
}

func TestTaskBoard_RefreshNamedRepoWithoutLiveBranches(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("idle", dir)
	res, err := h.board.Refresh(context.Background(), []string{"idle"})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Repos) != 1 || res.Repos[0].Error != nil {
		t.Fatalf("refresh = %+v, want one row without error", res.Repos)
	}
}

func repoState(t *testing.T, h *boardHarness, repoID string) (remote string, fetched *int64) {
	t.Helper()
	board, err := h.board.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range board.Repos {
		if r.CodeRepoID == repoID {
			return r.Remote, r.LastFetchAt
		}
	}
	t.Fatalf("board has no repo %s", repoID)
	return "", nil
}

func TestTaskBoard_RefreshWithDefaultGitPathSetting(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	h.board.deps.GitPath = func() string { return "" }
	_, dir := initQueueRepo(t)
	h.addRepo("a", dir)
	runGitQueue(t, dir, "checkout", "-q", "-b", "feat", "main")
	commitFile(t, dir, "f.txt", "f\n", "f")
	h.addTask("T1", "task", branchSpec{id: "ba", repo: "a", name: "feat", kind: "mine"})
	runGitQueue(t, dir, "fetch", "-q")

	remote, fetched := repoState(t, h, "a")
	if remote != "origin" || fetched == nil {
		t.Fatalf("board repo remote=%q lastFetchAt=%v, want origin and a fetch time", remote, fetched)
	}
	res, err := h.board.Refresh(context.Background(), []string{"a"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Repos[0].Error != nil {
		t.Fatalf("refresh error: %+v", res.Repos[0].Error)
	}
}

func TestTaskBoard_RefreshWithoutRemoteIsNotAnError(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	dir := t.TempDir()
	runGitQueue(t, dir, "init", "-q", "-b", "main")
	runGitQueue(t, dir, "config", "user.name", queueMineName)
	runGitQueue(t, dir, "config", "user.email", queueMineEmail)
	commitFile(t, dir, "base.txt", "base\n", "base")
	runGitQueue(t, dir, "checkout", "-q", "-b", "feat")
	commitFile(t, dir, "f.txt", "f\n", "f")
	h.addRepo("r", dir)
	h.addTask("T1", "task", branchSpec{id: "br", repo: "r", name: "feat", kind: "mine"})

	res, err := h.board.Refresh(context.Background(), []string{"r"})
	if err != nil {
		t.Fatal(err)
	}
	if row := res.Repos[0]; row.Error != nil {
		t.Fatalf("row error = %+v, want none", *row.Error)
	} else if row.RefsChanged != 0 {
		t.Fatalf("refsChanged = %d, want 0", row.RefsChanged)
	}
	if remote, _ := repoState(t, h, "r"); remote != "" {
		t.Fatalf("remote = %q, want none", remote)
	}
	if _, err := os.Stat(filepath.Join(dir, ".git", "FETCH_HEAD")); err == nil {
		t.Fatal("FETCH_HEAD exists: a no-remote refresh must not fetch")
	}
}

func TestTaskBoard_LinkedWorktreeRootShowsFetch(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	_, dir := initQueueRepo(t)
	wt := addQueueWorktree(t, dir, "feat", "main")
	h.addRepoFromPath("wt", wt)
	h.addTask("T1", "task", branchSpec{id: "bw", repo: "wt", name: "feat", kind: "mine"})

	res, err := h.board.Refresh(context.Background(), []string{"wt"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Repos[0].Error != nil {
		t.Fatalf("refresh error: %+v", res.Repos[0].Error)
	}
	if _, fetched := repoState(t, h, "wt"); fetched == nil {
		t.Fatal("lastFetchAt is nil after a refresh of a linked worktree root")
	}
}
