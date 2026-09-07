package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func branchTarget(name string) gitpreflight.CheckoutTarget {
	return gitpreflight.CheckoutTarget{Kind: "branch", Name: name}
}

func TestClassifyCheckout_Clean(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
	})
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean: %+v", got.Verdict, got)
	}
	if len(got.Blockers) != 0 || len(got.Carried) != 0 {
		t.Fatalf("got %+v, want no blockers/carried", got)
	}
	if got.Detaches {
		t.Fatal("a plain branch switch must not detach")
	}
}

// TestClassifyCheckout_DirtyDisjointFromTarget proves the set-intersection rule directly: a dirty
// path the checkout does NOT rewrite carries over rather than blocking — clean carry, no prompt.
func TestClassifyCheckout_DirtyDisjointFromTarget(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty:     []gitpreflight.DirtyPath{{Path: "untouched.txt", Tracked: true}},
		Rewritten: []string{"other.txt"},
	})
	if got.Verdict != "cleanCarry" {
		t.Fatalf("verdict = %q, want cleanCarry", got.Verdict)
	}
	if !reflect.DeepEqual(got.Carried, []string{"untouched.txt"}) {
		t.Fatalf("carried = %v", got.Carried)
	}
	if len(got.Blockers) != 0 {
		t.Fatalf("blockers = %+v, want none", got.Blockers)
	}
}

func TestClassifyCheckout_BlockedByTracked(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty:     []gitpreflight.DirtyPath{{Path: "conflict.txt", Tracked: true}},
		Rewritten: []string{"conflict.txt"},
	})
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
	if len(got.Blockers) != 1 || got.Blockers[0].Kind != "blockedByTracked" {
		t.Fatalf("blockers = %+v", got.Blockers)
	}
	if !reflect.DeepEqual(got.Routes, []string{"discard"}) {
		t.Fatalf("routes = %v, want [discard]", got.Routes)
	}
}

func TestClassifyCheckout_BlockedByUntracked(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty:     []gitpreflight.DirtyPath{{Path: "conflict.txt", Tracked: false}},
		Rewritten: []string{"conflict.txt"},
	})
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
	if len(got.Blockers) != 1 || got.Blockers[0].Kind != "blockedByUntracked" {
		t.Fatalf("blockers = %+v", got.Blockers)
	}
	// Probe P9: --discard-changes cannot clear an untracked block — no route offered at all.
	if len(got.Routes) != 0 {
		t.Fatalf("routes = %v, want none", got.Routes)
	}
}

// TestClassifyCheckout_BothBlockerKindsSuppressRoutes proves an untracked block wins over a
// tracked one for route purposes even when both are present: no route helps either.
func TestClassifyCheckout_BothBlockerKindsSuppressRoutes(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty: []gitpreflight.DirtyPath{
			{Path: "tracked.txt", Tracked: true},
			{Path: "untracked.txt", Tracked: false},
		},
		Rewritten: []string{"tracked.txt", "untracked.txt"},
	})
	if len(got.Blockers) != 2 {
		t.Fatalf("blockers = %+v, want both kinds", got.Blockers)
	}
	// Order: inProgressOperation, worktreeConflict, blockedByUntracked, blockedByTracked.
	if got.Blockers[0].Kind != "blockedByUntracked" || got.Blockers[1].Kind != "blockedByTracked" {
		t.Fatalf("blocker order = %+v, want untracked before tracked", got.Blockers)
	}
	if len(got.Routes) != 0 {
		t.Fatalf("routes = %v, want none (untracked present)", got.Routes)
	}
}

func TestClassifyCheckout_StashAvailableAddsRoute(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty:          []gitpreflight.DirtyPath{{Path: "conflict.txt", Tracked: true}},
		Rewritten:      []string{"conflict.txt"},
		StashAvailable: true,
	})
	if !reflect.DeepEqual(got.Routes, []string{"discard", "stashAndCarry"}) {
		t.Fatalf("routes = %v", got.Routes)
	}
	// The false case, asserted alongside so the two states are seen together (D18).
	gotFalse := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty:          []gitpreflight.DirtyPath{{Path: "conflict.txt", Tracked: true}},
		Rewritten:      []string{"conflict.txt"},
		StashAvailable: false,
	})
	if !reflect.DeepEqual(gotFalse.Routes, []string{"discard"}) {
		t.Fatalf("routes = %v, want only discard", gotFalse.Routes)
	}
}

