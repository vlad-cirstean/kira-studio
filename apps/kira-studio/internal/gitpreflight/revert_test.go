package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func intp(n int) *int { return &n }

func TestClassifyRevert_NonMerge(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1"}, Prediction: gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
	if len(got.MainlineRequired) != 0 || len(got.Blockers) != 0 {
		t.Fatalf("got %+v, want no mainline requirement or blockers", got)
	}
	if got.PredictedFor == nil || *got.PredictedFor != "c1" {
		t.Fatalf("predictedFor = %v", got.PredictedFor)
	}
}

func TestClassifyRevert_MergeNoMainlineChosen(t *testing.T) {
	t.Parallel()
	parents := []gitpreflight.RevertParentChoice{
		{ParentNumber: 1, Sha: "p1", Subject: "mainline"},
		{ParentNumber: 2, Sha: "p2", Subject: "merged-in"},
	}
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas:         []string{"m1"},
		MergeParents: map[string][]gitpreflight.RevertParentChoice{"m1": parents},
		Prediction:   gitpreflight.RevertPrediction{Kind: "unknown", Reason: "a mainline parent must be chosen"},
	})
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
	if len(got.MainlineRequired) != 1 || got.MainlineRequired[0].Sha != "m1" {
		t.Fatalf("mainlineRequired = %+v", got.MainlineRequired)
	}
	if !reflect.DeepEqual(got.MainlineRequired[0].Parents, parents) {
		t.Fatalf("parents = %+v", got.MainlineRequired[0].Parents)
	}
	if !contains(got.Blockers, "mainlineRequired") {
		t.Fatalf("blockers = %v", got.Blockers)
	}
}

func TestClassifyRevert_MainlineAlreadySupplied(t *testing.T) {
	t.Parallel()
	parents := []gitpreflight.RevertParentChoice{{ParentNumber: 1, Sha: "p1"}, {ParentNumber: 2, Sha: "p2"}}
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas:         []string{"m1"},
		MergeParents: map[string][]gitpreflight.RevertParentChoice{"m1": parents},
		Mainline:     intp(1),
		Prediction:   gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if len(got.MainlineRequired) != 0 {
		t.Fatalf("mainlineRequired = %+v, want none once a mainline is chosen", got.MainlineRequired)
	}
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
}

// TestClassifyRevert_Octopus proves an octopus merge's own parent set (>2) flows through the same
// mainline-required path with no special casing.
func TestClassifyRevert_Octopus(t *testing.T) {
	t.Parallel()
	parents := []gitpreflight.RevertParentChoice{
		{ParentNumber: 1, Sha: "p1"}, {ParentNumber: 2, Sha: "p2"}, {ParentNumber: 3, Sha: "p3"},
	}
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"octo"}, MergeParents: map[string][]gitpreflight.RevertParentChoice{"octo": parents},
		Prediction: gitpreflight.RevertPrediction{Kind: "unknown", Reason: "no mainline"},
	})
	if len(got.MainlineRequired) != 1 || len(got.MainlineRequired[0].Parents) != 3 {
		t.Fatalf("mainlineRequired = %+v", got.MainlineRequired)
	}
}

func TestClassifyRevert_DirtyTree(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1"}, DirtyPaths: []string{"a.txt"},
		Prediction: gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if got.Verdict != "blocked" || !contains(got.Blockers, "dirtyWorktree") {
		t.Fatalf("got %+v", got)
	}
}

func TestClassifyRevert_InProgress(t *testing.T) {
	t.Parallel()
	op := &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressMerge, ConflictedPaths: []string{}}
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1"}, InProgress: op, Prediction: gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if got.Verdict != "blocked" || !contains(got.Blockers, "inProgressOperation") {
		t.Fatalf("got %+v", got)
	}
}

func TestClassifyRevert_DetachedHeadIsNoteNotBlocker(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1"}, DetachedHead: true, Prediction: gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean — detached HEAD is a note, not a blocker", got.Verdict)
	}
	if !got.DetachedHead {
		t.Fatal("detachedHead should still be reported")
	}
}

func TestClassifyRevert_WillConflict(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1"}, Prediction: gitpreflight.RevertPrediction{Kind: "conflicts", Paths: []string{"f.txt"}},
	})
	if got.Verdict != "willConflict" {
		t.Fatalf("verdict = %q", got.Verdict)
	}
}

// TestClassifyRevert_MultiSha proves predictedFor is always shas[0], regardless of selection size.
func TestClassifyRevert_MultiSha(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Shas: []string{"c1", "c2", "c3"}, Prediction: gitpreflight.RevertPrediction{Kind: "clean"},
	})
	if got.PredictedFor == nil || *got.PredictedFor != "c1" {
		t.Fatalf("predictedFor = %v, want c1", got.PredictedFor)
	}
}

func TestClassifyRevert_NoShas(t *testing.T) {
	t.Parallel()
	got := gitpreflight.ClassifyRevert(gitpreflight.ClassifyRevertInput{
		Prediction: gitpreflight.RevertPrediction{Kind: "unknown", Reason: "no commit selected"},
	})
	if got.PredictedFor != nil {
		t.Fatalf("predictedFor = %v, want nil", got.PredictedFor)
	}
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
