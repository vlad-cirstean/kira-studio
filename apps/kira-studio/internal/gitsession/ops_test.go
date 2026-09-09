package gitsession

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// TestOpTable_EveryEntryStatesAnUndoPolicy is D6's own Go stand-in for upstream's TypeScript
// mapped type (UNDO_POLICY: {[K in OpRequest["kind"]]: UndoPolicy}), which fails tsc when a new
// operation kind is added without a corresponding undo policy. Go has no such compiler check, so
// this test is what stands in its place: every opTable entry's Undo.Kind must be one of the two
// legal values, and every notUndoable entry must carry a real, non-empty reason (never a
// placeholder — §7.12's "we never present an undo we cannot honour").
func TestOpTable_EveryEntryStatesAnUndoPolicy(t *testing.T) {
	if len(opTable) != 22 {
		t.Fatalf("opTable has %d entries, want exactly 22 (D5, G28 adds globalStashSave/globalStashRemove)", len(opTable))
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

// TestOpTable_ServesExactlyTheTwentyTwoNamedKinds locks D5's own list, updated by G28's two new
// entries (globalStashSave, globalStashRemove, D17) — a kind absent here answers
// ErrUnservedOpKind, never a stub.
func TestOpTable_ServesExactlyTheTwentyTwoNamedKinds(t *testing.T) {
	want := []string{
		"checkout", "branchCreate", "branchDelete", "branchRename",
		"tagCreate", "tagDelete", "revert", "opContinue", "opAbort", "opSkip",
		"stashPush", "stashApply", "stashPop", "stashDrop", "stashBranch",
		"reset", "cherryPick", "worktreeAdd", "worktreeRemove", "stackSet",
		"globalStashSave", "globalStashRemove",
	}
	if len(want) != 22 {
		t.Fatalf("test fixture itself lists %d kinds, want 22", len(want))
	}
	for _, k := range want {
		if _, ok := opTable[k]; !ok {
			t.Errorf("opTable is missing %q", k)
		}
	}
	unserved := []string{"tagPush", "tagDeleteRemote"}
	for _, k := range unserved {
		if _, ok := opTable[k]; ok {
			t.Errorf("opTable unexpectedly serves %q — it must still be refused (D5)", k)
		}
	}
}

// TestOpTable_UndoableKindsAreExactlySevenNamedKinds locks the seven kinds this phase captures a
// real undo record for — G28 D17 adds globalStashRemove to the six G26 already established
// (branchDelete, tagDelete, stashDrop, reset, cherryPick, stackSet).
func TestOpTable_UndoableKindsAreExactlySevenNamedKinds(t *testing.T) {
	var undoable []string
	for kind, spec := range opTable {
		if spec.Undo.Kind == gitpreflight.Undoable {
			undoable = append(undoable, kind)
		}
	}
	if len(undoable) != 7 {
		t.Fatalf("undoable kinds = %v, want exactly 7 (branchDelete, tagDelete, stashDrop, reset, cherryPick, stackSet, globalStashRemove)", undoable)
	}
	for _, k := range []string{"branchDelete", "tagDelete", "stashDrop", "reset", "cherryPick", "stackSet", "globalStashRemove"} {
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

// initAutoStashRepo builds "main" and "target" diverging on the same tracked line of f.txt, and
// "target" additionally adds a file ("new.txt") "main" does not have — the tracked and untracked
// blocker fixtures every auto-stash test below builds on. Returns dir with "main" checked out and
// nothing dirty yet; each test dirties main's own working tree the way it needs.
func initAutoStashRepo(t *testing.T) (dir string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nline2\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "checkout", "-q", "-b", "target")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nTARGET\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (target): %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("target's own file\n"), 0o644); err != nil {
		t.Fatalf("write new.txt (target): %v", err)
	}
	runGitQ(t, dir, "add", "f.txt", "new.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "target change")
	runGitQ(t, dir, "checkout", "-q", "main")
	return dir
}

// TestPrepareCheckout_AutoStash_DirtyProducesStashThenSwitch is D3's own central proof: a tracked
// dirty file that the target checkout would rewrite produces EXACTLY [stash push, switch] in that
// order — the argv sequence that lets RunOp's single e.Repo.Write chain never leave a window where
// the tree is stashed and the switch never happened (F6).
func TestPrepareCheckout_AutoStash_DirtyProducesStashThenSwitch(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initAutoStashRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nDIRTY\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (dirty): %v", err)
	}
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareCheckout(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "target", Mode: "switch", AutoStash: true,
	})
	if err != nil {
		t.Fatalf("prepareCheckout: %v", err)
	}
	if prep.earlyError != nil {
		t.Fatalf("unexpected earlyError: %+v", prep.earlyError)
	}
	if len(prep.argvList) != 2 {
		t.Fatalf("argvList = %v, want exactly 2 entries", prep.argvList)
	}
	if prep.argvList[0][0] != "stash" || prep.argvList[0][1] != "push" {
		t.Fatalf("argvList[0] = %v, want a stash push argv", prep.argvList[0])
	}
	if prep.argvList[1][0] != "switch" {
		t.Fatalf("argvList[1] = %v, want a switch argv", prep.argvList[1])
	}
	// Tracked-only dirt: -u must NOT be present (D3 step 4).
	for _, a := range prep.argvList[0] {
		if a == "-u" {
			t.Fatalf("argvList[0] = %v, must not include -u for a tracked-only dirty tree", prep.argvList[0])
		}
	}
}

// TestPrepareCheckout_AutoStash_CleanTreeOneArgv is D3 step 3's own proof: a clean tree omits the
// stash argv entirely, rather than spawning `stash push` on nothing (probe P16: that prints "No
// local changes to save" and creates no entry — a confusing no-op announcement).
func TestPrepareCheckout_AutoStash_CleanTreeOneArgv(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initAutoStashRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareCheckout(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "target", Mode: "switch", AutoStash: true,
	})
	if err != nil {
		t.Fatalf("prepareCheckout: %v", err)
	}
	if prep.earlyError != nil {
		t.Fatalf("unexpected earlyError: %+v", prep.earlyError)
	}
	if len(prep.argvList) != 1 {
		t.Fatalf("argvList = %v, want exactly 1 entry (no stash argv on a clean tree)", prep.argvList)
	}
	if prep.argvList[0][0] != "switch" {
		t.Fatalf("argvList[0] = %v, want a switch argv", prep.argvList[0])
	}
}

