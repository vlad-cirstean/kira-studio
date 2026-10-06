package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
)

// A staged rename dirties its source path: checkout rewriting only the source must not read as a
// clean carry.
func TestDirtyPaths_StagedRenameIncludesSource(t *testing.T) {
	t.Parallel()
	status := porcelain.StatusResult{Entries: []porcelain.StatusEntry{
		{Kind: "renamed", Staged: 'R', Unstaged: '.', Path: "b", OriginalPath: "a", RenameOrCopy: "rename"},
	}}
	dirty := gitpreflight.DirtyPaths(status)
	want := []gitpreflight.DirtyPath{{Path: "b", Tracked: true}, {Path: "a", Tracked: true}}
	if !reflect.DeepEqual(dirty, want) {
		t.Fatalf("DirtyPaths = %v, want %v", dirty, want)
	}
	if got := gitpreflight.DirtySplit(status).Staged; !reflect.DeepEqual(got, []string{"b", "a"}) {
		t.Fatalf("DirtySplit.Staged = %v, want [b a]", got)
	}
	pre := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("t"), Mode: "switch", Dirty: dirty, Rewritten: []string{"a"},
	})
	if pre.Verdict == "cleanCarry" {
		t.Fatalf("verdict = %q, want a blocked or stash route", pre.Verdict)
	}
}