// TestClassifyCheckout_NonPathBlockersAloneAndCombined asserts the full blocker order (D18):
// inProgressOperation, worktreeConflict, blockedByUntracked, blockedByTracked.
func TestClassifyCheckout_NonPathBlockersOrder(t *testing.T) {
	op := &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressMerge, ConflictedPaths: []string{}}
	worktreePath := "/some/other/worktree"
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		InProgress:   op,
		CheckedOutIn: &worktreePath,
		Dirty: []gitpreflight.DirtyPath{
			{Path: "u.txt", Tracked: false},
			{Path: "t.txt", Tracked: true},
		},
		Rewritten: []string{"u.txt", "t.txt"},
	})
	if len(got.Blockers) != 4 {
		t.Fatalf("blockers = %+v, want 4", got.Blockers)
	}
	wantOrder := []string{"inProgressOperation", "worktreeConflict", "blockedByUntracked", "blockedByTracked"}
	for i, w := range wantOrder {
		if got.Blockers[i].Kind != w {
			t.Fatalf("blocker[%d] = %q, want %q (full order = %+v)", i, got.Blockers[i].Kind, w, got.Blockers)
		}
	}
	if got.Blockers[1].Branch != "topic" || got.Blockers[1].WorktreePath != worktreePath {
		t.Fatalf("worktreeConflict blocker = %+v", got.Blockers[1])
	}
}

func TestClassifyCheckout_InProgressAlone(t *testing.T) {
	op := &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressRevert, ConflictedPaths: []string{}}
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch", InProgress: op,
	})
	if len(got.Blockers) != 1 || got.Blockers[0].Kind != "inProgressOperation" || got.Blockers[0].Operation != op {
		t.Fatalf("blockers = %+v", got.Blockers)
	}
}

func TestClassifyCheckout_WorktreeConflictAlone(t *testing.T) {
	path := "/elsewhere"
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch", CheckedOutIn: &path,
	})
	if len(got.Blockers) != 1 || got.Blockers[0].Kind != "worktreeConflict" {
		t.Fatalf("blockers = %+v", got.Blockers)
	}
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
}

func TestClassifyCheckout_ShaTargetDetaches(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: gitpreflight.CheckoutTarget{Kind: "sha", Name: "abc1234"}, Mode: "switch",
	})
	if !got.Detaches {
		t.Fatal("a sha target must always detach")
	}
	if got.CreatesTracking != nil {
		t.Fatalf("createsTracking = %+v, want nil for a sha target", got.CreatesTracking)
	}
}

func TestClassifyCheckout_TagTargetDetaches(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: gitpreflight.CheckoutTarget{Kind: "tag", Name: "v1.0"}, Mode: "switch",
	})
	if !got.Detaches {
		t.Fatal("a tag target must always detach")
	}
}

// TestClassifyCheckout_RemoteBranchSwitchCreatesTracking is the DWIM-avoidance path: a plain
// switch to a remote-tracking ref with no local counterpart offers a labelled tracking-branch
// choice rather than detaching or guessing silently.
func TestClassifyCheckout_RemoteBranchSwitchCreatesTracking(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: gitpreflight.CheckoutTarget{Kind: "remoteBranch", Name: "origin/topic"}, Mode: "switch",
	})
	if got.Detaches {
		t.Fatal("a plain switch to a remote branch does not detach — it creates a tracking branch")
	}
	if got.CreatesTracking == nil || got.CreatesTracking.Branch != "topic" || got.CreatesTracking.Upstream != "origin/topic" {
		t.Fatalf("createsTracking = %+v", got.CreatesTracking)
	}
}

// TestClassifyCheckout_RemoteBranchDetachModeSkipsTracking proves an explicit detach never creates
// a tracking branch even for a remoteBranch target.
func TestClassifyCheckout_RemoteBranchDetachModeSkipsTracking(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: gitpreflight.CheckoutTarget{Kind: "remoteBranch", Name: "origin/topic"}, Mode: "detach",
	})
	if !got.Detaches {
		t.Fatal("mode=detach must detach even for a remote branch")
	}
	if got.CreatesTracking != nil {
		t.Fatalf("createsTracking = %+v, want nil under an explicit detach", got.CreatesTracking)
	}
}

func TestClassifyCheckout_EmptyRewrittenSet(t *testing.T) {
	got := gitpreflight.ClassifyCheckout(gitpreflight.ClassifyCheckoutInput{
		Target: branchTarget("topic"), Mode: "switch",
		Dirty: []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: true}},
	})
	if got.Verdict != "cleanCarry" {
		t.Fatalf("verdict = %q, want cleanCarry when T is empty (nothing to block on)", got.Verdict)
	}
	if !reflect.DeepEqual(got.Carried, []string{"a.txt"}) {
		t.Fatalf("carried = %v", got.Carried)
	}
}