// TestPrepareCheckout_AutoStash_UntrackedOnly_IncludesDashU proves D3 step 4's -u derivation: an
// untracked-only dirty path that the target checkout would create sets includeUntracked, so the
// stash argv carries -u.
func TestPrepareCheckout_AutoStash_UntrackedOnly_IncludesDashU(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initAutoStashRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "new.txt"), []byte("main's own untracked collision\n"), 0o644); err != nil {
		t.Fatalf("write new.txt: %v", err)
	}
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareCheckout(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "target", Mode: "switch", AutoStash: true,
	})
	if err != nil {
		t.Fatalf("prepareCheckout: %v", err)
	}
	if len(prep.argvList) != 2 {
		t.Fatalf("argvList = %v, want exactly 2 entries", prep.argvList)
	}
	found := false
	for _, a := range prep.argvList[0] {
		if a == "-u" {
			found = true
		}
	}
	if !found {
		t.Fatalf("argvList[0] = %v, want -u present for an untracked-only dirty tree", prep.argvList[0])
	}
}

// TestPrepareCheckout_AutoStash_BothFlagsRefusedWithZeroSpawns is D3 step 1's own proof: AutoStash
// and DiscardLocalChanges together refuse BEFORE any spawn at all — not merely before any WRITE.
func TestPrepareCheckout_AutoStash_BothFlagsRefusedWithZeroSpawns(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initAutoStashRepo(t)
	runner := newArgSpawnCountingRunner("stash", "switch", "status", "rev-parse", "diff", "for-each-ref")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()

	// Reset counters after Open's own setup spawns -- only prepareCheckout's own spawns matter here.
	for _, v := range []string{"stash", "switch", "status", "rev-parse", "diff", "for-each-ref"} {
		runner.counts[v] = new(int32)
	}

	prep, err := prepareCheckout(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "target", Mode: "switch", AutoStash: true, DiscardLocalChanges: true,
	})
	if err != nil {
		t.Fatalf("prepareCheckout: %v", err)
	}
	if prep.earlyError == nil || prep.earlyError.Kind != "Unknown" {
		t.Fatalf("earlyError = %+v, want Kind=Unknown", prep.earlyError)
	}
	if len(prep.argvList) != 0 {
		t.Fatalf("argvList = %v, want none", prep.argvList)
	}
	for _, v := range []string{"stash", "switch", "status", "rev-parse", "diff", "for-each-ref"} {
		if got := runner.count(v); got != 0 {
			t.Fatalf("%s spawn count = %d, want 0 (refused before any spawn)", v, got)
		}
	}
}

