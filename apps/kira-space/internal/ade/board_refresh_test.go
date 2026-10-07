package ade

import (
	"context"
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
