package gitsession

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// TestOpTable_EveryEntryStatesAnUndoPolicy is D6's own Go stand-in for upstream's TypeScript
// mapped type (UNDO_POLICY: {[K in OpRequest["kind"]]: UndoPolicy}), which fails tsc when a new
// operation kind is added without a corresponding undo policy. Go has no such compiler check, so
// this test is what stands in its place: every opTable entry's Undo.Kind must be one of the two
// legal values, and every notUndoable entry must carry a real, non-empty reason (never a
// placeholder — §7.12's "we never present an undo we cannot honour").
func TestOpTable_EveryEntryStatesAnUndoPolicy(t *testing.T) {
	if len(opTable) != 15 {
		t.Fatalf("opTable has %d entries, want exactly 15 (D5, G17 adds the five stash kinds)", len(opTable))
	}
	for kind, spec := range opTable {
		switch spec.Undo.Kind {
		case gitpreflight.Undoable:
			if spec.Undo.Reason != "" {
				t.Errorf("%s: undoable entries carry no reason, got %q", kind, spec.Undo.Reason)
			}
		case gitpreflight.NotUndoable:
			if spec.Undo.Reason == "" {
				t.Errorf("%s: notUndoable entry has an empty reason", kind)
			}
		default:
			t.Errorf("%s: Undo.Kind = %q, not one of the two legal values", kind, spec.Undo.Kind)
		}
		if spec.Prepare == nil {
			t.Errorf("%s: Prepare is nil", kind)
		}
	}
}

// TestOpTable_ServesExactlyTheFifteenNamedKinds locks D5's own list, updated by G17's five new
// entries — a kind absent here answers ErrUnservedOpKind, never a stub.
func TestOpTable_ServesExactlyTheFifteenNamedKinds(t *testing.T) {
	want := []string{
		"checkout", "branchCreate", "branchDelete", "branchRename",
		"tagCreate", "tagDelete", "revert", "opContinue", "opAbort", "opSkip",
		"stashPush", "stashApply", "stashPop", "stashDrop", "stashBranch",
	}
	for _, k := range want {
		if _, ok := opTable[k]; !ok {
			t.Errorf("opTable is missing %q", k)
		}
	}
	unserved := []string{"tagPush", "tagDeleteRemote", "reset", "cherryPick"}
	for _, k := range unserved {
		if _, ok := opTable[k]; ok {
			t.Errorf("opTable unexpectedly serves %q — it must still be refused (D5)", k)
		}
	}
}

// TestOpTable_UndoableKindsAreExactlyBranchTagDeleteAndStashDrop locks the three kinds this phase
// captures a real undo record for — stashDrop joins branchDelete/tagDelete at G17 (undo/slot.ts's
// own UNDO_POLICY marks it undoable, unlike its four stash siblings).
func TestOpTable_UndoableKindsAreExactlyBranchTagDeleteAndStashDrop(t *testing.T) {
	var undoable []string
	for kind, spec := range opTable {
		if spec.Undo.Kind == gitpreflight.Undoable {
			undoable = append(undoable, kind)
		}
	}
	if len(undoable) != 3 {
		t.Fatalf("undoable kinds = %v, want exactly 3 (branchDelete, tagDelete, stashDrop)", undoable)
	}
	for _, k := range []string{"branchDelete", "tagDelete", "stashDrop"} {
		if opTable[k].Undo.Kind != gitpreflight.Undoable {
			t.Fatalf("%s must be undoable", k)
		}
	}
}

// initStashConflictRepo builds two branches diverging on the same line of the same file: "main"
// changes line 2 to "MAIN", "other" (branched off the same base, never advanced) has the same line
// dirty to "STASH" in its own worktree, uncommitted. Returns dir with "other" checked out and that
// change already stashed — the caller switches to "main" and pops from there.
func initStashConflictRepo(t *testing.T) (dir string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nline2\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "branch", "other")

	// main: advances past base, changing the same line the stash will also touch.
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nMAIN\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (main): %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "main change")

	// other: stays at base, gets a dirty (uncommitted) change to the same line, then stashed.
	runGitQ(t, dir, "checkout", "-q", "other")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nSTASH\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (other): %v", err)
	}
	runGitQ(t, dir, "stash", "push", "-q", "-m", "conflict test")
	runGitQ(t, dir, "checkout", "-q", "main")
	return dir
}

// TestRunOp_StashPopConflict_Reclassifies is §3.9/D11's own new test: a real conflicting `stash
// pop` — exit code non-zero, stderr EMPTY (probe 5) — must reclassify to StashConflict, never fall
// through to ClassifyOpError's generic "Unknown" default. The stash entry must still exist
// afterward (the stash is ALWAYS kept on a conflicting pop/apply).
func TestRunOp_StashPopConflict_Reclassifies(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initStashConflictRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	before, err := entry.StashList(ctx)
	if err != nil {
		t.Fatalf("StashList (before): %v", err)
	}
	if len(before) != 1 {
		t.Fatalf("got %d stash entries before pop, want 1: %+v", len(before), before)
	}
	stash := before[0]

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "stashPop", Sha: stash.Sha, Index: stash.Index, RestoreIndex: false,
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK {
		t.Fatalf("result.OK = true, want false (a real conflicting pop)")
	}
	if result.Error == nil || result.Error.Kind != "StashConflict" {
		t.Fatalf("result.Error = %+v, want Kind = StashConflict, never Unknown", result.Error)
	}

	after, err := entry.StashList(ctx)
	if err != nil {
		t.Fatalf("StashList (after): %v", err)
	}
	if len(after) != 1 || after[0].Sha != stash.Sha {
		t.Fatalf("stash list after a conflicting pop = %+v, want the same entry still present (kept, per probe 5)", after)
	}
}
