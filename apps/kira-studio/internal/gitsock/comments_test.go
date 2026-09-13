package gitsock

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// §3.4's own end-to-end proof: G13's five new methods over a real socket against real fixture
// repositories — add/list round-tripping, D13's total order, D7's anchor tiers (projected/removed/
// stale), D11's coordinate contract at an explicit `at`, D12's export format asserted byte for
// byte, D11's idempotent/scoped remove, D14's exact clear-all scope, D15's refusals, two
// connections sharing one session's comments, and — the one a future contributor is most likely to
// break — refsChanged NOT dropping comments.

// buildCommentsFixture builds main (a.txt/b.txt, one commit) and feature branched off it with a.txt
// extended by one line — the topology every scenario below starts from before its own mutation.
func buildCommentsFixture(t *testing.T) (dir, mainSha, featureSha string) {
	t.Helper()
	incSkipWithoutGit(t)
	dir = t.TempDir()
	runGitIn(t, dir, "init", "-q", "-b", "main")
	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\n")
	incWriteFile(t, dir, "b.txt", "alpha\nbeta\ngamma\n")
	runGitIn(t, dir, "add", "a.txt", "b.txt")
	mainSha = incCommit(t, dir, "base commit")

	runGitIn(t, dir, "checkout", "-q", "-b", "feature")
	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\nline6\n")
	runGitIn(t, dir, "add", "a.txt")
	featureSha = incCommit(t, dir, "feature commit")
	return dir, mainSha, featureSha
}

func addComment(t *testing.T, c *testClient, repoID, branch, path, at string, r gitreview.LineRange, body string) gitsession.CommentEntry {
	t.Helper()
	resp := requestOK(t, c, "review.comment.add", gitrpc.ReviewCommentAddParams{
		RepoID: repoID, Branch: branch, Path: path, At: at, Range: r, Body: body,
	})
	return unmarshalResult[gitrpc.ReviewCommentAddResult](t, resp.Result).Comment
}

func listComments(t *testing.T, c *testClient, repoID, branch, at string) gitsession.CommentListResult {
	t.Helper()
	resp := requestOK(t, c, "review.comment.list", gitrpc.ReviewCommentListParams{RepoID: repoID, Branch: branch, At: at})
	return unmarshalResult[gitsession.CommentListResult](t, resp.Result)
}

func removeComment(t *testing.T, c *testClient, repoID, branch string, id int64) bool {
	t.Helper()
	resp := requestOK(t, c, "review.comment.remove", gitrpc.ReviewCommentRemoveParams{RepoID: repoID, Branch: branch, ID: id})
	return unmarshalResult[gitrpc.ReviewCommentRemoveResult](t, resp.Result).Removed
}

func clearComments(t *testing.T, c *testClient, repoID, branch string) int {
	t.Helper()
	resp := requestOK(t, c, "review.comment.clear", gitrpc.ReviewCommentClearParams{RepoID: repoID, Branch: branch})
	return unmarshalResult[gitrpc.ReviewCommentClearResult](t, resp.Result).Removed
}

func exportComments(t *testing.T, c *testClient, repoID, branch, at string) gitrpc.ReviewCommentExportResult {
	t.Helper()
	resp := requestOK(t, c, "review.comment.export", gitrpc.ReviewCommentExportParams{RepoID: repoID, Branch: branch, At: at})
	return unmarshalResult[gitrpc.ReviewCommentExportResult](t, resp.Result)
}

// TestIntegration_AddThenListRoundTrips is the round trip itself: three comments across two files,
// every field intact, every anchor "exact" (added and listed at the same revision).
func TestIntegration_AddThenListRoundTrips(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "add-list-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	c1 := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "first note")
	c2 := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 4, End: 4}, "second note")
	c3 := addComment(t, client, repoID, "feature", "b.txt", featureSha, gitreview.LineRange{Start: 1, End: 1}, "third note")

	result := listComments(t, client, repoID, "feature", "")
	if len(result.Comments) != 3 {
		t.Fatalf("len(Comments) = %d, want 3", len(result.Comments))
	}
	want := map[int64]gitsession.CommentEntry{c1.ID: c1, c2.ID: c2, c3.ID: c3}
	for _, got := range result.Comments {
		if got.Anchor != gitreview.AnchorExact {
			t.Fatalf("comment %d anchor = %q, want exact", got.ID, got.Anchor)
		}
		w, ok := want[got.ID]
		if !ok {
			t.Fatalf("unexpected comment id %d in list", got.ID)
		}
		if got.Path != w.Path || got.Range != w.Range || got.Body != w.Body {
			t.Fatalf("comment %d = %+v, want %+v", got.ID, got, w)
		}
	}
}

