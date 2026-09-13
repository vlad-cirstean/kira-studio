package gitsession

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

// initGlobalStashTestRepo builds a one-commit repo, then a global-bucket entry (via `stash create`
// + `update-ref`, never touching refs/stash or the worktree) plus an ORDINARY stack entry (via a
// real `stash push`), so tests below can tell the two buckets apart. Returns the repo dir, the
// global entry's own sha, and the stack entry's own sha.
func initGlobalStashTestRepo(t *testing.T) (dir, globalSha, stackSha string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")

	// The global entry: dirty the tree, `stash create` (touches no ref, no index, no worktree,
	// probe P4), then `update-ref` into the bucket namespace directly.
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nglobal change\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (global): %v", err)
	}
	globalSha = trimTrailingNL(runOutput(t, dir, "stash", "create", "global label"))
	if globalSha == "" {
		t.Fatal("git stash create produced no sha")
	}
	runGitQ(t, dir, "update-ref", gitops.GlobalStashRef(globalSha), globalSha)
	runGitQ(t, dir, "checkout", "-q", "--", "f.txt") // restore the working tree stash create left dirty

	// The stack entry: a real, ordinary `stash push`.
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nstack change\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (stack): %v", err)
	}
	runGitQ(t, dir, "stash", "push", "-q", "-m", "stack label")
	stackSha = trimTrailingNL(runOutput(t, dir, "rev-parse", "refs/stash"))

	return dir, globalSha, stackSha
}

// TestGlobalStashList_EmptyBucketSpawnsNoLog is D9's own exit criterion (§7.1 item 9's
// gitsession-level half): an empty bucket answers exit 0 with empty for-each-ref output (probe
// P10), so GlobalStashList must stop there — zero `log` spawns.
func TestGlobalStashList_EmptyBucketSpawnsNoLog(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")

	runner := newArgSpawnCountingRunner("log")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()

	entries, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("got %d entries, want 0: %+v", len(entries), entries)
	}
	if got := runner.count("log"); got != 0 {
		t.Fatalf("log spawn count = %d, want 0", got)
	}
}

// TestGlobalStashList_ScopeRoundTrip proves D17's own Scope/Ref/Index shape end to end against a
// real git repo: a global entry answers Scope="global", Ref=gitops.GlobalStashRef(sha), Index=-1
// (the sentinel — a global entry has no stack position).
func TestGlobalStashList_ScopeRoundTrip(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, globalSha, _ := initGlobalStashTestRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	entries, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d entries, want 1: %+v", len(entries), entries)
	}
	e := entries[0]
	if e.Sha != globalSha {
		t.Fatalf("Sha = %q, want %q", e.Sha, globalSha)
	}
	if e.Scope != porcelain.StashScopeGlobal {
		t.Fatalf("Scope = %q, want %q", e.Scope, porcelain.StashScopeGlobal)
	}
	if e.Ref != gitops.GlobalStashRef(globalSha) {
		t.Fatalf("Ref = %q, want %q", e.Ref, gitops.GlobalStashRef(globalSha))
	}
	if e.Index != -1 {
		t.Fatalf("Index = %d, want -1 (D17 sentinel)", e.Index)
	}
	if e.Message != "On main: global label" && !strings.Contains(e.Message, "global label") {
		t.Fatalf("Message = %q, want it to carry the label", e.Message)
	}
}

// TestResolveStashEntryScoped_ScopeRoutingIsExact is D12's own guard: a sha from one bucket is NOT
// found when the caller asks the OTHER scope — the two buckets are addressed independently, never
// merged into one search space.
func TestResolveStashEntryScoped_ScopeRoutingIsExact(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, globalSha, stackSha := initGlobalStashTestRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	// The global sha, asked for under "stack" scope: not found.
	if _, err := entry.resolveStashEntryScoped(ctx, globalSha, porcelain.StashScopeStack); err != ErrStashNotFound {
		t.Fatalf("resolveStashEntryScoped(globalSha, stack) err = %v, want ErrStashNotFound", err)
	}
	// The stack sha, asked for under "global" scope: not found.
	if _, err := entry.resolveStashEntryScoped(ctx, stackSha, porcelain.StashScopeGlobal); err != ErrStashNotFound {
		t.Fatalf("resolveStashEntryScoped(stackSha, global) err = %v, want ErrStashNotFound", err)
	}

	// Each sha resolves correctly under its OWN scope.
	globalEntry, err := entry.resolveStashEntryScoped(ctx, globalSha, porcelain.StashScopeGlobal)
	if err != nil {
		t.Fatalf("resolveStashEntryScoped(globalSha, global): %v", err)
	}
	if globalEntry.Sha != globalSha {
		t.Fatalf("resolved sha = %q, want %q", globalEntry.Sha, globalSha)
	}
	stackEntry, err := entry.resolveStashEntryScoped(ctx, stackSha, porcelain.StashScopeStack)
	if err != nil {
		t.Fatalf("resolveStashEntryScoped(stackSha, stack): %v", err)
	}
	if stackEntry.Sha != stackSha {
		t.Fatalf("resolved sha = %q, want %q", stackEntry.Sha, stackSha)
	}

	// "" behaves as "stack" (D12: every pre-G28 caller keeps its exact meaning).
	stackEntryDefault, err := entry.resolveStashEntryScoped(ctx, stackSha, "")
	if err != nil {
		t.Fatalf("resolveStashEntryScoped(stackSha, \"\"): %v", err)
	}
	if stackEntryDefault.Sha != stackSha {
		t.Fatalf("resolved sha (default scope) = %q, want %q", stackEntryDefault.Sha, stackSha)
	}
}

// TestStashShow_GlobalScope proves stash.show's own scope threading: a global entry's file tree
// renders through the exact same query a stack entry's does, with no other change (D12).
func TestStashShow_GlobalScope(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir, globalSha, _ := initGlobalStashTestRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.StashShow(ctx, globalSha, porcelain.StashScopeGlobal)
	if err != nil {
		t.Fatalf("StashShow(global): %v", err)
	}
	if result.SHA != globalSha {
		t.Fatalf("SHA = %q, want %q", result.SHA, globalSha)
	}
	if len(result.Changes) != 1 || result.Changes[0].Path != "f.txt" {
		t.Fatalf("Changes = %+v, want exactly one change to f.txt", result.Changes)
	}

	// The wrong scope must not find it.
	if _, err := entry.StashShow(ctx, globalSha, porcelain.StashScopeStack); err != ErrStashNotFound {
		t.Fatalf("StashShow(stack) for a global-only sha: err = %v, want ErrStashNotFound", err)
	}
}
