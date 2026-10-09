package reviewflow_test

import (
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

func lr(start, end int) gitreview.LineRange { return gitreview.LineRange{Start: start, End: end} }

// Guards the list order: path, then line, then creation, whatever order comments were added in.
func TestCommentsOrderedByFileThenLine(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	id := openRepo(t, gs, repo.Dir)

	b := addComment(t, gs, id, "feature", "b.txt", tip, lr(2, 2), "on b")
	a4 := addComment(t, gs, id, "feature", "a.txt", tip, lr(4, 4), "a line 4")
	a1First := addComment(t, gs, id, "feature", "a.txt", tip, lr(1, 1), "a line 1, first")
	a1Second := addComment(t, gs, id, "feature", "a.txt", tip, lr(1, 1), "a line 1, second")

	var got []int64
	for _, c := range listComments(t, gs, id, "feature") {
		got = append(got, c.ID)
	}
	want := []int64{a1First.ID, a1Second.ID, a4.ID, b.ID}
	if len(got) != len(want) {
		t.Fatalf("ids = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("ids = %v, want %v", got, want)
		}
	}
}

// Guards the export text byte for byte, including a stale anchor note after the branch is amended.
func TestCommentExportText(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	id := openRepo(t, gs, repo.Dir)
	export := func() string {
		return call[gitrpc.ReviewCommentExportResult](t, gs, "review.comment.export", gitrpc.ReviewCommentExportParams{RepoID: id, Branch: "feature"}).Text
	}

	if got := export(); got != "" {
		t.Fatalf("export with no comments = %q, want empty", got)
	}

	addComment(t, gs, id, "feature", "a.txt", tip, lr(2, 4), "Line one of note.\nLine two of note.")
	addComment(t, gs, id, "feature", "a.txt", tip, lr(6, 6), "Single line comment.")
	addComment(t, gs, id, "feature", "b.txt", tip, lr(1, 1), "This will go stale.")
	external(t, gs, func() {
		repo.Write("b.txt", "alpha-changed\nbeta\ngamma\n")
		repo.Git("add", "b.txt")
		repo.Git("commit", "--amend", "-q", "-m", "amended")
	})

	want := "Review comments — feature (3 comments)\n\n" +
		"a.txt:2-4\n  Line one of note.\n  Line two of note.\n\n" +
		"a.txt:6\n  Single line comment.\n\n" +
		"b.txt:1  [lines as of " + tip[:8] + "; feature's history was rewritten since]\n  This will go stale.\n"
	if got := export(); got != want {
		t.Fatalf("export =\n%q\nwant\n%q", got, want)
	}
}

// Guards remove: scoped to its own session, and a second remove of the same id answers false.
func TestCommentRemoveScopedAndIdempotent(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	main := repo.Git("rev-parse", "main")
	repo.Git("branch", "other", main)
	id := openRepo(t, gs, repo.Dir)

	onFeature := addComment(t, gs, id, "feature", "a.txt", tip, lr(2, 2), "on feature")
	onOther := addComment(t, gs, id, "other", "a.txt", main, lr(1, 1), "on other")

	if removeComment(t, gs, id, "feature", onOther.ID) {
		t.Fatal("removing another session's comment succeeded, want no match")
	}
	if left := listComments(t, gs, id, "other"); len(left) != 1 || left[0].ID != onOther.ID {
		t.Fatalf("other session's comments after a cross-session remove = %+v", left)
	}
	if !removeComment(t, gs, id, "feature", onFeature.ID) {
		t.Fatal("first remove answered false")
	}
	if removeComment(t, gs, id, "feature", onFeature.ID) {
		t.Fatal("second remove of the same id answered true")
	}
}

// Guards clear: comments only. The reviewed mark and the session survive.
func TestCommentClearKeepsMarks(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	id := openRepo(t, gs, repo.Dir)

	markFile(t, gs, id, "feature", "a.txt", true, nil)
	addComment(t, gs, id, "feature", "a.txt", tip, lr(2, 2), "note one")
	addComment(t, gs, id, "feature", "b.txt", tip, lr(1, 1), "note two")

	if cleared := call[gitrpc.ReviewCommentClearResult](t, gs, "review.comment.clear", gitrpc.ReviewCommentClearParams{RepoID: id, Branch: "feature"}); cleared.Removed != 2 {
		t.Fatalf("clear removed %d, want 2", cleared.Removed)
	}
	if left := listComments(t, gs, id, "feature"); len(left) != 0 {
		t.Fatalf("comments after clear = %+v", left)
	}
	if e := fileEntry(t, reviewFiles(t, gs, id, "feature", "main"), "a.txt"); e.Review.Kind != "full" {
		t.Fatalf("a.txt after clear = %+v, want still full", e.Review)
	}
	if added := addComment(t, gs, id, "feature", "a.txt", tip, lr(3, 3), "after clear"); added.ID == 0 {
		t.Fatal("add after clear returned no id")
	}
}

// Guards the add refusals: each E_BAD_REQUEST names the field, nothing is stored.
func TestCommentAddRefusals(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	repo.Write("img.bin", "\x89PNG\x00\x01")
	repo.Git("add", "img.bin")
	binSha := repo.Commit("add binary", nil)
	id := openRepo(t, gs, repo.Dir)

	base := gitrpc.ReviewCommentAddParams{RepoID: id, Branch: "feature", Path: "a.txt", At: tip, Range: lr(1, 1), Body: "ok"}
	for _, tc := range []struct {
		name, field string
		mutate      func(*gitrpc.ReviewCommentAddParams)
	}{
		{"whitespace body", "body", func(p *gitrpc.ReviewCommentAddParams) { p.Body = "   " }},
		{"oversized body", "body", func(p *gitrpc.ReviewCommentAddParams) { p.Body = strings.Repeat("a", (8<<10)+1) }},
		{"bad at", "hex object id", func(p *gitrpc.ReviewCommentAddParams) { p.At = "not-a-sha" }},
		{"inverted range", "range", func(p *gitrpc.ReviewCommentAddParams) { p.Range = lr(5, 2) }},
		{"past end of file", "past the end", func(p *gitrpc.ReviewCommentAddParams) { p.Range = lr(100, 100) }},
		{"binary file", "text file", func(p *gitrpc.ReviewCommentAddParams) { p.Path, p.At = "img.bin", binSha }},
		{"dash branch", "branch", func(p *gitrpc.ReviewCommentAddParams) { p.Branch = "-evil" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := base
			tc.mutate(&p)
			badRequest(t, gs, "review.comment.add", p, tc.field)
		})
	}
	badRequest(t, gs, "review.comment.list", gitrpc.ReviewCommentListParams{RepoID: id, Branch: "no-such-branch"}, "branch")
	if left := listComments(t, gs, id, "feature"); len(left) != 0 {
		t.Fatalf("refused adds stored %+v", left)
	}
}

// Guards shared state: a second window sees and removes the first window's comment.
func TestCommentsSharedAcrossConnections(t *testing.T) {
	app := flowharness.New(t)
	a, b := app.OpenGitStream(), app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	idA, idB := openRepo(t, a, repo.Dir), openRepo(t, b, repo.Dir)

	added := addComment(t, a, idA, "feature", "a.txt", tip, lr(2, 2), "from A")
	if got := listComments(t, b, idB, "feature"); len(got) != 1 || got[0].ID != added.ID {
		t.Fatalf("second window's list = %+v, want the first window's comment", got)
	}
	if !removeComment(t, b, idB, "feature", added.ID) {
		t.Fatal("second window's remove answered false")
	}
	if got := listComments(t, a, idA, "feature"); len(got) != 0 {
		t.Fatalf("first window's list after the remove = %+v", got)
	}
}

// Guards the easy regression: an unrelated ref move fires refsChanged and drops no comment.
func TestRefsChangedKeepsComments(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, tip := twoFileFeature(app)
	id := openRepo(t, gs, repo.Dir)

	added := addComment(t, gs, id, "feature", "a.txt", tip, lr(2, 2), "note")
	external(t, gs, func() { repo.Git("branch", "unrelated-branch") })

	if got := listComments(t, gs, id, "feature"); len(got) != 1 || got[0].ID != added.ID {
		t.Fatalf("comments after an unrelated refsChanged = %+v", got)
	}
}