// TestIntegration_CommentsAreOrderedByFileThenLine is D13's whole claim: added deliberately out of
// order, the returned order is (path, start, end, created_at, id), and two comments on identical
// ranges come back in created_at (then id) order.
func TestIntegration_CommentsAreOrderedByFileThenLine(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "order-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	cB := addComment(t, client, repoID, "feature", "b.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "on b")
	cA2 := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 4, End: 4}, "a line 4")
	cA1First := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 1, End: 1}, "a line 1, first")
	cA1Second := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 1, End: 1}, "a line 1, second")

	result := listComments(t, client, repoID, "feature", "")
	wantIDs := []int64{cA1First.ID, cA1Second.ID, cA2.ID, cB.ID}
	if len(result.Comments) != len(wantIDs) {
		t.Fatalf("len(Comments) = %d, want %d", len(result.Comments), len(wantIDs))
	}
	for i, w := range wantIDs {
		if result.Comments[i].ID != w {
			var gotIDs []int64
			for _, c := range result.Comments {
				gotIDs = append(gotIDs, c.ID)
			}
			t.Fatalf("ids = %v, want %v (path, then line, then created_at)", gotIDs, wantIDs)
		}
	}
}

// TestIntegration_CommentAnchorsProjectForward is D7 tier 1's own end-to-end proof, both outcomes:
// five lines inserted above a comment shift it forward (projected); the commented line deleted
// outright reports the stored range unchanged (removed).
func TestIntegration_CommentAnchorsProjectForward(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "project-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	projected := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 3, End: 3}, "on line3")
	removed := addComment(t, client, repoID, "feature", "b.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "on beta")

	incWriteFile(t, dir, "a.txt", "x1\nx2\nx3\nx4\nx5\nline1\nline2\nline3\nline4\nline5\nline6\n")
	incWriteFile(t, dir, "b.txt", "alpha\ngamma\n")
	runGitIn(t, dir, "add", "a.txt", "b.txt")
	incCommit(t, dir, "insert above a.txt, delete a line from b.txt")
	waitForRefsChanged(t, client)

	result := listComments(t, client, repoID, "feature", "")
	byID := make(map[int64]gitsession.CommentEntry, len(result.Comments))
	for _, c := range result.Comments {
		byID[c.ID] = c
	}

	got, ok := byID[projected.ID]
	if !ok {
		t.Fatal("the projected comment is missing from the list")
	}
	if got.Anchor != gitreview.AnchorProjected {
		t.Fatalf("Anchor = %q, want projected", got.Anchor)
	}
	if got.Range != (gitreview.LineRange{Start: 8, End: 8}) {
		t.Fatalf("Range = %+v, want {8 8} (shifted by five)", got.Range)
	}

	got, ok = byID[removed.ID]
	if !ok {
		t.Fatal("the removed comment is missing from the list")
	}
	if got.Anchor != gitreview.AnchorRemoved {
		t.Fatalf("Anchor = %q, want removed", got.Anchor)
	}
	if got.Range != (gitreview.LineRange{Start: 2, End: 2}) {
		t.Fatalf("Range = %+v, want the stored {2 2}", got.Range)
	}
}

// TestIntegration_CommentSurvivesAnAmendAsStale is D7 tier 2's own proof over the socket: the
// anchor commit is amended away (present but unreachable), and the comment survives, marked stale,
// with its original range and sha.
func TestIntegration_CommentSurvivesAnAmendAsStale(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "amend-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	c := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "note")

	incWriteFile(t, dir, "a.txt", "line1\nline2\nline3\nline4\nline5\nline6-changed\n")
	runGitIn(t, dir, "add", "a.txt")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "--amend", "-q", "-m", "amended")
	waitForRefsChanged(t, client)

	result := listComments(t, client, repoID, "feature", "")
	if len(result.Comments) != 1 {
		t.Fatalf("len(Comments) = %d, want 1", len(result.Comments))
	}
	got := result.Comments[0]
	if got.ID != c.ID {
		t.Fatalf("ID = %d, want %d", got.ID, c.ID)
	}
	if got.Anchor != gitreview.AnchorStale {
		t.Fatalf("Anchor = %q, want stale", got.Anchor)
	}
	if got.Range != (gitreview.LineRange{Start: 2, End: 2}) {
		t.Fatalf("Range = %+v, want the stored {2 2}", got.Range)
	}
	if got.AnchorSHA != featureSha {
		t.Fatalf("AnchorSHA = %q, want the original %q", got.AnchorSHA, featureSha)
	}
}

