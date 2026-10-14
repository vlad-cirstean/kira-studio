package agentsandbox

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolvePolicy(t *testing.T) {
	root := t.TempDir()
	real, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	home := filepath.Join(real, "home")
	repo := filepath.Join(real, "repo")
	wt := filepath.Join(real, "wt")
	mustMkdir(t, home, filepath.Join(home, "specs"), filepath.Join(repo, ".git", "worktrees", "wt"), wt)
	mustWrite(t, filepath.Join(wt, ".git"), "gitdir: "+filepath.Join(repo, ".git", "worktrees", "wt")+"\n")
	mustWrite(t, filepath.Join(repo, ".git", "worktrees", "wt", "commondir"), "../..\n")
	link := filepath.Join(real, "link")
	if err := os.Symlink(wt, link); err != nil {
		t.Fatal(err)
	}
	rt := Runtime{Home: home}
	p, notes, err := ResolvePolicy(Input{
		RunID: "r", Access: AccessWrite, Worktrees: []string{link}, Read: []string{"~/specs", "~/nope"},
		Scratch: filepath.Join(real, "scratch"), Cache: filepath.Join(real, "cache"), Branch: map[string]string{link: "b"},
	}, rt)
	if err != nil {
		t.Fatal(err)
	}
	if p.Write[0] != wt || p.RunDir != wt {
		t.Fatalf("symlink not canonicalised: %v %s", p.Write, p.RunDir)
	}
	if len(p.Read) != 1 || p.Read[0] != filepath.Join(home, "specs") {
		t.Fatalf("read: %v", p.Read)
	}
	if len(notes) != 1 || notes[0] != "sandbox path missing: ~/nope" {
		t.Fatalf("notes: %v", notes)
	}
	if len(p.Git) != 1 || p.Git[0].GitDir != filepath.Join(repo, ".git", "worktrees", "wt") || p.Git[0].CommonDir != filepath.Join(repo, ".git") {
		t.Fatalf("git layout: %+v", p.Git)
	}
	if p.Branch[wt] != "b" {
		t.Fatalf("branch: %v", p.Branch)
	}
	if _, _, err := ResolvePolicy(Input{Access: AccessWrite, Worktrees: []string{filepath.Join(real, "gone")}, Scratch: p.Scratch, Cache: p.Cache}, rt); err == nil {
		t.Fatal("missing worktree must fail")
	}
}

func mustMkdir(t *testing.T, dirs ...string) {
	t.Helper()
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func mustWrite(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}
