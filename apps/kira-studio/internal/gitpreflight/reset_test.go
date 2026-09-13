package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// resetBase mirrors reset.test.ts's own base() helper — a full, valid, "everything clean" input
// every subtest overrides from.
func resetBase() gitpreflight.ClassifyResetInput {
	branch := "main"
	return gitpreflight.ClassifyResetInput{
		Target: "abc1234", TargetSubject: "some commit", Mode: "mixed",
		CurrentHead: "def5678", Branch: &branch,
		Leaving: 0, Gaining: 0,
		LeavingCommits:   []gitpreflight.ResetLeavingCommit{},
		LeavingTruncated: false,
		Dirty:            gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{}, Untracked: []string{}},
		StagedNew:        []string{},
		InProgress:       nil,
		TargetResolves:   true,
	}
}

func TestClassifyReset_DestroysMatrix(t *testing.T) {
	t.Parallel()
	t.Run("soft never destroys, regardless of how dirty the tree is", func(t *testing.T) {
		in := resetBase()
		in.Mode = "soft"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{"b.txt"}, Untracked: []string{"c.txt"}}
		in.StagedNew = []string{"d.txt"}
		got := gitpreflight.ClassifyReset(in)
		if len(got.Destroys) != 0 {
			t.Fatalf("destroys = %v, want empty", got.Destroys)
		}
		if got.RequiresTypedConfirmation {
			t.Fatal("requiresTypedConfirmation = true, want false")
		}
		if len(got.Routes) != 0 {
			t.Fatalf("routes = %v, want empty", got.Routes)
		}
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
	})

	t.Run("mixed never destroys either — the difference lands as unstaged changes, not loss", func(t *testing.T) {
		in := resetBase()
		in.Mode = "mixed"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{"b.txt"}, Untracked: []string{"c.txt"}}
		in.StagedNew = []string{"d.txt"}
		got := gitpreflight.ClassifyReset(in)
		if len(got.Destroys) != 0 {
			t.Fatalf("destroys = %v, want empty", got.Destroys)
		}
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean", got.Verdict)
		}
	})

	t.Run("hard destroys staged and unstaged tracked changes", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{"b.txt"}, Untracked: []string{}}
		got := gitpreflight.ClassifyReset(in)
		want := map[string]bool{"a.txt": true, "b.txt": true}
		if len(got.Destroys) != 2 || !want[got.Destroys[0]] || !want[got.Destroys[1]] {
			t.Fatalf("destroys = %v, want [a.txt b.txt] in some order", got.Destroys)
		}
		if !got.RequiresTypedConfirmation {
			t.Fatal("requiresTypedConfirmation = false, want true")
		}
		if !reflect.DeepEqual(got.Routes, []string{"stashFirst"}) {
			t.Fatalf("routes = %v, want [stashFirst]", got.Routes)
		}
		if got.Verdict != "destructive" {
			t.Fatalf("verdict = %q, want destructive", got.Verdict)
		}
	})

	t.Run("hard destroys a staged NEW file too — probe 1's own 'looks untracked but isn't' case", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		in.StagedNew = []string{"new.txt"}
		got := gitpreflight.ClassifyReset(in)
		if !reflect.DeepEqual(got.Destroys, []string{"new.txt"}) {
			t.Fatalf("destroys = %v, want [new.txt]", got.Destroys)
		}
		if !got.RequiresTypedConfirmation {
			t.Fatal("requiresTypedConfirmation = false, want true")
		}
	})

	t.Run("hard leaves untracked and ignored files alone — they never enter destroys", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{}, Unstaged: []string{}, Untracked: []string{"scratch.txt", "build/out.js"}}
		got := gitpreflight.ClassifyReset(in)
		if len(got.Destroys) != 0 {
			t.Fatalf("destroys = %v, want empty", got.Destroys)
		}
		if got.RequiresTypedConfirmation {
			t.Fatal("requiresTypedConfirmation = true, want false")
		}
		if len(got.Routes) != 0 {
			t.Fatalf("routes = %v, want empty", got.Routes)
		}
		if got.Verdict != "clean" {
			t.Fatalf("verdict = %q, want clean — nothing at risk", got.Verdict)
		}
	})

	t.Run("hard with nothing at all to destroy has no typed-confirmation route", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		got := gitpreflight.ClassifyReset(in)
		if len(got.Destroys) != 0 || got.RequiresTypedConfirmation {
			t.Fatalf("destroys=%v requiresTypedConfirmation=%v, want empty/false", got.Destroys, got.RequiresTypedConfirmation)
		}
	})

	t.Run("hard de-duplicates a path that is both staged and (somehow) also staged-new", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{}, Untracked: []string{}}
		in.StagedNew = []string{"a.txt"}
		got := gitpreflight.ClassifyReset(in)
		if !reflect.DeepEqual(got.Destroys, []string{"a.txt"}) {
			t.Fatalf("destroys = %v, want [a.txt]", got.Destroys)
		}
	})
}