// TestPrepareCheckout_AutoStash_InProgressRefusesWithNoArgv is D3 step 2/F15's own proof: an
// in-progress operation refuses (host-side, re-checked fresh) before any WRITE argv is built —
// probe P17's own reason: `stash push` mid-conflict fails with EMPTY stderr, which
// ClassifyOpError could only ever call Unknown.
func TestPrepareCheckout_AutoStash_InProgressRefusesWithNoArgv(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initMidMergeRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareCheckout(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "other", Mode: "switch", AutoStash: true,
	})
	if err != nil {
		t.Fatalf("prepareCheckout: %v", err)
	}
	if prep.earlyError == nil || prep.earlyError.Kind != "OperationInProgress" {
		t.Fatalf("earlyError = %+v, want Kind=OperationInProgress", prep.earlyError)
	}
	if len(prep.argvList) != 0 {
		t.Fatalf("argvList = %v, want none (no write argv built at all)", prep.argvList)
	}
}

// TestRunOp_AutoStash_DoesNotPopBack is D1's own end-to-end proof, the single most important
// semantic decision in this phase: after an auto-stashed switch, the stash entry is STILL in the
// list (never popped), tagged with the ORIGIN branch (main), and the working tree is clean on the
// new branch.
func TestRunOp_AutoStash_DoesNotPopBack(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initAutoStashRepo(t)
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nDIRTY\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (dirty): %v", err)
	}
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "checkout", Target: "target", Mode: "switch", AutoStash: true,
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result.OK = false, want true: %+v", result.Error)
	}
	if result.Head.Kind != "branch" || result.Head.Name != "target" {
		t.Fatalf("Head = %+v, want branch target", result.Head)
	}

	entries, err := entry.StashList(ctx)
	if err != nil {
		t.Fatalf("StashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d stash entries, want exactly 1 (never popped back, D1)", len(entries))
	}
	if entries[0].Branch == nil || *entries[0].Branch != "main" {
		t.Fatalf("Branch = %v, want \"main\" (the ORIGIN branch, not the target)", entries[0].Branch)
	}
	if !strings.Contains(entries[0].Message, gitops.AutoStashMessagePrefix) {
		t.Fatalf("Message = %q, want it to carry the auto-stash marker %q", entries[0].Message, gitops.AutoStashMessagePrefix)
	}

	statusResult, _, err := entry.statusAndInProgress(ctx)
	if err != nil {
		t.Fatalf("statusAndInProgress: %v", err)
	}
	if len(gitpreflight.DirtyPaths(statusResult)) != 0 {
		t.Fatalf("working tree is not clean after the auto-stashed switch: %+v", statusResult)
	}
}

