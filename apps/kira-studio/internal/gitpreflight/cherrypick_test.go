package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// cherryPickBase mirrors cherryPick.test.ts's own base() helper.
func cherryPickBase() gitpreflight.ClassifyCherryPickInput {
	return gitpreflight.ClassifyCherryPickInput{
		Sha: "c1", Subject: "the change to pick",
		MergeParents:   []gitpreflight.RevertParentChoice{},
		Mainline:       nil,
		CommitPaths:    gitpreflight.CherryPickCommitPaths{Touched: []string{"a.txt"}, Added: []string{"n.txt"}},
		Dirty:          gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{}, Untracked: []string{}},
		Prediction:     gitpreflight.RevertPrediction{Kind: "clean"},
		AlreadyApplied: false,
		InProgress:     nil,
		DetachedHead:   false,
	}
}

func blockerKinds(bs []gitpreflight.CherryPickBlocker) []string {
	out := make([]string, len(bs))
	for i, b := range bs {
		out[i] = b.Kind
	}
	return out
}

func TestClassifyCherryPick_DirtyTreeMatrix(t *testing.T) {
	t.Parallel()
	t.Run("A: unrelated unstaged dirt is tolerated — no blocker, clean verdict", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{"b.txt"}, Untracked: []string{}}
		got := gitpreflight.ClassifyCherryPick(in)
		if len(got.Blockers) != 0 {
			t.Fatalf("blockers = %+v, want empty", got.Blockers)
		}
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
	})

	t.Run("B: ANY staged change blocks, even to a file the pick never touches", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"b.txt"}, Unstaged: []string{}, Untracked: []string{}}
		got := gitpreflight.ClassifyCherryPick(in)
		want := []gitpreflight.CherryPickBlocker{{Kind: "stagedChanges", Paths: []string{"b.txt"}}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("C: unstaged dirt on a path the pick touches blocks as localChangesWouldBeOverwritten", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{"a.txt"}, Untracked: []string{}}
		got := gitpreflight.ClassifyCherryPick(in)
		want := []gitpreflight.CherryPickBlocker{{Kind: "localChangesWouldBeOverwritten", Paths: []string{"a.txt"}}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("D: staged dirt on a touched path blocks as stagedChanges, same as B — relation is irrelevant", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{}, Untracked: []string{}}
		got := gitpreflight.ClassifyCherryPick(in)
		want := []gitpreflight.CherryPickBlocker{{Kind: "stagedChanges", Paths: []string{"a.txt"}}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
	})

	t.Run("E: an untracked file in the way of one the pick adds blocks as untrackedWouldBeOverwritten", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{}, Untracked: []string{"n.txt"}}
		got := gitpreflight.ClassifyCherryPick(in)
		want := []gitpreflight.CherryPickBlocker{{Kind: "untrackedWouldBeOverwritten", Paths: []string{"n.txt"}}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("an untracked file NOT among the pick's added paths is not a blocker", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{}, Untracked: []string{"unrelated.txt"}}
		got := gitpreflight.ClassifyCherryPick(in)
		if len(got.Blockers) != 0 {
			t.Fatalf("blockers = %+v, want empty", got.Blockers)
		}
	})
}

func TestClassifyCherryPick_BlockerOrdering(t *testing.T) {
	t.Parallel()
	inProgress := &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressMerge, ConflictedPaths: []string{}}
	twoParents := []gitpreflight.RevertParentChoice{
		{ParentNumber: 1, Sha: "p1", Subject: "mainline work"},
		{ParentNumber: 2, Sha: "p2", Subject: "feature work"},
	}

	t.Run("every possible blocker at once, in the documented order", func(t *testing.T) {
		in := cherryPickBase()
		in.MergeParents = twoParents
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"s.txt"}, Unstaged: []string{"a.txt"}, Untracked: []string{"n.txt"}}
		in.InProgress = inProgress
		got := gitpreflight.ClassifyCherryPick(in)
		want := []string{
			"inProgressOperation", "mainlineRequired", "stagedChanges",
			"untrackedWouldBeOverwritten", "localChangesWouldBeOverwritten",
		}
		if !reflect.DeepEqual(blockerKinds(got.Blockers), want) {
			t.Fatalf("blocker kinds = %v, want %v", blockerKinds(got.Blockers), want)
		}
	})

	t.Run("an in-progress operation blocks alone, even an otherwise clean pick", func(t *testing.T) {
		in := cherryPickBase()
		in.InProgress = inProgress
		got := gitpreflight.ClassifyCherryPick(in)
		want := []gitpreflight.CherryPickBlocker{{Kind: "inProgressOperation", Operation: inProgress}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})
}

