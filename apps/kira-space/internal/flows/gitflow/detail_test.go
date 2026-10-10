package gitflow_test

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

var kindByLetter = map[string]porcelain.FileChangeKind{
	"A": porcelain.FileAdded, "M": porcelain.FileModified, "D": porcelain.FileDeleted,
	"R": porcelain.FileRenamed, "T": porcelain.FileTypeChanged,
}

type nameStatus struct {
	kind porcelain.FileChangeKind
	path string
	from string
}

// gitNameStatus is the oracle: git diff --name-status -M -z between two commits.
func gitNameStatus(repo *flowharness.Repo, from, to string) []nameStatus {
	raw := repo.Git("diff", "--name-status", "-M", "-z", from, to)
	parts := strings.Split(strings.TrimSuffix(raw, "\x00"), "\x00")
	var out []nameStatus
	for i := 0; i < len(parts); i++ {
		status := parts[i]
		if status == "" {
			continue
		}
		letter := status[:1]
		if letter == "R" {
			out = append(out, nameStatus{kind: kindByLetter[letter], from: parts[i+1], path: parts[i+2]})
			i += 2
			continue
		}
		out = append(out, nameStatus{kind: kindByLetter[letter], path: parts[i+1]})
		i++
	}
	return out
}

var hunkRe = regexp.MustCompile(`(?m)^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

func atoiOr1(s string) int {
	if s == "" {
		return 1
	}
	n, _ := strconv.Atoi(s)
	return n
}

// Guards commit.detail, commit.fileDiff and file.read against git for rename, binary, NFD and mode.
func TestCommitDetailAndDiff(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewRepo("proj")
	var body strings.Builder
	for i := 1; i <= 40; i++ {
		fmt.Fprintf(&body, "line %d of the original file\n", i)
	}
	nfdFile := flowharness.NFDName + ".txt"
	root := repo.Commit("root", map[string]string{
		"a.txt": body.String(), "old.txt": body.String() + "keep\n", "run.sh": "#!/bin/sh\n", nfdFile: "accent\n",
	})
	repo.Branch("side", "")
	edited := strings.Replace(body.String(), "line 5 of", "LINE 5 of", 1)
	edited = strings.Replace(edited, "line 30 of", "LINE 30 of", 1)
	modify := repo.Commit("modify a", map[string]string{"a.txt": edited})
	rename := repo.Rename("old.txt", "dir/new.txt", "rename old")
	repo.WriteBinary("bin.dat", 4096)
	if err := os.Chmod(filepath.Join(repo.Dir, "run.sh"), 0o755); err != nil {
		t.Fatal(err)
	}
	mixed := repo.Commit("binary and mode", map[string]string{nfdFile: "accent changed\n"})
	repo.Checkout("side")
	repo.Commit("side work", map[string]string{"side.txt": "side\n"})
	repo.Checkout("main")
	merge := repo.Merge("side", "merge side")
	id := r.open(repo.Dir).RepoID

	for _, tc := range []struct {
		name, sha, parent string
	}{{"modify", modify, root}, {"rename", rename, modify}, {"binary mode NFD", mixed, rename}, {"merge", merge, mixed}} {
		t.Run(tc.name, func(t *testing.T) {
			detail := call[porcelain.CommitDetail](t, r.gs, "commit.detail", gitrpc.CommitDetailParams{RepoID: id, SHA: tc.sha})
			want := gitNameStatus(repo, tc.parent, tc.sha)
			if len(detail.Files) != len(want) {
				t.Fatalf("commit.detail files = %d, git reports %d (%+v)", len(detail.Files), len(want), want)
			}
			byPath := map[string]porcelain.FileChange{}
			for _, f := range detail.Files {
				byPath[f.Path] = f
			}
			for _, w := range want {
				f, ok := byPath[w.path]
				if !ok {
					t.Fatalf("commit.detail lacks %q; got %+v", w.path, detail.Files)
				}
				if f.Kind != w.kind {
					t.Fatalf("%q kind = %q, want %q", w.path, f.Kind, w.kind)
				}
				if w.from != "" && (f.OriginalPath == nil || *f.OriginalPath != w.from) {
					t.Fatalf("%q originalPath = %v, want %q", w.path, f.OriginalPath, w.from)
				}
				if strings.HasSuffix(w.path, ".dat") && !f.IsBinary {
					t.Fatalf("%q isBinary = false", w.path)
				}
			}
			if detail.Subject == "" || detail.SHA != tc.sha {
				t.Fatalf("detail header = %+v", detail)
			}
			// Contract git-commit-detail: tests/ui/repo-commit-detail.spec.ts reads the rename and merge.
			if tc.name == "rename" {
				r.app.Contract(t, "git-commit-detail", "git:commit.detail#"+tc.name, detail, flowharness.Mask("sha", "parents", "timestamp"))
			}
		})
	}

	t.Run("file diff hunks equal git diff", func(t *testing.T) {
		res := call[gitsession.FileDiffResult](t, r.gs, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: id, SHA: modify, Path: "a.txt"})
		if res.Body.Kind != porcelain.BodyText {
			t.Fatalf("body kind = %q, want text", res.Body.Kind)
		}
		wantHunks := hunkRe.FindAllStringSubmatch(repo.Git("diff", "-U3", "--no-color", root, modify, "--", "a.txt"), -1)
		if len(wantHunks) != 2 || len(res.Body.Hunks) != len(wantHunks) {
			t.Fatalf("hunks = %d, git has %d", len(res.Body.Hunks), len(wantHunks))
		}
		for i, h := range res.Body.Hunks {
			w := wantHunks[i]
			got := [4]int{h.OldStart, h.OldLines, h.NewStart, h.NewLines}
			exp := [4]int{atoiOr1(w[1]), atoiOr1(w[2]), atoiOr1(w[3]), atoiOr1(w[4])}
			if got != exp {
				t.Fatalf("hunk %d = %v, git says %v", i, got, exp)
			}
		}
	})
	t.Run("binary diff is not text", func(t *testing.T) {
		res := call[gitsession.FileDiffResult](t, r.gs, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: id, SHA: mixed, Path: "bin.dat"})
		if res.Body.Kind != porcelain.BodyBinary || res.Body.NewBytes == nil || *res.Body.NewBytes != 4096 {
			t.Fatalf("binary body = %+v, want binary with 4096 new bytes", res.Body)
		}
	})
	t.Run("file.read equals git show", func(t *testing.T) {
		for _, p := range []string{"a.txt", nfdFile} {
			res := call[gitsession.BlobResult](t, r.gs, "file.read", gitrpc.FileReadParams{RepoID: id, Rev: mixed, Path: p})
			if res.Kind != "found" || res.Content != repo.Git("show", mixed+":"+p)+"\n" {
				t.Fatalf("file.read %q = kind %q content %q", p, res.Kind, res.Content)
			}
		}
		res := call[gitsession.BlobResult](t, r.gs, "file.read", gitrpc.FileReadParams{RepoID: id, Rev: root, Path: "dir/new.txt"})
		if res.Kind != "missing" {
			t.Fatalf("file.read of a path absent at the revision = %q, want missing", res.Kind)
		}
	})
	t.Run("file.goToTarget is live on disk and unavailable nowhere", func(t *testing.T) {
		live := call[gitsession.GoToTarget](t, r.gs, "file.goToTarget", gitrpc.FileGoToTargetParams{RepoID: id, Rev: mixed, Path: "a.txt"})
		if live.Kind != "live" || live.AbsPath != filepath.Join(repo.Dir, "a.txt") {
			t.Fatalf("on-disk path = %+v, want live at the worktree path", live)
		}
		gone := call[gitsession.GoToTarget](t, r.gs, "file.goToTarget", gitrpc.FileGoToTargetParams{RepoID: id, Rev: root, Path: "nowhere.txt"})
		if gone.Kind != "unavailable" {
			t.Fatalf("path neither at the revision nor on disk = %+v, want unavailable", gone)
		}
	})
}
