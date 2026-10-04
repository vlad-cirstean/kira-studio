package ade

import (
	"context"
	"testing"
)

func TestTaskBoard_RefreshFetchesMovedReviewBranch(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	origin, dir := initQueueRepo(t)
	h.addRepo("r", dir)

	other := t.TempDir()
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "clone", "-q", origin, ".")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "checkout", "-q", "-b", "rv")
	writeQueueFile(t, other, "r.txt", "1\n")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "add", "r.txt")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "commit", "-q", "-m", "r commit 1")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "push", "-q", "origin", "rv")
	runGitQueue(t, dir, "fetch", "-q", "origin")

	h.addTask("T", "review", branchSpec{id: "b", repo: "r", name: "rv", kind: "review"})
	if _, err := h.board.Board(context.Background()); err != nil {
		t.Fatal(err)
	}

	writeQueueFile(t, other, "r.txt", "1\n2\n")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "commit", "-q", "-am", "r commit 2")
	runGitQueueAs(t, other, queueOtherName, queueOtherEmail, "push", "-q", "origin", "rv")

	res, err := h.board.Refresh(context.Background(), []string{"r"})
	if err != nil {
		t.Fatal(err)
	}
	if got := res.Repos[0]; got.Error != nil || got.RefsChanged != 1 {
		t.Fatalf("refresh = %+v, want no error and 1 ref changed (only rv moved)", got)
	}
	board, err := h.board.Board(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if b := boardBranch(t, board, "b"); b.CommitCount != 2 {
		t.Fatalf("rv commit count = %d, want 2 (facts rerun on the moved ref)", b.CommitCount)
	}
}

func TestTaskBoard_ForcePushSucceedsAndRejectsStaleLease(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	origin, dir := initQueueRepo(t)
	h.addRepo("r", dir)

	// a: pushed with upstream, then amended locally (diverged).
	wtA := addQueueWorktree(t, dir, "a", "main")
	commitFile(t, wtA, "a.txt", "1\n", "a commit 1")
	runGitQueue(t, wtA, "push", "-q", "-u", "origin", "a")
	writeQueueFile(t, wtA, "a.txt", "1\nrewritten\n")
	runGitQueue(t, wtA, "commit", "-q", "--amend", "-am", "a commit 1 rewritten")

	// b: another clone force-moves origin's b; dir never refetches, so its lease is stale.
	wtB := addQueueWorktree(t, dir, "b", "main")
	commitFile(t, wtB, "b.txt", "1\n", "b commit 1")
	runGitQueue(t, wtB, "push", "-q", "-u", "origin", "b")
	other := t.TempDir()
	runGitQueue(t, other, "clone", "-q", origin, ".")
	runGitQueue(t, other, "checkout", "-q", "b")
	writeQueueFile(t, other, "b.txt", "1\nfrom other clone\n")
	runGitQueue(t, other, "commit", "-q", "-am", "b commit 2 from elsewhere")
	runGitQueue(t, other, "push", "-q", "origin", "b")
	writeQueueFile(t, wtB, "b.txt", "1\nrewritten locally too\n")
	runGitQueue(t, wtB, "commit", "-q", "-am", "b commit 1 rewritten locally")

	h.addTask("Ta", "task", branchSpec{id: "ba", repo: "r", name: "a", kind: "mine"})
	h.addTask("Tb", "task", branchSpec{id: "bb", repo: "r", name: "b", kind: "mine"})

	ctx := context.Background()
	resA, err := h.board.ForcePush(ctx, "ba")
	if err != nil {
		t.Fatal(err)
	}
	if resA.Error != nil {
		t.Fatalf("force push a = %+v, want ok", resA.Error)
	}
	resB, err := h.board.ForcePush(ctx, "bb")
	if err != nil {
		t.Fatal(err)
	}
	if resB.Error == nil {
		t.Fatal("force push b succeeded, want a stale-lease rejection")
	}
}