func TestClassifyCherryPick_Mainline(t *testing.T) {
	t.Parallel()
	twoParents := []gitpreflight.RevertParentChoice{
		{ParentNumber: 1, Sha: "p1", Subject: "mainline work"},
		{ParentNumber: 2, Sha: "p2", Subject: "feature work"},
	}

	t.Run("a merge commit with no mainline chosen names every parent, blocked", func(t *testing.T) {
		in := cherryPickBase()
		in.MergeParents = twoParents
		got := gitpreflight.ClassifyCherryPick(in)
		if !reflect.DeepEqual(got.MainlineRequired, twoParents) {
			t.Fatalf("mainlineRequired = %+v, want %+v", got.MainlineRequired, twoParents)
		}
		want := []gitpreflight.CherryPickBlocker{{Kind: "mainlineRequired", Parents: twoParents}}
		if !reflect.DeepEqual(got.Blockers, want) {
			t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("a merge commit with mainline already supplied ⇒ mainlineRequired empty, not blocked on it", func(t *testing.T) {
		in := cherryPickBase()
		in.MergeParents = twoParents
		m := 1
		in.Mainline = &m
		got := gitpreflight.ClassifyCherryPick(in)
		if len(got.MainlineRequired) != 0 {
			t.Fatalf("mainlineRequired = %+v, want empty", got.MainlineRequired)
		}
		if len(got.Blockers) != 0 {
			t.Fatalf("blockers = %+v, want empty", got.Blockers)
		}
	})

	t.Run("a non-merge commit never requires a mainline, regardless of the mainline field", func(t *testing.T) {
		in := cherryPickBase()
		in.MergeParents = []gitpreflight.RevertParentChoice{}
		in.Mainline = nil
		got := gitpreflight.ClassifyCherryPick(in)
		if len(got.MainlineRequired) != 0 {
			t.Fatalf("mainlineRequired = %+v, want empty", got.MainlineRequired)
		}
	})
}

func TestClassifyCherryPick_AlreadyAppliedIsAdvisory(t *testing.T) {
	t.Parallel()
	t.Run("alreadyApplied true with everything else clean ⇒ still verdict clean, no blocker", func(t *testing.T) {
		in := cherryPickBase()
		in.AlreadyApplied = true
		got := gitpreflight.ClassifyCherryPick(in)
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
		if len(got.Blockers) != 0 {
			t.Fatalf("blockers = %+v, want empty", got.Blockers)
		}
		if !got.AlreadyApplied {
			t.Fatal("alreadyApplied should still be reported")
		}
	})
}

func TestClassifyCherryPick_PredictionFoldsIntoVerdict(t *testing.T) {
	t.Parallel()
	t.Run("a conflicting prediction ⇒ willConflict, when nothing else blocks", func(t *testing.T) {
		in := cherryPickBase()
		in.Prediction = gitpreflight.RevertPrediction{Kind: "conflicts", Paths: []string{"a.txt"}}
		got := gitpreflight.ClassifyCherryPick(in)
		if got.Verdict != "willConflict" {
			t.Fatalf("verdict = %q, want willConflict", got.Verdict)
		}
	})

	t.Run("an unknown prediction does not by itself block or willConflict", func(t *testing.T) {
		in := cherryPickBase()
		in.Prediction = gitpreflight.RevertPrediction{Kind: "unknown", Reason: "spawn failed"}
		got := gitpreflight.ClassifyCherryPick(in)
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
	})

	t.Run("blocked takes precedence over a conflicting prediction", func(t *testing.T) {
		in := cherryPickBase()
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"s.txt"}, Unstaged: []string{}, Untracked: []string{}}
		in.Prediction = gitpreflight.RevertPrediction{Kind: "conflicts", Paths: []string{"a.txt"}}
		got := gitpreflight.ClassifyCherryPick(in)
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})
}

func TestClassifyCherryPick_DetachedHead(t *testing.T) {
	t.Parallel()
	t.Run("detachedHead true with everything else clean ⇒ still verdict clean", func(t *testing.T) {
		in := cherryPickBase()
		in.DetachedHead = true
		got := gitpreflight.ClassifyCherryPick(in)
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
		if len(got.Blockers) != 0 {
			t.Fatalf("blockers = %+v, want empty", got.Blockers)
		}
		if !got.DetachedHead {
			t.Fatal("detachedHead should still be reported")
		}
	})
}
