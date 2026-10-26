package reviewflow_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

func call[T any](t *testing.T, gs *flowharness.GitStream, method string, params any) T {
	t.Helper()
	var out T
	gs.MustRequest(method, params, &out)
	return out
}

func openRepo(t *testing.T, gs *flowharness.GitStream, dir string) string {
	t.Helper()
	res := call[gitrpc.RepoOpenResult](t, gs, "repo.open", gitrpc.RepoOpenParams{Path: dir})
	if res.Kind != "ok" || res.Repo == nil {
		t.Fatalf("repo.open %s = %+v", dir, res)
	}
	return res.Repo.RepoID
}

// A reviewer's work on one branch: diff, mark, snapshot, comment, relaunch, clear. review.session.*
// and review.open are answered by the renderer, not the Go router, so they are not here.
func TestReviewSessionRoundTrip(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo := app.NewRepo("proj")
	repo.Commit("base", map[string]string{"edit.txt": "one\ntwo\nthree\n"})
	repo.Git("checkout", "-q", "-b", "feat")
	tip := repo.Commit("edit", map[string]string{"edit.txt": "one\nTWO\nthree\n"})
	repo.Checkout("main")
	id := openRepo(t, gs, repo.Dir)
	diff := gitrpc.ReviewFileDiffParams{RepoID: id, Branch: "feat", Base: "main", Path: "edit.txt", Mode: "range"}

	first := call[gitsession.ReviewFileDiffResult](t, gs, "review.fileDiff", diff)
	if first.Path != "edit.txt" || first.ReviewedAtSHA != nil || first.Body.Kind == "" || len(first.ReviewedRanges) != 0 {
		t.Fatalf("range diff before any mark = %+v", first)
	}
	if snap := call[gitsession.ReviewSnapshotResult](t, gs, "review.snapshot", gitrpc.ReviewSnapshotParams{RepoID: id, Branch: "feat", Path: "edit.txt"}); snap.Kind != "none" {
		t.Fatalf("snapshot before any mark = %+v, want none", snap)
	}
	call[gitrpc.ReviewMarkResult](t, gs, "review.mark", gitrpc.ReviewMarkParams{RepoID: id, Branch: "feat", Path: "edit.txt", Reviewed: true})
	snap := call[gitsession.ReviewSnapshotResult](t, gs, "review.snapshot", gitrpc.ReviewSnapshotParams{RepoID: id, Branch: "feat", Path: "edit.txt"})
	if snap.Kind != "text" || snap.Text == nil || *snap.Text != "one\nTWO\nthree\n" || snap.ReviewedAtSHA == nil || *snap.ReviewedAtSHA != tip {
		t.Fatalf("snapshot after mark = %+v, want the reviewed text at %s", snap, tip)
	}

	// The author keeps working; the snapshot still holds what was reviewed, and sinceReview shows only the new change.
	repo.Checkout("feat")
	newTip := repo.Commit("more", map[string]string{"edit.txt": "one\nTWO\nthree\nfour\n"})
	repo.Checkout("main")
	since := diff
	since.Mode = "sinceReview"
	delta := call[gitsession.ReviewFileDiffResult](t, gs, "review.fileDiff", since)
	if delta.ReviewedAtSHA == nil || *delta.ReviewedAtSHA != tip {
		t.Fatalf("sinceReview diff = %+v, want it based on %s", delta, tip)
	}
	if snap2 := call[gitsession.ReviewSnapshotResult](t, gs, "review.snapshot", gitrpc.ReviewSnapshotParams{RepoID: id, Branch: "feat", Path: "edit.txt"}); snap2.Text == nil || strings.Contains(*snap2.Text, "four") {
		t.Fatalf("snapshot moved with the branch: %+v", snap2)
	}
	if wireErrCode(gs, "review.fileDiff", gitrpc.ReviewFileDiffParams{RepoID: id, Branch: "feat", Base: "main", Path: "edit.txt", Mode: "nope"}) == "" {
		t.Fatal("review.fileDiff accepted an unknown mode")
	}

	for _, body := range []string{"why TWO?", "and four?"} {
		call[gitrpc.ReviewCommentAddResult](t, gs, "review.comment.add", gitrpc.ReviewCommentAddParams{
			RepoID: id, Branch: "feat", Path: "edit.txt", At: newTip, Range: gitreview.LineRange{Start: 2, End: 2}, Body: body,
		})
	}

	// A relaunch keeps the marks, snapshot and comments, which live in the review database.
	gs.Close()
	app.Restart()
	gs = app.OpenGitStream()
	id = openRepo(t, gs, repo.Dir)
	list := call[gitsession.CommentListResult](t, gs, "review.comment.list", gitrpc.ReviewCommentListParams{RepoID: id, Branch: "feat"})
	app.Contract(t, "git-review", "git:review.comment.list#after-restart", list, flowharness.Mask("at", "createdAt", "anchorSha"))
	if len(list.Comments) != 2 {
		t.Fatalf("comments after restart = %+v, want 2", list.Comments)
	}
	app.Contract(t, "git-review", "git:review.fileDiff#range", first, flowharness.Mask("baseSha", "headSha", "body"))
	if snap3 := call[gitsession.ReviewSnapshotResult](t, gs, "review.snapshot", gitrpc.ReviewSnapshotParams{RepoID: id, Branch: "feat", Path: "edit.txt"}); snap3.Kind != "text" {
		t.Fatalf("snapshot after restart = %+v", snap3)
	}
	if cleared := call[gitrpc.ReviewCommentClearResult](t, gs, "review.comment.clear", gitrpc.ReviewCommentClearParams{RepoID: id, Branch: "feat"}); cleared.Removed != 2 {
		t.Fatalf("clear removed %d, want 2", cleared.Removed)
	}
	if list = call[gitsession.CommentListResult](t, gs, "review.comment.list", gitrpc.ReviewCommentListParams{RepoID: id, Branch: "feat"}); len(list.Comments) != 0 {
		t.Fatalf("comments after clear = %+v", list.Comments)
	}
	if cleared := call[gitrpc.ReviewCommentClearResult](t, gs, "review.comment.clear", gitrpc.ReviewCommentClearParams{RepoID: id, Branch: "feat"}); cleared.Removed != 0 {
		t.Fatalf("second clear removed %d, want 0", cleared.Removed)
	}
}

