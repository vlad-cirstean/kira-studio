package gitflow_test

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

type porcelainV2 struct {
	staged, unstaged, untracked, unmerged int
	paths                                 []string
}

// parsePorcelainV2 is the oracle for status.get: git status --porcelain=v2 -z.
func parsePorcelainV2(raw string) porcelainV2 {
	var out porcelainV2
	recs := strings.Split(strings.TrimSuffix(raw, "\x00"), "\x00")
	for i := 0; i < len(recs); i++ {
		rec := recs[i]
		if rec == "" {
			continue
		}
		switch rec[0] {
		case '1':
			f := strings.SplitN(rec, " ", 9)
			out.countXY(f[1])
			out.paths = append(out.paths, f[8])
		case '2':
			f := strings.SplitN(rec, " ", 10)
			out.countXY(f[1])
			out.paths = append(out.paths, f[9])
			i++
		case 'u':
			f := strings.SplitN(rec, " ", 11)
			out.unmerged++
			out.paths = append(out.paths, f[10])
		case '?':
			out.untracked++
			out.paths = append(out.paths, rec[2:])
		}
	}
	sort.Strings(out.paths)
	return out
}

func (p *porcelainV2) countXY(xy string) {
	if xy[0] != '.' {
		p.staged++
	}
	if xy[1] != '.' {
		p.unstaged++
	}
}

// Guards working.detail and status.get against git status for every dirty state.
func TestWorkingTreeStates(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	repo.Commit("base", map[string]string{
		"staged.txt": "one\n", "unstaged.txt": "one\n", "gone.txt": "one\n", "keep.txt": "one\n",
	})
	repo.Write("staged.txt", "two\n")
	repo.Git("add", "staged.txt")
	repo.Write("new-staged.txt", "new\n")
	repo.Git("add", "new-staged.txt")
	repo.Write("unstaged.txt", "two\n")
	if err := os.Remove(filepath.Join(repo.Dir, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	repo.Write("untracked.txt", "u\n")
	id := r.open(repo.Dir).RepoID

	want := parsePorcelainV2(repo.Git("status", "--porcelain=v2", "-z", "--untracked-files=all"))
	st := call[gitpreflight.StatusSummary](t, r.gs, "status.get", gitrpc.StatusGetParams{RepoID: id})
	if st.IsClean {
		t.Fatal("status.get isClean on a dirty tree")
	}
	if st.Counts.Staged != want.staged || st.Counts.Unstaged != want.unstaged || st.Counts.Untracked != want.untracked {
		t.Fatalf("counts = %+v, git: staged %d unstaged %d untracked %d", st.Counts, want.staged, want.unstaged, want.untracked)
	}
	got := append([]string(nil), st.DirtyPaths...)
	sort.Strings(got)
	if strings.Join(got, "|") != strings.Join(want.paths, "|") {
		t.Fatalf("dirtyPaths = %v, git: %v", got, want.paths)
	}

	detail := call[struct {
		Files []porcelain.FileChange `json:"files"`
	}](t, r.gs, "working.detail", gitrpc.WorkingDetailParams{RepoID: id})
	kinds := map[string]porcelain.FileChangeKind{}
	for _, f := range detail.Files {
		kinds[f.Path] = f.Kind
	}
	for path, kind := range map[string]porcelain.FileChangeKind{
		"staged.txt": porcelain.FileModified, "new-staged.txt": porcelain.FileAdded,
		"unstaged.txt": porcelain.FileModified, "gone.txt": porcelain.FileDeleted,
	} {
		if kinds[path] != kind {
			t.Fatalf("working.detail %q = %q, want %q (all: %v)", path, kinds[path], kind, kinds)
		}
	}
	if _, ok := kinds["keep.txt"]; ok {
		t.Fatalf("working.detail lists the unchanged keep.txt: %v", kinds)
	}

	t.Run("conflicted", func(t *testing.T) {
		c := r.app.NewRepo("conflict")
		c.Commit("base", map[string]string{"c.txt": "base\n"})
		c.Conflict("left", "right", "c.txt")
		cid := r.open(c.Dir).RepoID
		wantC := parsePorcelainV2(c.Git("status", "--porcelain=v2", "-z"))
		stC := call[gitpreflight.StatusSummary](t, r.gs, "status.get", gitrpc.StatusGetParams{RepoID: cid})
		if wantC.unmerged != 1 || stC.Counts.Unmerged != wantC.unmerged {
			t.Fatalf("unmerged = %d, git: %d", stC.Counts.Unmerged, wantC.unmerged)
		}
		if stC.InProgress == nil || stC.InProgress.Kind != gitpreflight.InProgressMerge {
			t.Fatalf("inProgress = %+v, want a merge", stC.InProgress)
		}
		if !strings.Contains(strings.Join(stC.InProgress.ConflictedPaths, ","), "c.txt") || stC.InProgress.UnmergedCount != 1 {
			t.Fatalf("inProgress = %+v, want c.txt conflicted, one unmerged", stC.InProgress)
		}
	})
}
