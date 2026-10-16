package gitops_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitops"
)

// TestRebaseArgs_RebaseMerges is P108 Part 15 F6's own regression proof at the argv-builder
// boundary: gitpreflight.WantsRebaseMerges' own "merges"/"m" signal must actually reach the argv
// as --rebase-merges, not just resolve to an ordinary PullRebase strategy.
func TestRebaseArgs_RebaseMerges(t *testing.T) {
	t.Parallel()
	if got, want := gitops.RebaseArgs("refs/remotes/origin/main", true),
		[]string{"rebase", "--rebase-merges", "refs/remotes/origin/main"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RebaseArgs(_, true) = %v, want %v", got, want)
	}
}

func TestRebaseArgs_PlainRebaseUnchanged(t *testing.T) {
	t.Parallel()
	if got, want := gitops.RebaseArgs("refs/remotes/origin/main", false),
		[]string{"rebase", "refs/remotes/origin/main"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("RebaseArgs(_, false) = %v, want %v", got, want)
	}
}