// TestIntegration_ListAtAnExplicitRevision is D11's coordinate contract: listing at an explicit
// (older) `at` reports exact against THAT revision — and echoes it back — even while the tip has
// since changed the very line the comment is about, twice over.
func TestIntegration_ListAtAnExplicitRevision(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "explicit-at-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	c := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "note")

	incWriteFile(t, dir, "a.txt", "line1\nline2-changed\nline3\nline4\nline5\nline6\n")
	runGitIn(t, dir, "add", "a.txt")
	incCommit(t, dir, "change line 2")
	waitForRefsChanged(t, client)

	incWriteFile(t, dir, "a.txt", "line1\nline2-changed-again\nline3\nline4\nline5\nline6\n")
	runGitIn(t, dir, "add", "a.txt")
	incCommit(t, dir, "change line 2 again")
	waitForRefsChanged(t, client)

	result := listComments(t, client, repoID, "feature", featureSha)
	if result.At != featureSha {
		t.Fatalf("At = %q, want the requested %q, not the tip", result.At, featureSha)
	}
	if len(result.Comments) != 1 {
		t.Fatalf("len(Comments) = %d, want 1", len(result.Comments))
	}
	got := result.Comments[0]
	if got.ID != c.ID {
		t.Fatalf("ID = %d, want %d", got.ID, c.ID)
	}
	if got.Anchor != gitreview.AnchorExact {
		t.Fatalf("Anchor = %q, want exact", got.Anchor)
	}
}

// TestIntegration_ExportIsExactlyThisText is D12's whole format, in one assertion: a two-file,
// three-comment session — two comments on a.txt (untouched by the amend below, so tier 0 keeps
// them exact even though their anchor sha becomes unreachable) and one on b.txt (which the amend
// DOES touch, going stale) — compared byte for byte against a hand-built literal.
func TestIntegration_ExportIsExactlyThisText(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "export-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	addComment(t, client, repoID, "feature", "a.txt", featureSha,
		gitreview.LineRange{Start: 2, End: 4}, "Line one of note.\nLine two of note.")
	addComment(t, client, repoID, "feature", "a.txt", featureSha,
		gitreview.LineRange{Start: 6, End: 6}, "Single line comment.")
	addComment(t, client, repoID, "feature", "b.txt", featureSha,
		gitreview.LineRange{Start: 1, End: 1}, "This will go stale.")

	incWriteFile(t, dir, "b.txt", "alpha-changed\nbeta\ngamma\n")
	runGitIn(t, dir, "add", "b.txt")
	runGitIn(t, dir, "-c", "commit.gpgsign=false", "commit", "--amend", "-q", "-m", "amended")
	waitForRefsChanged(t, client)

	result := exportComments(t, client, repoID, "feature", "")

	sha8 := featureSha[:8]
	want := "Review comments — feature (3 comments)\n\n" +
		"a.txt:2-4\n" +
		"  Line one of note.\n" +
		"  Line two of note.\n" +
		"\n" +
		"a.txt:6\n" +
		"  Single line comment.\n" +
		"\n" +
		"b.txt:1  [lines as of " + sha8 + "; feature's history was rewritten since]\n" +
		"  This will go stale.\n"

	if result.Text != want {
		t.Fatalf("export text =\n%q\nwant\n%q", result.Text, want)
	}
}