// TestPrepareGlobalStashSave_CleanTreeAnswersNothingToStash is §7.1 item 7's own exit criterion:
// a clean working tree (no source sha given) answers NothingToStash with no write at all.
func TestPrepareGlobalStashSave_CleanTreeAnswersNothingToStash(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareGlobalStashSave(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "globalStashSave", Label: "my label",
	})
	if err != nil {
		t.Fatalf("prepareGlobalStashSave: %v", err)
	}
	if prep.earlyError == nil || prep.earlyError.Kind != "NothingToStash" {
		t.Fatalf("earlyError = %+v, want Kind=NothingToStash", prep.earlyError)
	}
	if len(prep.argvList) != 0 {
		t.Fatalf("argvList = %v, want none", prep.argvList)
	}

	// No ref must have been created.
	entries, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("got %d global entries, want 0 (no write happened)", len(entries))
	}
}

// TestPrepareGlobalStashSave_EmptyOrMultilineLabelRefuses proves the label validation runs before
// any spawn at all.
func TestPrepareGlobalStashSave_EmptyOrMultilineLabelRefuses(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	for _, label := range []string{"", "   ", "two\nlines"} {
		prep, err := prepareGlobalStashSave(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
			Kind: "globalStashSave", Label: label,
		})
		if err != nil {
			t.Fatalf("prepareGlobalStashSave(%q): %v", label, err)
		}
		if prep.earlyError == nil || prep.earlyError.Kind != "Unknown" {
			t.Fatalf("label %q: earlyError = %+v, want Kind=Unknown", label, prep.earlyError)
		}
		if len(prep.argvList) != 0 {
			t.Fatalf("label %q: argvList = %v, want none", label, prep.argvList)
		}
	}
}

// TestRunOp_GlobalStashSave_FromWorkingTree_CopiesNeverDrops is D10's own copy-never-move proof:
// after saving, the working tree is UNCHANGED (still dirty, exact same content) and a new global
// entry exists with the typed label.
func TestRunOp_GlobalStashSave_FromWorkingTree_CopiesNeverDrops(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	dirty := []byte("line1\nWIP\n")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), dirty, 0o644); err != nil {
		t.Fatalf("write f.txt (dirty): %v", err)
	}

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "globalStashSave", Label: "keep this WIP",
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result.OK = false: %+v", result.Error)
	}

	// The working tree is byte-identical to before -- COPIED, never dropped.
	got, err := os.ReadFile(filepath.Join(dir, "f.txt"))
	if err != nil {
		t.Fatalf("read f.txt: %v", err)
	}
	if string(got) != string(dirty) {
		t.Fatalf("f.txt = %q after save, want unchanged %q", got, dirty)
	}

	entries, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("got %d global entries, want 1: %+v", len(entries), entries)
	}
	if !strings.Contains(entries[0].Message, "keep this WIP") {
		t.Fatalf("Message = %q, want it to carry the typed label", entries[0].Message)
	}
	if entries[0].Index != -1 {
		t.Fatalf("Index = %d, want -1", entries[0].Index)
	}
}

// TestPrepareGlobalStashRemove_AbsentRefAnswersNotFoundWithNoWrite is D11/probe P10's own exit
// criterion: `update-ref -d` on an absent ref exits 0 silently, so the required existence check
// must catch this BEFORE any write.
func TestPrepareGlobalStashRemove_AbsentRefAnswersNotFoundWithNoWrite(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	prep, err := prepareGlobalStashRemove(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "globalStashRemove", Sha: strings.Repeat("a", 40),
	})
	if err != nil {
		t.Fatalf("prepareGlobalStashRemove: %v", err)
	}
	if prep.earlyError == nil || prep.earlyError.Kind != "NotFound" {
		t.Fatalf("earlyError = %+v, want Kind=NotFound", prep.earlyError)
	}
	if len(prep.argvList) != 0 {
		t.Fatalf("argvList = %v, want none", prep.argvList)
	}
}