func TestClassifyReset_LeavingGaining(t *testing.T) {
	t.Parallel()
	t.Run("leaving === 0 forces the commit list empty even if the caller passed one", func(t *testing.T) {
		in := resetBase()
		in.Leaving = 0
		in.LeavingCommits = []gitpreflight.ResetLeavingCommit{{Sha: "x", Subject: "should not appear"}}
		got := gitpreflight.ClassifyReset(in)
		if len(got.LeavingCommits) != 0 {
			t.Fatalf("leavingCommits = %v, want empty", got.LeavingCommits)
		}
		if got.LeavingTruncated {
			t.Fatal("leavingTruncated = true, want false")
		}
	})

	t.Run("leaving > 0 passes the commit list and truncation flag through", func(t *testing.T) {
		in := resetBase()
		in.Leaving = 2
		in.LeavingCommits = []gitpreflight.ResetLeavingCommit{{Sha: "c1", Subject: "one"}, {Sha: "c2", Subject: "two"}}
		in.LeavingTruncated = true
		got := gitpreflight.ClassifyReset(in)
		if len(got.LeavingCommits) != 2 {
			t.Fatalf("leavingCommits = %v, want 2 entries", got.LeavingCommits)
		}
		if !got.LeavingTruncated {
			t.Fatal("leavingTruncated = false, want true")
		}
	})

	t.Run("a diverged target: both leaving and gaining are non-zero, and neither is silently dropped", func(t *testing.T) {
		in := resetBase()
		in.Leaving = 2
		in.Gaining = 2
		got := gitpreflight.ClassifyReset(in)
		if got.Leaving != 2 || got.Gaining != 2 {
			t.Fatalf("leaving=%d gaining=%d, want 2/2", got.Leaving, got.Gaining)
		}
	})
}

func TestClassifyReset_Blockers(t *testing.T) {
	t.Parallel()
	inProgress := &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressMerge, ConflictedPaths: []string{}}

	t.Run("an in-progress operation blocks, even against an otherwise clean soft reset", func(t *testing.T) {
		in := resetBase()
		in.Mode = "soft"
		in.InProgress = inProgress
		got := gitpreflight.ClassifyReset(in)
		if !reflect.DeepEqual(got.Blockers, []string{"inProgressOperation"}) {
			t.Fatalf("blockers = %v, want [inProgressOperation]", got.Blockers)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("a target that does not resolve blocks", func(t *testing.T) {
		in := resetBase()
		in.TargetResolves = false
		got := gitpreflight.ClassifyReset(in)
		if !reflect.DeepEqual(got.Blockers, []string{"unknownTarget"}) {
			t.Fatalf("blockers = %v, want [unknownTarget]", got.Blockers)
		}
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
	})

	t.Run("blocker order: inProgressOperation before unknownTarget", func(t *testing.T) {
		in := resetBase()
		in.InProgress = inProgress
		in.TargetResolves = false
		got := gitpreflight.ClassifyReset(in)
		if !reflect.DeepEqual(got.Blockers, []string{"inProgressOperation", "unknownTarget"}) {
			t.Fatalf("blockers = %v, want [inProgressOperation unknownTarget]", got.Blockers)
		}
	})

	t.Run("blocked takes precedence over destructive", func(t *testing.T) {
		in := resetBase()
		in.Mode = "hard"
		in.Dirty = gitpreflight.ResetDirty{Staged: []string{"a.txt"}, Unstaged: []string{}, Untracked: []string{}}
		in.InProgress = inProgress
		got := gitpreflight.ClassifyReset(in)
		if got.Verdict != "blocked" {
			t.Fatalf("verdict = %q, want blocked", got.Verdict)
		}
		if !reflect.DeepEqual(got.Destroys, []string{"a.txt"}) {
			t.Fatalf("destroys = %v, want [a.txt] — still computed either way", got.Destroys)
		}
	})
}

func TestClassifyReset_DetachedHead(t *testing.T) {
	t.Parallel()
	t.Run("branch: nil carries through untouched — the caller's own signal for 'HEAD only'", func(t *testing.T) {
		in := resetBase()
		in.Branch = nil
		got := gitpreflight.ClassifyReset(in)
		if got.Branch != nil {
			t.Fatalf("branch = %v, want nil", got.Branch)
		}
	})
}
