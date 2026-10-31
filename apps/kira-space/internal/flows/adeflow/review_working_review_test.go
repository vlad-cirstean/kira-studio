package adeflow_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// Backend half of reviewing uncommitted work: marks and comments on worktree content, projection
// through later edits, and promotion onto the commit. Frontend half: tests/ui/ade-v2-review-working.spec.ts
// reads the ade-review-working-review contract.
func TestReviewWorkingReview(t *testing.T) {
	f, br := doneFixture(t, "feat/api-working-review")
	app, wt := f.app, br.Worktree
	writeIn(t, wt, "base.txt", "a\nb\nc\nd\ne\n")
	gitOut(t, wt, "add", "-A")
	gitOut(t, wt, "commit", "-q", "-m", "add base.txt")
	writeIn(t, wt, "base.txt", "a\nb\nC!\nd\ne\n")

	if _, err := app.W.AdeTask.OpenReviewWindow(ctx, adewire.BranchArgs{BranchID: br.ID}); err != nil {
		t.Fatal(err)
	}
	rec := app.WindowMgr.Opened[len(app.WindowMgr.Opened)-1]
	tgt, err := app.W.AdeTask.ReviewWindowTarget(ctx, adewire.WindowKeyArgs{WindowKey: rec.Key})
	if err != nil || tgt == nil {
		t.Fatalf("ReviewWindowTarget = %+v, %v", tgt, err)
	}

	const contract = "ade-review-working-review"
	fileArgs := adewire.ReviewWorkingDiffArgs{BranchID: br.ID, Path: "base.txt"}
	app.Contract(t, contract, "args:AdeTaskService.ReviewWorkingFile", fileArgs)
	file, err := app.W.AdeTask.ReviewWorkingFile(ctx, fileArgs)
	if err != nil {
		t.Fatal(err)
	}
	if file.Body.Kind != porcelain.BodyText || len(file.Body.Hunks) != 1 || len(file.ReviewedRanges) != 0 || file.LineCount != 5 {
		t.Fatalf("file review = %+v, want one hunk and nothing reviewed", file)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingFile#unreviewed", file)

	shown, err := app.W.AdeTask.ReviewWorkingDiff(ctx, fileArgs)
	if err != nil || shown.ContentHash == "" {
		t.Fatalf("diff = %+v, %v, want a content hash", shown, err)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingDiff", shown)
	staleArgs := adewire.ReviewWorkingMarkArgs{
		BranchID: br.ID, Paths: []string{"base.txt"}, Reviewed: true, Ranges: []gitreview.LineRange{{Start: 3, End: 3}},
		ContentHashes: map[string]string{"base.txt": "stale"},
	}
	_, err = app.W.AdeTask.ReviewWorkingMark(ctx, staleArgs)
	if errCode(err) != "E_CONFLICT" {
		t.Fatalf("mark on changed content = %v, want E_CONFLICT", err)
	}
	app.Contract(t, contract, "error:AdeTaskService.ReviewWorkingMark#changed", err.Error())
	if _, err := app.W.AdeTask.ReviewWorkingCommentAdd(ctx, adewire.ReviewWorkingCommentAddArgs{
		BranchID: br.ID, Path: "base.txt", Range: gitreview.LineRange{Start: 3, End: 3}, Body: "x", Kind: "change", ContentHash: "stale",
	}); errCode(err) != "E_CONFLICT" {
		t.Fatalf("comment on changed content = %v, want E_CONFLICT", err)
	}
	markArgs := adewire.ReviewWorkingMarkArgs{
		BranchID: br.ID, Paths: []string{"base.txt"}, Reviewed: true, Ranges: []gitreview.LineRange{{Start: 3, End: 3}}, ContentHashes: map[string]string{"base.txt": shown.ContentHash},
	}
	app.Contract(t, contract, "args:AdeTaskService.ReviewWorkingMark", markArgs)
	marked, err := app.W.AdeTask.ReviewWorkingMark(ctx, markArgs)
	if err != nil || len(marked.Files) != 1 || marked.Files[0].Review.Kind != "partial" {
		t.Fatalf("mark = %+v, %v, want partial", marked, err)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingMark", marked, flowharness.Mask("reviewedAt", "reviewedAtSha"))
	if file, err = app.W.AdeTask.ReviewWorkingFile(ctx, fileArgs); err != nil || !reflect.DeepEqual(file.ReviewedRanges, []gitreview.LineRange{{Start: 3, End: 3}}) {
		t.Fatalf("reviewed ranges = %+v, %v", file.ReviewedRanges, err)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingFile#reviewed", file)

	if _, err := app.W.AdeTask.ReviewWorkingMark(ctx, adewire.ReviewWorkingMarkArgs{BranchID: br.ID, Paths: []string{"a", "b"}, Ranges: []gitreview.LineRange{{Start: 1, End: 1}}}); errCode(err) == "" {
		t.Fatal("ranges over two paths must be refused")
	}

	working, err := app.W.AdeTask.ReviewWorking(ctx, adewire.BranchArgs{BranchID: br.ID})
	if err != nil || working.Reviews["base.txt"].Kind != "partial" || len(working.Promoted) != 0 {
		t.Fatalf("ReviewWorking = %+v, %v, want partial base.txt and nothing promoted", working, err)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorking", working,
		flowharness.Mask("head", "reviewedAt", "reviewedAtSha"), flowharness.Replace(wt, "<worktree>"))

	// A list mark guards every path: one stale hash refuses the whole call and marks nothing.
	if working.ContentHashes["base.txt"] != shown.ContentHash {
		t.Fatalf("list hash = %q, want the diff's %q", working.ContentHashes["base.txt"], shown.ContentHash)
	}
	writeIn(t, wt, "fresh.txt", "new\n")
	listHashes, err := app.W.AdeTask.ReviewWorking(ctx, adewire.BranchArgs{BranchID: br.ID})
	if err != nil || listHashes.ContentHashes["fresh.txt"] == "" {
		t.Fatalf("list hashes = %+v, %v, want a hash for fresh.txt", listHashes.ContentHashes, err)
	}
	if _, err := app.W.AdeTask.ReviewWorkingMark(ctx, adewire.ReviewWorkingMarkArgs{
		BranchID: br.ID, Paths: []string{"fresh.txt", "base.txt"}, Reviewed: true,
		ContentHashes: map[string]string{"fresh.txt": listHashes.ContentHashes["fresh.txt"], "base.txt": "stale"},
	}); errCode(err) != "E_CONFLICT" {
		t.Fatalf("list mark with a stale hash = %v, want E_CONFLICT", err)
	}
	if after, err := app.W.AdeTask.ReviewWorking(ctx, adewire.BranchArgs{BranchID: br.ID}); err != nil || after.Reviews["fresh.txt"].Kind != "none" || after.Reviews["base.txt"].Kind != "partial" {
		t.Fatalf("after refused list mark = %+v, %v, want nothing marked", after.Reviews, err)
	}
	if err := os.Remove(filepath.Join(wt, "fresh.txt")); err != nil {
		t.Fatal(err)
	}

	addArgs := adewire.ReviewWorkingCommentAddArgs{
		BranchID: br.ID, Path: "base.txt", Range: gitreview.LineRange{Start: 3, End: 3}, Body: "why bang?", Kind: "question", ContentHash: shown.ContentHash,
	}
	app.Contract(t, contract, "args:AdeTaskService.ReviewWorkingCommentAdd", addArgs)
	added, err := app.W.AdeTask.ReviewWorkingCommentAdd(ctx, addArgs)
	if err != nil || added.Origin != "working" || added.Anchor != gitreview.AnchorExact {
		t.Fatalf("comment add = %+v, %v", added, err)
	}
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingCommentAdd", added, flowharness.Mask("id", "createdAt", "anchorSha"))
	if _, err := app.W.AdeTask.ReviewWorkingCommentAdd(ctx, adewire.ReviewWorkingCommentAddArgs{
		BranchID: br.ID, Path: "base.txt", Range: gitreview.LineRange{Start: 9, End: 9}, Body: "x", Kind: "change",
	}); errCode(err) != "E_BAD_REQUEST" {
		t.Fatalf("comment past the end = %v, want E_BAD_REQUEST", err)
	}

	// An edit above shifts both the mark and the comment down; an edit inside would reopen them.
	writeIn(t, wt, "base.txt", "top\na\nb\nC!\nd\ne\n")
	if file, err = app.W.AdeTask.ReviewWorkingFile(ctx, fileArgs); err != nil || !reflect.DeepEqual(file.ReviewedRanges, []gitreview.LineRange{{Start: 4, End: 4}}) {
		t.Fatalf("shifted ranges = %+v, %v, want 4", file.ReviewedRanges, err)
	}
	listed, err := app.W.AdeTask.ReviewWorkingComments(ctx, adewire.BranchArgs{BranchID: br.ID})
	if err != nil || len(listed.Comments) != 1 || listed.Comments[0].Anchor != gitreview.AnchorProjected || listed.Comments[0].Range.Start != 4 {
		t.Fatalf("shifted comments = %+v, %v, want projected at 4", listed, err)
	}
	app.Contract(t, contract, "args:AdeTaskService.ReviewWorkingComments", adewire.BranchArgs{BranchID: br.ID})
	app.Contract(t, contract, "AdeTaskService.ReviewWorkingComments", listed, flowharness.Mask("id", "createdAt", "anchorSha"))

	// Commit: review state moves onto the commit.
	gitOut(t, wt, "add", "-A")
	gitOut(t, wt, "commit", "-q", "-m", "commit the work")
	working, err = app.W.AdeTask.ReviewWorking(ctx, adewire.BranchArgs{BranchID: br.ID})
	if err != nil || !reflect.DeepEqual(working.Promoted, []string{"base.txt"}) || len(working.Files) != 0 {
		t.Fatalf("after commit = %+v, %v, want base.txt promoted", working, err)
	}
	if listed, err = app.W.AdeTask.ReviewWorkingComments(ctx, adewire.BranchArgs{BranchID: br.ID}); err != nil || len(listed.Comments) != 0 {
		t.Fatalf("uncommitted comments after commit = %+v, %v, want none", listed, err)
	}

	gs := app.OpenGitStream()
	var opened gitrpc.RepoOpenResult
	gs.MustRequest("repo.open", gitrpc.RepoOpenParams{Path: filepath.Join(app.Work, "api")}, &opened)
	var diff gitsession.ReviewFileDiffResult
	var comments gitsession.CommentListResult
	deadline := time.Now().Add(10 * time.Second)
	for {
		gs.MustRequest("review.fileDiff", gitrpc.ReviewFileDiffParams{
			RepoID: tgt.GitRepoID, Branch: tgt.Branch, Base: tgt.Base, Path: "base.txt", Mode: "sinceReview",
		}, &diff)
		if len(diff.ReviewedRanges) > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond) // the committed side reads the cached ref snapshot
	}
	if !reflect.DeepEqual(diff.ReviewedRanges, []gitreview.LineRange{{Start: 4, End: 4}}) {
		t.Fatalf("committed reviewed ranges = %+v, want the marked line at 4", diff.ReviewedRanges)
	}
	gs.MustRequest("review.comment.list", gitrpc.ReviewCommentListParams{RepoID: tgt.GitRepoID, Branch: tgt.Branch}, &comments)
	if len(comments.Comments) != 1 || comments.Comments[0].Origin != "commit" || comments.Comments[0].Range.Start != 4 {
		t.Fatalf("committed comments = %+v, want one commit-origin comment at 4", comments.Comments)
	}
}
