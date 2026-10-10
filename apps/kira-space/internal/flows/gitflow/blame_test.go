package gitflow_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

// Guards blame.line against git blame --line-porcelain across three authors.
func TestBlameLine(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	repo.Commit("alice writes", map[string]string{"f.txt": "l1\nl2\n"})
	repo.Write("f.txt", "l1\nl2\nl3\nl4\n")
	repo.Git("add", "-A")
	repo.Git("commit", "-q", "--author=Bob Builder <bob@example.com>", "-m", "bob adds")
	repo.Write("f.txt", "l1\nl2\nl3\nl4\nl5\nl6\n")
	repo.Git("add", "-A")
	repo.Git("commit", "-q", "--author=Carol Coder <carol@example.com>", "-m", "carol adds")
	id := r.open(repo.Dir).RepoID

	authors := map[string]bool{}
	for line := 1; line <= 6; line++ {
		got := call[porcelain.BlameLine](t, r.gs, "blame.line", gitrpc.BlameLineParams{RepoID: id, Path: "f.txt", Line: line})
		var wantSha, wantAuthor, wantSummary string
		for i, l := range lines(repo.Git("blame", "--line-porcelain", "-L", fmt.Sprintf("%d,%d", line, line), "f.txt")) {
			switch {
			case i == 0:
				wantSha = strings.Fields(l)[0]
			case strings.HasPrefix(l, "author "):
				wantAuthor = strings.TrimPrefix(l, "author ")
			case strings.HasPrefix(l, "summary "):
				wantSummary = strings.TrimPrefix(l, "summary ")
			}
		}
		if got.SHA != wantSha || got.Author != wantAuthor || got.Summary != wantSummary {
			t.Fatalf("line %d = %+v, git blame: %s %q %q", line, got, wantSha, wantAuthor, wantSummary)
		}
		if got.AuthorTimeSeconds <= 0 {
			t.Fatalf("line %d authorTimeSeconds = %d", line, got.AuthorTimeSeconds)
		}
		if line == 2 {
			r.app.Contract(t, "git-blame", "git:blame.line#line-2", got, flowharness.Mask("sha", "authorTimeSeconds"))
		}
		authors[got.Author] = true
	}
	if len(authors) != 3 {
		t.Fatalf("blame saw %d authors (%v), want 3", len(authors), authors)
	}
	if err := r.gs.Request("blame.line", gitrpc.BlameLineParams{RepoID: id, Path: "f.txt", Line: 99}, nil); err == nil {
		t.Fatal("blame.line past the end of the file succeeded, want an error")
	}
}
