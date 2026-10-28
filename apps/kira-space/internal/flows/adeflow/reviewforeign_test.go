package adeflow_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

// ghArgsFor is the argv of the recorded gh call whose args hold needle.
func ghArgsFor(t *testing.T, app *flowharness.App, needle string) string {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(app.FakeDir, "gh-*.args"))
	for _, f := range files {
		if raw, err := os.ReadFile(f); err == nil && strings.Contains(string(raw), needle) {
			return string(raw)
		}
	}
	t.Fatalf("no gh call with %q", needle)
	return ""
}

// Contract ade-review-foreign: tests/ui/ade-v2-review.spec.ts reads these.
func TestReviewForeignChangeRequest(t *testing.T) {
	f := newHostLinkFixture(t, false)
	app := f.app
	const scenario = "ade-review-foreign"
	openTarget := func(url string) adewire.ReviewWindowTarget {
		t.Helper()
		added, err := app.W.AdeTask.AddHostLink(ctx, adewire.HostLinkArgs{URL: url})
		if err != nil {
			t.Fatal(err)
		}
		br := branchOf(t, board(t, app), added.Task.ID, f.repoID)
		if opened, err := app.W.AdeTask.OpenReviewWindow(ctx, adewire.BranchArgs{BranchID: br.ID}); err != nil || !opened {
			t.Fatalf("OpenReviewWindow = %v, %v", opened, err)
		}
		key := app.WindowMgr.Opened[len(app.WindowMgr.Opened)-1].Key
		tgt, err := app.W.AdeTask.ReviewWindowTarget(ctx, adewire.WindowKeyArgs{WindowKey: key})
		if err != nil || tgt == nil {
			t.Fatalf("ReviewWindowTarget = %+v, %v", tgt, err)
		}
		return *tgt
	}
	targetMask := []flowharness.ContractOption{flowharness.Mask("taskId", "branchId", "codeRepoId", "gitRepoId", "worktree")}

	// A fork PR: the task's link names the number, the local branch has no host-side name.
	fork := openTarget("https://github.com/acme/api/pull/12")
	if fork.Branch != "forker/main" || fork.ChangeRequest != 12 {
		t.Fatalf("fork target = %+v, want forker/main with change request 12", fork)
	}
	app.Contract(t, scenario, "AdeTaskService.ReviewWindowTarget#fork", fork, targetMask...)

	gs := app.OpenGitStream()
	var opened gitrpc.RepoOpenResult
	gs.MustRequest("repo.open", gitrpc.RepoOpenParams{Path: f.clone.Dir}, &opened)
	if opened.Kind != "ok" || opened.Repo == nil || opened.Repo.RepoID != fork.GitRepoID {
		t.Fatalf("repo.open = %+v, want repo %s", opened, fork.GitRepoID)
	}
	repoID := opened.Repo.RepoID
	sha := flowharness.Replace(f.forkTip, strings.Repeat("a", 40))
	state := func(params gitrpc.ChangeRequestReviewStateParams) gitrpc.ChangeRequestReviewStateResult {
		t.Helper()
		var out gitrpc.ChangeRequestReviewStateResult
		gs.MustRequest("changeRequest.reviewState", params, &out)
		return out
	}

	got := state(gitrpc.ChangeRequestReviewStateParams{RepoID: repoID, Branch: "forker/main", Number: 12})
	rv := got.ChangeRequestReview
	if got.Kind != "ok" || rv == nil || rv.Number != 12 || rv.Title != "Fork change" || rv.Author != "sara" ||
		rv.Viewer != "octocat" || rv.Own || rv.HeadSha != f.forkTip || rv.LocalHeadSha != f.forkTip {
		t.Fatalf("fork reviewState = %+v / %+v", got, rv)
	}
	app.Contract(t, scenario, "git:changeRequest.reviewState#fork", got, sha)
	if none := state(gitrpc.ChangeRequestReviewStateParams{RepoID: repoID, Branch: "forker/main"}); none.Kind != "none" {
		t.Fatalf("fork reviewState without number = %+v, want none", none)
	}

	var posted gitrpc.ChangeRequestPostResult
	gs.MustRequest("changeRequest.submitReview", gitrpc.ChangeRequestSubmitReviewParams{
		RepoID: repoID, Number: 12, Event: githost.ReviewApprove, HeadSha: f.forkTip,
	}, &posted)
	if posted.Kind != "ok" {
		t.Fatalf("submitReview = %+v", posted)
	}
	args := ghArgsFor(t, app, "pulls/12/reviews")
	if !strings.Contains(args, "event=APPROVE") || !strings.Contains(args, "commit_id="+f.forkTip) || strings.Contains(args, "body=") {
		t.Fatalf("review args = %q", args)
	}
	app.Contract(t, scenario, "git:changeRequest.submitReview#fork", posted)

	var commented gitrpc.ChangeRequestPostResult
	gs.MustRequest("changeRequest.comment", gitrpc.ChangeRequestCommentParams{RepoID: repoID, Number: 12, Body: "Looks good, one nit"}, &commented)
	if commented.Kind != "ok" || !strings.Contains(ghArgsFor(t, app, "issues/12/comments"), "body=Looks good, one nit") {
		t.Fatalf("comment = %+v", commented)
	}
	app.Contract(t, scenario, "git:changeRequest.comment#fork", commented)

	// A remote-only branch: no number, the lookup uses the host head name.
	remote := openTarget("https://github.com/acme/api/tree/feat/x")
	if remote.Branch != "origin/feat/x" || remote.ChangeRequest != 0 {
		t.Fatalf("remote target = %+v, want origin/feat/x without a change request", remote)
	}
	app.Contract(t, scenario, "AdeTaskService.ReviewWindowTarget#remote", remote, targetMask...)
	got = state(gitrpc.ChangeRequestReviewStateParams{RepoID: repoID, Branch: "origin/feat/x"})
	rv = got.ChangeRequestReview
	if got.Kind != "ok" || rv == nil || rv.Number != 15 || rv.Author != "sara" || rv.LocalHeadSha != f.xTip {
		t.Fatalf("remote reviewState = %+v / %+v", got, rv)
	}
	app.Contract(t, scenario, "git:changeRequest.reviewState#remote", got, flowharness.Replace(f.xTip, strings.Repeat("b", 40)))

	err := gs.Request("changeRequest.reviewState", gitrpc.ChangeRequestReviewStateParams{RepoID: repoID, Branch: "forker/main", Number: -1}, nil)
	if err == nil || flowharness.ErrorCode(err) == "" {
		t.Fatalf("negative number: err %v, want a contract error", err)
	}
}