// TestRunOp_GlobalStashRemove_UndoReplaysExactlyOneUpdateRef is D11's own "cleanest undo in the
// table" proof: removing an entry then undoing it recreates the SAME ref at the SAME object via a
// single update-ref argv.
func TestRunOp_GlobalStashRemove_UndoReplaysExactlyOneUpdateRef(t *testing.T) {
	skipWithoutGitQueries(t)
	dir, globalSha, _ := initGlobalStashTestRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "globalStashRemove", Sha: globalSha,
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result.OK = false: %+v", result.Error)
	}
	if result.Undo == nil {
		t.Fatal("Undo = nil, want a real undo slot (globalStashRemove is undoable)")
	}

	entriesAfterRemove, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(entriesAfterRemove) != 0 {
		t.Fatalf("got %d global entries after remove, want 0: %+v", len(entriesAfterRemove), entriesAfterRemove)
	}

	undoResult, err := entry.UndoRun(ctx, result.Undo.ID)
	if err != nil {
		t.Fatalf("UndoRun: %v", err)
	}
	if !undoResult.OK {
		t.Fatalf("undo result.OK = false: %+v", undoResult.Error)
	}

	entriesAfterUndo, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList (after undo): %v", err)
	}
	if len(entriesAfterUndo) != 1 || entriesAfterUndo[0].Sha != globalSha {
		t.Fatalf("got %+v after undo, want exactly the same entry (%s) back", entriesAfterUndo, globalSha)
	}
}

// TestUndoRun_InvalidatesRefsCache is G30 round-1 functional-correctness review, finding #5:
// UndoRun had no equivalent of RunOp's own `defer e.invalidateAfterWrite()`, so a real write
// UndoRun makes (here, branchDelete's own undo — an update-ref recreating the branch) left the
// shared refs cache stale. Warms the cache to a DEFINITE "branch absent" value after the delete
// (so this test cannot pass merely because RunOp's own invalidation happened to still be in
// effect), then asserts the very next Refs() call after UndoRun sees the branch again — with no
// refsChanged event of any kind involved (this fixture has no live watcher), so the only thing
// that can make that call see fresh state is UndoRun's own invalidation.
func TestUndoRun_InvalidatesRefsCache(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "branch", "feature")

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	hasFeature := func() bool {
		refs, err := entry.Refs(ctx)
		if err != nil {
			t.Fatalf("Refs: %v", err)
		}
		for _, b := range refs.Branches {
			if b.ShortName == "feature" {
				return true
			}
		}
		return false
	}

	if !hasFeature() {
		t.Fatal("feature should exist before any delete")
	}

	result, err := entry.RunOp(ctx, ConnID("undo-cache-test-conn"), "test", OpRequest{Kind: "branchDelete", Name: "feature"})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK || result.Undo == nil {
		t.Fatalf("RunOp branchDelete = %+v, want ok with an undo record", result)
	}

	// Re-warms the cache to a DEFINITE "absent" value, post-delete — RunOp's own invalidation
	// already fired; this read is deliberately AFTER that, so nothing from RunOp's own defer can
	// carry over into what UndoRun is being tested for.
	if hasFeature() {
		t.Fatal("feature should be absent immediately after RunOp branchDelete")
	}

	undoResult, err := entry.UndoRun(ctx, result.Undo.ID)
	if err != nil {
		t.Fatalf("UndoRun: %v", err)
	}
	if !undoResult.OK {
		t.Fatalf("UndoRun = %+v, want ok", undoResult)
	}

	if !hasFeature() {
		t.Fatal("Refs() after UndoRun still reports feature absent — the cache was not invalidated")
	}
}