// TestIntegration_ExportIsEmptyWithNoComments is D11's own explicit rule: "" for a session with no
// comments, never a header-only placeholder.
func TestIntegration_ExportIsEmptyWithNoComments(t *testing.T) {
	t.Parallel()
	dir, _, _ := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "export-empty-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	result := exportComments(t, client, repoID, "feature", "")
	if result.Text != "" {
		t.Fatalf("Text = %q, want empty", result.Text)
	}
}

// TestIntegration_RemoveIsScopedAndIdempotent is D11's own rule: an id from a DIFFERENT (repo,
// branch) session's own review matches nothing when presented against a different session, and
// removing the same id twice answers true then false.
func TestIntegration_RemoveIsScopedAndIdempotent(t *testing.T) {
	t.Parallel()
	dir, mainSha, featureSha := buildCommentsFixture(t)
	runGitIn(t, dir, "checkout", "-q", "-b", "other", mainSha)

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "remove-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	onFeature := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "on feature")
	onOther := addComment(t, client, repoID, "other", "a.txt", mainSha, gitreview.LineRange{Start: 1, End: 1}, "on other")

	if removeComment(t, client, repoID, "feature", onOther.ID) {
		t.Fatal("removing another session's own id succeeded — should have matched nothing")
	}
	stillThere := listComments(t, client, repoID, "other", "")
	if len(stillThere.Comments) != 1 || stillThere.Comments[0].ID != onOther.ID {
		t.Fatalf("other's own comment was affected by a cross-session remove: %+v", stillThere.Comments)
	}

	if !removeComment(t, client, repoID, "feature", onFeature.ID) {
		t.Fatal("the first remove of onFeature should have removed it")
	}
	if removeComment(t, client, repoID, "feature", onFeature.ID) {
		t.Fatal("the second remove of the same id should answer false, not remove anything")
	}
}

// TestIntegration_ClearRemovesOnlyComments is D14's exact scope: comments gone, review_file/
// review_range (the "full" mark) and the session row itself untouched — a subsequent add reuses
// the surviving session rather than erroring.
func TestIntegration_ClearRemovesOnlyComments(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "clear-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	markFile(t, client, repoID, "feature", "a.txt", true, nil)
	addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "note one")
	addComment(t, client, repoID, "feature", "b.txt", featureSha, gitreview.LineRange{Start: 1, End: 1}, "note two")

	removed := clearComments(t, client, repoID, "feature")
	if removed != 2 {
		t.Fatalf("clear removed = %d, want 2", removed)
	}

	result := listComments(t, client, repoID, "feature", "")
	if len(result.Comments) != 0 {
		t.Fatalf("Comments after clear = %v, want none", result.Comments)
	}

	files := reviewFiles(t, client, repoID, "feature", "main")
	entry, ok := findEntry(files.Files, "a.txt")
	if !ok || entry.Review.Kind != "full" {
		t.Fatalf("a.txt review status after clear = %+v, want still full (clear is comments-only)", entry.Review)
	}

	added := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 3, End: 3}, "after clear")
	if added.ID == 0 {
		t.Fatal("add after clear did not return a real id — the session row should have survived clear")
	}
}

