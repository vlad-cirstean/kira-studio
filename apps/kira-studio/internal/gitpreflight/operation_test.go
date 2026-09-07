package gitpreflight_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func strp(s string) *string { return &s }

func TestClassifyInProgress_NoState(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{}, nil)
	if op != nil {
		t.Fatalf("op = %+v, want nil", op)
	}
}

func TestClassifyInProgress_Merge(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{MergeHead: strp("abc123")}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressMerge {
		t.Fatalf("op = %+v", op)
	}
	if !op.CanContinue || !op.CanAbort || op.CanSkip {
		t.Fatalf("op = %+v, want canContinue/canAbort true, canSkip false", op)
	}
	if op.OtherSha == nil || *op.OtherSha != "abc123" {
		t.Fatalf("otherSha = %v", op.OtherSha)
	}
}

func TestClassifyInProgress_CherryPick(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{CherryPickHead: strp("c1")}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressCherryPick || !op.CanSkip {
		t.Fatalf("op = %+v, want cherryPick with canSkip", op)
	}
}

func TestClassifyInProgress_Revert(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{RevertHead: strp("r1")}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressRevert || !op.CanSkip {
		t.Fatalf("op = %+v, want revert with canSkip", op)
	}
}

func TestClassifyInProgress_Rebase(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{
		RebaseMergeDir: true, RebaseHeadName: strp("refs/heads/side"), RebaseOnto: strp("onto-sha"),
	}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressRebase {
		t.Fatalf("op = %+v", op)
	}
	if op.CanContinue {
		t.Fatal("rebase must never offer Continue (§9's report-only posture)")
	}
	if !op.CanAbort {
		t.Fatal("rebase should offer Abort")
	}
	if op.CanSkip {
		t.Fatal("rebase should not offer Skip")
	}
	if op.HeadName == nil || *op.HeadName != "refs/heads/side" {
		t.Fatalf("headName = %v", op.HeadName)
	}
}

// TestClassifyInProgress_RebaseShadowsSequencerFiles proves the precedence table's own shadowing
// rule: a rebase stopped on a conflict can ALSO leave sequencer-shaped files behind, but rebase
// must still win.
func TestClassifyInProgress_RebaseShadowsSequencerFiles(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{
		RebaseMergeDir: true, CherryPickHead: strp("would-be-cherry-pick"), SequencerDir: true,
	}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressRebase {
		t.Fatalf("op = %+v, want rebase to shadow cherryPick", op)
	}
	if !op.IsSequence {
		t.Fatal("isSequence should still be true")
	}
}

func TestClassifyInProgress_Bisect(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{BisectLog: true}, nil)
	if op == nil || op.Kind != gitpreflight.InProgressBisect {
		t.Fatalf("op = %+v", op)
	}
	if op.CanContinue || op.CanSkip {
		t.Fatal("bisect offers neither continue nor skip")
	}
}

// TestClassifyInProgress_UnmergedOnlyWithNoStateFile proves the fallback case: unmerged paths with
// none of the six state files present (a resolved-then-reset state, or `checkout -m`).
func TestClassifyInProgress_UnmergedOnlyWithNoStateFile(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{}, []string{"a.txt", "b.txt"})
	if op == nil || op.Kind != gitpreflight.InProgressUnmergedOnly {
		t.Fatalf("op = %+v", op)
	}
	if op.CanContinue || op.CanAbort {
		t.Fatal("unmergedOnly offers neither continue nor abort")
	}
	if op.UnmergedCount != 2 {
		t.Fatalf("unmergedCount = %d, want 2", op.UnmergedCount)
	}
}

// TestClassifyInProgress_CanContinueIndependentOfUnmergedCount proves canContinue/canSkip are
// kind-level facts, never derived from conflictedPaths/unmergedCount — the banner's own enablement
// rule (canContinue && unmergedCount === 0) depends on the two staying independent.
func TestClassifyInProgress_CanContinueIndependentOfUnmergedCount(t *testing.T) {
	withConflicts := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{MergeHead: strp("m")}, []string{"x.txt"})
	withoutConflicts := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{MergeHead: strp("m")}, nil)
	if !withConflicts.CanContinue || !withoutConflicts.CanContinue {
		t.Fatalf("canContinue should be true regardless of unmergedCount: %+v / %+v", withConflicts, withoutConflicts)
	}
	if withConflicts.UnmergedCount != 1 || withoutConflicts.UnmergedCount != 0 {
		t.Fatalf("unmergedCount mismatch: %+v / %+v", withConflicts, withoutConflicts)
	}
}

func TestDescribeInProgress_Rebase(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{
		RebaseMergeDir: true, RebaseHeadName: strp("refs/heads/side"),
	}, nil)
	if got := gitpreflight.DescribeInProgress(op); got != "Rebasing side" {
		t.Fatalf("got %q", got)
	}
}

func TestDescribeInProgress_RevertWithSha(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{RevertHead: strp("d657c6ef00000000")}, nil)
	if got := gitpreflight.DescribeInProgress(op); got != "Reverting `d657c6e`" {
		t.Fatalf("got %q", got)
	}
}

func TestDescribeInProgress_UnmergedOnly(t *testing.T) {
	op := gitpreflight.ClassifyInProgress(gitpreflight.InProgressStateFiles{}, []string{"a.txt"})
	if got := gitpreflight.DescribeInProgress(op); got != "Unresolved conflict" {
		t.Fatalf("got %q", got)
	}
}