// A one-line edit in a 200-line file: the diff carries one hunk, not the file; the UI shows only that hunk.
func TestReviewDiffLargeFileHunks(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo := app.NewRepo("proj")
	lines := make([]string, 200)
	for i := range lines {
		lines[i] = fmt.Sprintf("line %d", i+1)
	}
	base := repo.Commit("base", map[string]string{"big.txt": strings.Join(lines, "\n") + "\n"})
	repo.Git("checkout", "-q", "-b", "feat")
	lines[99] = "CHANGED 100"
	tip := repo.Commit("edit", map[string]string{"big.txt": strings.Join(lines, "\n") + "\n"})
	repo.Checkout("main")
	id := openRepo(t, gs, repo.Dir)

	left := call[gitsession.BlobResult](t, gs, "file.read", gitrpc.FileReadParams{RepoID: id, Rev: base, Path: "big.txt"})
	right := call[gitsession.BlobResult](t, gs, "file.read", gitrpc.FileReadParams{RepoID: id, Rev: tip, Path: "big.txt"})
	if left.Kind != "found" || right.Kind != "found" || strings.Split(right.Content, "\n")[99] != "CHANGED 100" {
		t.Fatalf("file.read left = %q, right = %q; want found sides with line 100 changed", left.Kind, right.Kind)
	}
	diff := call[gitsession.ReviewFileDiffResult](t, gs, "review.fileDiff", gitrpc.ReviewFileDiffParams{RepoID: id, Branch: "feat", Base: "main", Path: "big.txt", Mode: "range"})
	if diff.Body.Kind != "text" || len(diff.Body.Hunks) != 1 || diff.LineCount != 200 {
		t.Fatalf("range diff = kind %q, %d hunks, %d lines; want text, 1 hunk, 200 lines", diff.Body.Kind, len(diff.Body.Hunks), diff.LineCount)
	}
	if h := diff.Body.Hunks[0]; h.NewStart > 100 || h.NewStart+h.NewLines <= 100 {
		t.Fatalf("hunk = %+v, want it to cover line 100", h)
	}
	app.Contract(t, "git-review-hunks", "git:file.read#left", left)
	app.Contract(t, "git-review-hunks", "git:file.read#right", right)
	app.Contract(t, "git-review-hunks", "git:review.fileDiff#range", diff, flowharness.Mask("baseSha", "headSha"))
}

func wireErrCode(gs *flowharness.GitStream, method string, params any) string {
	return flowharness.ErrorCode(gs.Request(method, params, nil))
}
