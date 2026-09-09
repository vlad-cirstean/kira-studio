package gitsession

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
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
	if len(opTable) != 19 {
		t.Fatalf("opTable has %d entries, want exactly 19 (D5, G25 adds worktreeAdd/worktreeRemove)", len(opTable))
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

// TestOpTable_ServesExactlyTheNineteenNamedKinds locks D5's own list, updated by G25's two new
// entries — a kind absent here answers ErrUnservedOpKind, never a stub.
func TestOpTable_ServesExactlyTheNineteenNamedKinds(t *testing.T) {
	want := []string{
		"checkout", "branchCreate", "branchDelete", "branchRename",
		"tagCreate", "tagDelete", "revert", "opContinue", "opAbort", "opSkip",
		"stashPush", "stashApply", "stashPop", "stashDrop", "stashBranch",
		"reset", "cherryPick", "worktreeAdd", "worktreeRemove",
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

// TestOpTable_UndoableKindsAreExactlyBranchTagDeleteStashDropResetAndCherryPick locks the five
// kinds this phase captures a real undo record for — reset and cherryPick join
// branchDelete/tagDelete/stashDrop at G22 (undo/slot.ts's own UNDO_POLICY marks all five
// undoable).
func TestOpTable_UndoableKindsAreExactlyBranchTagDeleteStashDropResetAndCherryPick(t *testing.T) {
	var undoable []string
	for kind, spec := range opTable {
		if spec.Undo.Kind == gitpreflight.Undoable {
			undoable = append(undoable, kind)
		}
	}
	if len(undoable) != 5 {
		t.Fatalf("undoable kinds = %v, want exactly 5 (branchDelete, tagDelete, stashDrop, reset, cherryPick)", undoable)
	}
	for _, k := range []string{"branchDelete", "tagDelete", "stashDrop", "reset", "cherryPick"} {
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
