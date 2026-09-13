package gitops_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// TestContinueArgs_Rebase and TestSkipArgs_Rebase are §7.1 item 5's own exit criterion: G26 D12
// gives rebase both a Continue and a Skip argv, retiring G5's "report-only posture".
func TestContinueArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.ContinueArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("ContinueArgs(InProgressRebase) ok = false, want true (G26 D12)")
	}
	if want := []string{"rebase", "--continue"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("ContinueArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

func TestSkipArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.SkipArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("SkipArgs(InProgressRebase) ok = false, want true (G26 D12)")
	}
	if want := []string{"rebase", "--skip"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("SkipArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

// TestAbortArgs_Rebase proves the pre-existing abort arm is untouched by this phase.
func TestAbortArgs_Rebase(t *testing.T) {
	t.Parallel()
	argv, ok := gitops.AbortArgs(gitpreflight.InProgressRebase)
	if !ok {
		t.Fatal("AbortArgs(InProgressRebase) ok = false, want true")
	}
	if want := []string{"rebase", "--abort"}; !reflect.DeepEqual(argv, want) {
		t.Fatalf("AbortArgs(InProgressRebase) = %v, want %v", argv, want)
	}
}

// TestSkipArgs_BisectStillRefused proves the widening is scoped to exactly the three kinds D12
// names — bisect (no --skip in git) still answers ok=false.
func TestSkipArgs_BisectStillRefused(t *testing.T) {
	t.Parallel()
	if _, ok := gitops.SkipArgs(gitpreflight.InProgressBisect); ok {
		t.Fatal("SkipArgs(InProgressBisect) ok = true, want false")
	}
}