// TestIntegration_CommentRefusals is D15's own validation rules, each an E_BAD_REQUEST naming what
// was wrong, and none of them reaching a spawn it should not.
func TestIntegration_CommentRefusals(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	if err := os.WriteFile(filepath.Join(dir, "img.bin"), []byte{0x89, 'P', 'N', 'G', 0x00, 0x01}, 0o644); err != nil {
		t.Fatalf("write img.bin: %v", err)
	}
	runGitIn(t, dir, "add", "img.bin")
	binSha := incCommit(t, dir, "add binary")

	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "refusals-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	base := gitrpc.ReviewCommentAddParams{
		RepoID: repoID, Branch: "feature", Path: "a.txt", At: featureSha,
		Range: gitreview.LineRange{Start: 1, End: 1}, Body: "ok",
	}

	whitespaceOnly := base
	whitespaceOnly.Body = "   "
	assertBadRequest(t, client.request("review.comment.add", whitespaceOnly), "body")

	tooLong := base
	tooLong.Body = strings.Repeat("a", (8<<10)+1)
	assertBadRequest(t, client.request("review.comment.add", tooLong), "body")

	badAt := base
	badAt.At = "not-a-sha"
	assertBadRequest(t, client.request("review.comment.add", badAt), "hex object id")

	badRange := base
	badRange.Range = gitreview.LineRange{Start: 5, End: 2}
	assertBadRequest(t, client.request("review.comment.add", badRange), "range")

	pastEOF := base
	pastEOF.Range = gitreview.LineRange{Start: 100, End: 100}
	assertBadRequest(t, client.request("review.comment.add", pastEOF), "past the end")

	binary := base
	binary.Path = "img.bin"
	binary.At = binSha
	assertBadRequest(t, client.request("review.comment.add", binary), "text file")

	evilBranch := base
	evilBranch.Branch = "-evil"
	assertBadRequest(t, client.request("review.comment.add", evilBranch), "branch")

	// review.comment.add itself never resolves `branch` against the ref snapshot — anchoring runs
	// entirely against the caller-supplied `at`, and the session key is a plain string pair (D4).
	// A nonexistent branch IS refused where the wire actually needs to resolve one: `at` omitted on
	// list/export, which falls back to the branch tip (D11) and hits G11's own ErrBranchNotFound.
	resp := client.request("review.comment.list", gitrpc.ReviewCommentListParams{RepoID: repoID, Branch: "no-such-branch"})
	assertBadRequest(t, resp, "branch")
}

// TestIntegration_TwoConnectionsShareComments is G11 D12's shared-state model, extended: a comment
// added on connection A is visible in connection B's next list, and B's remove of it is visible to
// A.
func TestIntegration_TwoConnectionsShareComments(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA := pairAndReady(t, server, sockPath, "comments-shared-a")
	clientB := pairAndReady(t, server, sockPath, "comments-shared-b")
	repoIDA := openRepoOK(t, clientA, dir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, dir).Repo.RepoID
	if repoIDA != repoIDB {
		t.Fatalf("repoID differs between connections: %q vs %q", repoIDA, repoIDB)
	}

	added := addComment(t, clientA, repoIDA, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "from A")

	listB := listComments(t, clientB, repoIDB, "feature", "")
	if len(listB.Comments) != 1 || listB.Comments[0].ID != added.ID {
		t.Fatalf("connection B's list = %+v, want the comment connection A added", listB.Comments)
	}

	if !removeComment(t, clientB, repoIDB, "feature", added.ID) {
		t.Fatal("connection B's remove of A's comment should have succeeded")
	}
	listA := listComments(t, clientA, repoIDA, "feature", "")
	if len(listA.Comments) != 0 {
		t.Fatalf("connection A's list after B's remove = %+v, want empty", listA.Comments)
	}
}

// TestIntegration_RefsChangedDoesNotDropComments is D16's own negative claim, and the one a future
// contributor is most likely to break: force-moving an UNRELATED branch fires refsChanged, and
// every comment is still there afterward.
func TestIntegration_RefsChangedDoesNotDropComments(t *testing.T) {
	t.Parallel()
	dir, _, featureSha := buildCommentsFixture(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "refschanged-comments-client")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	added := addComment(t, client, repoID, "feature", "a.txt", featureSha, gitreview.LineRange{Start: 2, End: 2}, "note")

	runGitIn(t, dir, "branch", "unrelated-branch")
	ev := client.recvEvent("repo.changed")
	if ev.Kind != "refsChanged" {
		t.Fatalf("event = %+v, want refsChanged", ev)
	}

	result := listComments(t, client, repoID, "feature", "")
	if len(result.Comments) != 1 || result.Comments[0].ID != added.ID {
		t.Fatalf("a comment disappeared after an unrelated refsChanged: %+v", result.Comments)
	}
}
