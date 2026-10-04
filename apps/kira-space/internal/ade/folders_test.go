package ade

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func mk(t *testing.T, parts ...string) string {
	t.Helper()
	p := filepath.Join(parts...)
	if err := os.MkdirAll(p, 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestScanFolder_rules(t *testing.T) {
	root := t.TempDir()
	repoA := mk(t, root, "a")
	mk(t, repoA, ".git")
	mk(t, repoA, "inner", ".git") // below a repo root: never reached
	repoB := mk(t, root, "group", "b")
	mk(t, repoB, ".git")
	deep := mk(t, root, "l1", "l2", "l3", "deep") // depth 4: out of reach
	mk(t, deep, ".git")
	edge := mk(t, root, "l1", "l2", "edge") // depth 3: found
	mk(t, edge, ".git")
	mk(t, root, ".hidden", "h", ".git")
	mk(t, root, "node_modules", "pkg", ".git")
	bare := mk(t, root, "bare.git")
	mk(t, bare, "objects")
	mk(t, bare, "refs")
	if err := os.WriteFile(filepath.Join(bare, "HEAD"), []byte("ref: refs/heads/main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	wt := mk(t, root, "wt")
	if err := os.WriteFile(filepath.Join(wt, ".git"), []byte("gitdir: /elsewhere\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	plain := mk(t, root, "plain", "sub")

	got := scanFolder(root)
	slices.Sort(got.repos)
	want := []string{repoA, edge, repoB}
	slices.Sort(want)
	if !slices.Equal(got.repos, want) {
		t.Fatalf("repos = %v, want %v", got.repos, want)
	}
	for _, d := range []string{root, plain, filepath.Join(root, "group")} {
		if !slices.Contains(got.dirs, d) {
			t.Errorf("dir %s not watched: %v", d, got.dirs)
		}
	}
	for _, d := range []string{repoA, bare, wt, filepath.Join(root, ".hidden")} {
		if slices.Contains(got.dirs, d) {
			t.Errorf("dir %s must not be watched", d)
		}
	}
}

func TestAddFolder_importsRealReposOnly(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	root := t.TempDir()
	_, main1 := initQueueRepo(t)
	_, main2 := initQueueRepo(t)
	r1 := filepath.Join(root, "one")
	r2 := filepath.Join(root, "sub", "two")
	if err := os.MkdirAll(filepath.Dir(r2), 0o755); err != nil {
		t.Fatal(err)
	}
	for src, dst := range map[string]string{main1: r1, main2: r2} {
		if err := os.Rename(src, dst); err != nil {
			t.Fatal(err)
		}
	}
	runGitQueue(t, r1, "worktree", "add", "-q", "-b", "wtb", filepath.Join(root, "wt"))
	skipped := filepath.Join(root, "manual")
	_, already := initQueueRepo(t)
	if err := os.Rename(already, skipped); err != nil {
		t.Fatal(err)
	}
	h.addRepoFromPath("manual", skipped)

	res, err := h.board.AddFolder(context.Background(), root, false)
	if err != nil {
		t.Fatalf("AddFolder: %v", err)
	}
	if len(res.Imported) != 2 || res.Folder.RepoCount != 2 || res.Folder.Path != root {
		t.Fatalf("result = %+v", res)
	}
	repos, rerr := h.board.Repos(context.Background())
	if rerr != nil {
		t.Fatal(rerr)
	}
	sources := map[string]string{}
	for _, r := range repos.Repos {
		sources[r.Name] = r.Source
	}
	if sources["one"] != root || sources["two"] != root || sources["manual"] != "added" || len(repos.Repos) != 3 {
		t.Fatalf("sources = %v", sources)
	}

	if err := h.board.RemoveFolder(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	repos, rerr = h.board.Repos(context.Background())
	if rerr != nil {
		t.Fatal(rerr)
	}
	if len(repos.Folders) != 0 || len(repos.Repos) != 3 {
		t.Fatalf("after remove: %+v", repos)
	}
	for _, r := range repos.Repos {
		if r.Source != "added" {
			t.Errorf("%s source = %q after remove", r.Name, r.Source)
		}
	}
}

func TestFolderWatch_importsNewRepo(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newBoardHarness(t)
	root := t.TempDir()
	if _, err := h.board.AddFolder(context.Background(), root, true); err != nil {
		t.Fatal(err)
	}
	_, clone := initQueueRepo(t)
	if err := os.Rename(clone, filepath.Join(root, "late")); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		repos, rerr := h.board.Repos(context.Background())
		if rerr != nil {
			t.Fatal(rerr)
		}
		if len(repos.Repos) == 1 && repos.Repos[0].Source == root {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("repo not imported: %+v", repos)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
