package gitrpc

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

func graphSpecGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// openGraphSpecEntry opens a fresh one-commit repo on a Conn whose registry answers
// kiraVersion.stash.showInGraph = showInGraph — the one setting excludeStashFor/walkSpecFrom reads.
func openGraphSpecEntry(t *testing.T, showInGraph bool) *gitsession.RepoEntry {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()
	graphSpecGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	graphSpecGit(t, dir, "add", "f.txt")
	graphSpecGit(t, dir, "commit", "-q", "-m", "base")

	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	registry.RepoSettingsGet = func(string) (model.GitRepoSettings, error) {
		s := model.DefaultGitRepoSettings()
		s.StashShowInGraph = showInGraph
		return s, nil
	}
	t.Cleanup(registry.Close)
	conn := gitsession.NewConn(gitsession.ConnID("graph-spec-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}
	return entry
}

// TestExcludeStashFor_NilEntry proves the fail-safe default: no repo.open yet (entry nil) reads as
// false, the setting's own default ("on", today's de-facto behaviour) — never a stash-hiding
// surprise for a caller that has not even opened a repo.
func TestExcludeStashFor_NilEntry(t *testing.T) {
	if excludeStashFor(nil) != false {
		t.Fatal("excludeStashFor(nil) = true, want false")
	}
}

// TestWalkSpecFrom_ExcludeStash_TracksTheStoredSetting is G28 D15's own settings-side wiring proof
// (§3.16/graph.go): showInGraph:true -> ExcludeStash:false (today's de-facto behaviour,
// unchanged); showInGraph:false -> ExcludeStash:true (the decidable "off" half, F13).
func TestWalkSpecFrom_ExcludeStash_TracksTheStoredSetting(t *testing.T) {
	on := openGraphSpecEntry(t, true)
	spec, _ := walkSpecFrom(on, "", nil)
	if spec.ExcludeStash {
		t.Fatalf("ExcludeStash = true with showInGraph:true, want false")
	}

	off := openGraphSpecEntry(t, false)
	spec, _ = walkSpecFrom(off, "", nil)
	if !spec.ExcludeStash {
		t.Fatalf("ExcludeStash = false with showInGraph:false, want true")
	}
}

// TestWalkSpecFrom_ExcludeStash_NeverAffectsScope proves the "off" half's own boundary: it changes
// nothing about scope resolution (D6's own default), only the new field.
func TestWalkSpecFrom_ExcludeStash_NeverAffectsScope(t *testing.T) {
	off := openGraphSpecEntry(t, false)
	spec, _ := walkSpecFrom(off, "head", nil)
	if spec.Scope != "head" {
		t.Fatalf("Scope = %q, want %q (unaffected by ExcludeStash)", spec.Scope, "head")
	}
	if !spec.ExcludeStash {
		t.Fatal("ExcludeStash = false, want true")
	}
}