// TestRunOp_GlobalStashSave_PromoteExistingStackEntry_PreservesOriginBranch is D10 step 3's own
// proof: promoting an existing STACK entry into the bucket keeps the source in the stack
// (copy-never-drop) and preserves its own origin-branch tag under the NEW label, rather than
// re-stamping it with whatever branch is checked out now.
func TestRunOp_GlobalStashSave_PromoteExistingStackEntry_PreservesOriginBranch(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "checkout", "-q", "-b", "origin-branch")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nstack change\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (dirty): %v", err)
	}
	runGitQ(t, dir, "stash", "push", "-q", "-m", "the source stash")
	stackSha := trimTrailingNL(runOutput(t, dir, "rev-parse", "refs/stash"))
	// Switch to a DIFFERENT branch before promoting — proves the message is NOT re-stamped with
	// whatever is checked out now.
	runGitQ(t, dir, "checkout", "-q", "main")

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{
		Kind: "globalStashSave", Sha: stackSha, Label: "promoted",
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result.OK = false: %+v", result.Error)
	}

	// The SOURCE stays in the stack (copy-never-drop, D10).
	stackEntries, err := entry.StashList(ctx)
	if err != nil {
		t.Fatalf("StashList: %v", err)
	}
	if len(stackEntries) != 1 || stackEntries[0].Sha != stackSha {
		t.Fatalf("stack entries = %+v, want the source still present", stackEntries)
	}

	globalEntries, err := entry.GlobalStashList(ctx)
	if err != nil {
		t.Fatalf("GlobalStashList: %v", err)
	}
	if len(globalEntries) != 1 {
		t.Fatalf("got %d global entries, want 1: %+v", len(globalEntries), globalEntries)
	}
	promoted := globalEntries[0]
	if promoted.Branch == nil || *promoted.Branch != "origin-branch" {
		t.Fatalf("Branch = %v, want \"origin-branch\" (the SOURCE's own origin, not \"main\")", promoted.Branch)
	}
	if !strings.Contains(promoted.Message, "promoted") {
		t.Fatalf("Message = %q, want it to carry the NEW label", promoted.Message)
	}
}

// resetLabelPattern mirrors packages/git-ui/src/state/liveAnnouncements.ts's own
// RESET_UNDO_LABEL_PATTERN verbatim (F9) — a wire contract in disguise: composeUndoTooltip
// pattern-matches the undo slot's own label to pick a mode-specific tooltip, so the Go label must
// be byte-identical to this shape.
var resetLabelPattern = regexp.MustCompile(`^Reset \((soft|mixed|hard)\) to `)

// TestPrepareReset_LabelMatchesTheWebviewPattern is §3.9/F9's own guard: composeUndoTooltip's
// RESET_UNDO_LABEL_PATTERN is unguarded on both sides today (F9's own finding) — this test is the
// Go-side half. Calls prepareReset directly (this file is `package gitsession`, not `_test`) for
// each of the three modes, resetting to an ancestor of a clean HEAD so no mode ever needs a
// confirmToken.
func TestPrepareReset_LabelMatchesTheWebviewPattern(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	base := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "commit", "-aqm", "second")

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	for _, mode := range []string{"soft", "mixed", "hard"} {
		prep, err := prepareReset(ctx, entry, ConnID("test-conn"), "test-label", OpRequest{Kind: "reset", Mode: mode, Target: base})
		if err != nil {
			t.Fatalf("prepareReset(%s): %v", mode, err)
		}
		if prep.earlyError != nil {
			t.Fatalf("prepareReset(%s): unexpected earlyError %+v", mode, prep.earlyError)
		}
		if prep.undo == nil {
			t.Fatalf("prepareReset(%s): undo = nil, want a record (HEAD is not unborn)", mode)
		}
		if !resetLabelPattern.MatchString(prep.undo.Label) {
			t.Fatalf("prepareReset(%s): label = %q, does not match %s", mode, prep.undo.Label, resetLabelPattern)
		}
	}
}

// gitOutputAllowingFailure runs a git command that is EXPECTED to exit non-zero (a real merge
// conflict) — runGitQ itself t.Fatals on any non-zero exit, so this is the one spawn in this file
// that goes through exec directly.
func gitOutputAllowingFailure(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	_ = cmd.Run() // the failure IS the point — a real conflicting merge, leaving MERGE_HEAD.
}

// initMidMergeRepo builds a real conflicting merge: "main" and "other" both diverge from the same
// base, changing the same line differently, then main merges other — exits non-zero, leaves
// MERGE_HEAD, exactly the state P10 probe 3 found git does NOT refuse a --mixed/--hard reset
// against.
func initMidMergeRepo(t *testing.T) (dir string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nline2\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "branch", "other")

	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nMAIN\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (main): %v", err)
	}
	runGitQ(t, dir, "commit", "-aqm", "main change")

	runGitQ(t, dir, "checkout", "-q", "other")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nOTHER\nline3\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (other): %v", err)
	}
	runGitQ(t, dir, "commit", "-aqm", "other change")

	runGitQ(t, dir, "checkout", "-q", "main")
	gitOutputAllowingFailure(t, dir, "merge", "other")
	return dir
}

// TestRunOp_ResetMidMerge_IsRefused is §3.10/D8's own proof: P10 probe 3 found git itself does NOT
// refuse a --mixed/--hard reset mid-merge — it silently succeeds and abandons MERGE_HEAD — so
// prepareReset's own host-side gate is the ONLY thing standing between a user and that data loss.
// Asserting MERGE_HEAD survives the refusal is the proof the gate actually works, not merely that
// an error came back.
func TestRunOp_ResetMidMerge_IsRefused(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initMidMergeRepo(t)
	mergeHead := filepath.Join(dir, ".git", "MERGE_HEAD")
	if _, err := os.Stat(mergeHead); err != nil {
		t.Fatalf("test setup failed to produce a real conflict — MERGE_HEAD missing: %v", err)
	}

	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{Kind: "reset", Mode: "mixed", Target: "HEAD"})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK {
		t.Fatalf("result.OK = true, want false — a reset mid-merge must be refused")
	}
	if result.Error == nil || result.Error.Kind != "OperationInProgress" {
		t.Fatalf("result.Error = %+v, want Kind = OperationInProgress", result.Error)
	}

	if _, err := os.Stat(mergeHead); err != nil {
		t.Fatalf("MERGE_HEAD did not survive the refusal — the safety gate failed: %v", err)
	}
}

// initEmptyCherryPickRepo builds a repo where cherry-picking "topic"'s own commit onto "main"
// produces literally no change: both branches apply the identical edit to the same base,
// independently. Probe 6: this exits non-zero, leaves CHERRY_PICK_HEAD set, a clean worktree and
// zero unmerged paths — the exact state reclassifyCherryPick must recognise.
func initEmptyCherryPickRepo(t *testing.T) (dir, topicSha string) {
	t.Helper()
	dir = t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	runGitQ(t, dir, "branch", "topic")

	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nCHANGED\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (main): %v", err)
	}
	runGitQ(t, dir, "commit", "-aqm", "change on main")

	runGitQ(t, dir, "checkout", "-q", "topic")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nCHANGED\n"), 0o644); err != nil {
		t.Fatalf("write f.txt (topic): %v", err)
	}
	runGitQ(t, dir, "commit", "-aqm", "same change on topic")
	topicSha = strings.TrimSpace(runOutput(t, dir, "rev-parse", "topic"))

	runGitQ(t, dir, "checkout", "-q", "main")
	return dir, topicSha
}

// TestRunOp_EmptyCherryPick_Reclassifies is §3.10/F6's own proof: an empty pick's stderr-only
// classification could only ever say Unknown (probe 6: the real message goes to a stream
// ClassifyOpError's table has no row for), so reclassifyCherryPick's exit-code-plus-read-back
// detection is what turns it into a real EmptyCherryPick — with CHERRY_PICK_HEAD still set
// afterward, exactly as the banner's own Continue/Skip choice needs.
func TestRunOp_EmptyCherryPick_Reclassifies(t *testing.T) {
	skipWithoutGitQueries(t)
	dir, topicSha := initEmptyCherryPickRepo(t)
	entry := newQueriesTestEntry(t, dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("test-conn"), "test-label", OpRequest{Kind: "cherryPick", Sha: topicSha})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK {
		t.Fatalf("result.OK = true, want false (an empty pick)")
	}
	if result.Error == nil || result.Error.Kind != "EmptyCherryPick" {
		t.Fatalf("result.Error = %+v, want Kind = EmptyCherryPick", result.Error)
	}

	cherryPickHead := filepath.Join(dir, ".git", "CHERRY_PICK_HEAD")
	if _, statErr := os.Stat(cherryPickHead); statErr != nil {
		t.Fatalf("CHERRY_PICK_HEAD missing after an empty-pick refusal: %v", statErr)
	}
}
