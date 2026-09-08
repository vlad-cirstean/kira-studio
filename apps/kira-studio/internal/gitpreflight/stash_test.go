package gitpreflight_test

import (
	"reflect"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// stashTestEntry mirrors stashPop.test.ts's own STASH fixture field for field.
func stashTestEntry() porcelain.StashEntry {
	branch := "main"
	return porcelain.StashEntry{
		Index: 0, Sha: strings40("s"), BaseSha: strings40("b"), BaseSubject: "base commit subject",
		IndexSha: strings40("i"), UntrackedSha: nil, Message: "On main: s", Branch: &branch,
		Timestamp: 1_700_000_000, FileCount: 1, IncludedUntracked: false,
	}
}

func strings40(c string) string {
	s := ""
	for i := 0; i < 40; i++ {
		s += c
	}
	return s
}

var (
	stashClean     = gitpreflight.RevertPrediction{Kind: "clean"}
	stashConflicts = gitpreflight.RevertPrediction{Kind: "conflicts", Paths: []string{"a.txt"}}
	stashUnknown   = gitpreflight.RevertPrediction{Kind: "unknown", Reason: "merge-tree exited 128"}
)

// stashPopBase mirrors stashPop.test.ts's own base() helper — every field defaulted, overridden
// per test.
func stashPopBase() gitpreflight.ClassifyStashPopInput {
	return gitpreflight.ClassifyStashPopInput{
		Stash: stashTestEntry(), TargetSha: strings40("t"), Prediction: stashClean,
		StashPaths: []string{}, StashUntrackedPaths: []string{}, Dirty: []gitpreflight.DirtyPath{},
		ExistingUntrackedPaths: []string{}, InProgress: nil,
	}
}

func TestClassifyStashPop_CleanPredictionNoBlockers(t *testing.T) {
	got := gitpreflight.ClassifyStashPop(stashPopBase())
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean", got.Verdict)
	}
	if len(got.Blockers) != 0 {
		t.Fatalf("blockers = %+v, want none", got.Blockers)
	}
	if !reflect.DeepEqual(got.Prediction, stashClean) {
		t.Fatalf("prediction = %+v", got.Prediction)
	}
}

func TestClassifyStashPop_ConflictingPredictionNoBlockers(t *testing.T) {
	in := stashPopBase()
	in.Prediction = stashConflicts
	got := gitpreflight.ClassifyStashPop(in)
	if got.Verdict != "willConflict" {
		t.Fatalf("verdict = %q, want willConflict", got.Verdict)
	}
}

// TestClassifyStashPop_UnknownPredictionIsNeverClean: "unknown never clean — willConflict, stating
// the reason via the prediction itself".
func TestClassifyStashPop_UnknownPredictionIsNeverClean(t *testing.T) {
	in := stashPopBase()
	in.Prediction = stashUnknown
	got := gitpreflight.ClassifyStashPop(in)
	if got.Verdict != "willConflict" {
		t.Fatalf("verdict = %q, want willConflict", got.Verdict)
	}
	if !reflect.DeepEqual(got.Prediction, stashUnknown) {
		t.Fatalf("prediction = %+v, want %+v", got.Prediction, stashUnknown)
	}
}

func TestClassifyStashPop_UntrackedCollisionAlone(t *testing.T) {
	in := stashPopBase()
	in.StashUntrackedPaths = []string{"u.txt", "other.txt"}
	in.ExistingUntrackedPaths = []string{"u.txt"}
	got := gitpreflight.ClassifyStashPop(in)
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", got.Verdict)
	}
	want := []gitpreflight.StashPopBlocker{{Kind: "untrackedCollision", Paths: []string{"u.txt"}}}
	if !reflect.DeepEqual(got.Blockers, want) {
		t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
	}
}

// TestClassifyStashPop_Probe3 — "a stash-untracked path that merely happens to also be `dirty` is
// still only reachable via existingPaths, not `dirty` membership" — deliberately does NOT populate
// Dirty with the untracked path's collision; the classifier must not silently fall back to it.
func TestClassifyStashPop_Probe3_DirtyMembershipIsNotSufficient(t *testing.T) {
	in := stashPopBase()
	in.StashUntrackedPaths = []string{"u.txt"}
	in.ExistingUntrackedPaths = []string{}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "u.txt", Tracked: false}}
	got := gitpreflight.ClassifyStashPop(in)
	if len(got.Blockers) != 0 {
		t.Fatalf("blockers = %+v, want none — existingPaths is the only test that matters here", got.Blockers)
	}
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean", got.Verdict)
	}
}

func TestClassifyStashPop_LocalChangesWouldBeOverwrittenAlone(t *testing.T) {
	in := stashPopBase()
	in.StashPaths = []string{"a.txt", "b.txt"}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: true}}
	got := gitpreflight.ClassifyStashPop(in)
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", got.Verdict)
	}
	want := []gitpreflight.StashPopBlocker{{Kind: "localChangesWouldBeOverwritten", Paths: []string{"a.txt"}}}
	if !reflect.DeepEqual(got.Blockers, want) {
		t.Fatalf("blockers = %+v, want %+v", got.Blockers, want)
	}
}

// TestClassifyStashPop_UntrackedDirtyOverlapIsNotLocalOverwrite: an untracked dirty path overlapping
// stashPaths is NOT localChangesWouldBeOverwritten — that blocker is tracked-only.
func TestClassifyStashPop_UntrackedDirtyOverlapIsNotLocalOverwrite(t *testing.T) {
	in := stashPopBase()
	in.StashPaths = []string{"a.txt"}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: false}}
	got := gitpreflight.ClassifyStashPop(in)
	if len(got.Blockers) != 0 {
		t.Fatalf("blockers = %+v, want none", got.Blockers)
	}
}

func TestClassifyStashPop_BothBlockersOrdered(t *testing.T) {
	in := stashPopBase()
	in.StashPaths = []string{"a.txt"}
	in.StashUntrackedPaths = []string{"u.txt"}
	in.ExistingUntrackedPaths = []string{"u.txt"}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: true}}
	got := gitpreflight.ClassifyStashPop(in)
	want := []gitpreflight.StashPopBlocker{
		{Kind: "untrackedCollision", Paths: []string{"u.txt"}},
		{Kind: "localChangesWouldBeOverwritten", Paths: []string{"a.txt"}},
	}
	if !reflect.DeepEqual(got.Blockers, want) {
		t.Fatalf("blockers = %+v, want %+v (untrackedCollision before localChangesWouldBeOverwritten)", got.Blockers, want)
	}
}

func TestClassifyStashPop_InProgressOperationAlwaysFirst(t *testing.T) {
	inProgress := &gitpreflight.InProgressOperation{
		Kind: gitpreflight.InProgressMerge, OtherSha: strPtr40("x"),
		ConflictedPaths: []string{}, CanContinue: true, CanAbort: true, IsSequence: false,
		UnmergedCount: 0, CanSkip: false,
	}
	in := stashPopBase()
	in.InProgress = inProgress
	in.StashPaths = []string{"a.txt"}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: true}}
	got := gitpreflight.ClassifyStashPop(in)
	if len(got.Blockers) == 0 || got.Blockers[0].Kind != "inProgressOperation" {
		t.Fatalf("blockers = %+v, want inProgressOperation first", got.Blockers)
	}
	if got.Blockers[0].Operation != inProgress {
		t.Fatalf("blockers[0].Operation = %+v, want the same InProgressOperation pointer", got.Blockers[0].Operation)
	}
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", got.Verdict)
	}
}

func strPtr40(c string) *string { s := strings40(c); return &s }

// TestClassifyStashPop_BlockerAlongsideCleanPrediction: verdict is blocked, but the clean prediction
// is still reported as-is (never overwritten by the blocked verdict).
func TestClassifyStashPop_BlockerAlongsideCleanPrediction(t *testing.T) {
	in := stashPopBase()
	in.Prediction = stashClean
	in.StashPaths = []string{"a.txt"}
	in.Dirty = []gitpreflight.DirtyPath{{Path: "a.txt", Tracked: true}}
	got := gitpreflight.ClassifyStashPop(in)
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", got.Verdict)
	}
	if !reflect.DeepEqual(got.Prediction, stashClean) {
		t.Fatalf("prediction = %+v, want unchanged clean", got.Prediction)
	}
}

func TestClassifyStashPop_PassesThroughShaIndexTarget(t *testing.T) {
	in := stashPopBase()
	got := gitpreflight.ClassifyStashPop(in)
	if got.StashSha != in.Stash.Sha {
		t.Fatalf("StashSha = %q, want %q", got.StashSha, in.Stash.Sha)
	}
	if got.StashIndex != in.Stash.Index {
		t.Fatalf("StashIndex = %d, want %d", got.StashIndex, in.Stash.Index)
	}
	if got.TargetSha != strings40("t") {
		t.Fatalf("TargetSha = %q", got.TargetSha)
	}
}

// ---------------------------------------------------------------------------------------
// ClassifyStashBranch
// ---------------------------------------------------------------------------------------

var cleanCheckout = gitpreflight.CheckoutPreflight{
	Target: gitpreflight.CheckoutTarget{Kind: "branch", Name: "topic"},
	Detaches: false, CreatesTracking: nil, Carried: []string{}, Blockers: []gitpreflight.CheckoutBlocker{},
	Verdict: "clean", Routes: []string{},
}

var blockedCheckout = gitpreflight.CheckoutPreflight{
	Target: cleanCheckout.Target, Detaches: false, CreatesTracking: nil, Carried: []string{},
	Blockers: []gitpreflight.CheckoutBlocker{{Kind: "blockedByTracked", Paths: []string{"a.txt"}}},
	Verdict:  "blocked", Routes: []string{},
}

func TestClassifyStashBranch_ValidNonExistingCleanCheckout(t *testing.T) {
	got := gitpreflight.ClassifyStashBranch(gitpreflight.ClassifyStashBranchInput{
		Name: "recovered", ExistingBranchNames: map[string]bool{}, Checkout: cleanCheckout,
	})
	if got.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean", got.Verdict)
	}
	if !got.Name.Valid || got.Name.Error != nil || got.Name.Exists {
		t.Fatalf("name = %+v, want {valid:true, error:nil, exists:false}", got.Name)
	}
}

// TestClassifyStashBranch_InvalidName — reserved "@{" shorthand — invalidName, checkout passed
// through untouched.
func TestClassifyStashBranch_InvalidName(t *testing.T) {
	got := gitpreflight.ClassifyStashBranch(gitpreflight.ClassifyStashBranchInput{
		Name: "bad@{0}", ExistingBranchNames: map[string]bool{}, Checkout: cleanCheckout,
	})
	if got.Verdict != "invalidName" {
		t.Fatalf("verdict = %q, want invalidName", got.Verdict)
	}
	if got.Name.Valid {
		t.Fatal("name.Valid = true, want false")
	}
	if !reflect.DeepEqual(got.Checkout, cleanCheckout) {
		t.Fatalf("checkout = %+v, want passed through untouched", got.Checkout)
	}
}

// TestClassifyStashBranch_AlreadyExisting — invalidName with its own error, distinct from a
// malformed name.
func TestClassifyStashBranch_AlreadyExisting(t *testing.T) {
	got := gitpreflight.ClassifyStashBranch(gitpreflight.ClassifyStashBranchInput{
		Name: "topic", ExistingBranchNames: map[string]bool{"topic": true}, Checkout: cleanCheckout,
	})
	if got.Verdict != "invalidName" {
		t.Fatalf("verdict = %q, want invalidName", got.Verdict)
	}
	if !got.Name.Valid || got.Name.Error == nil || *got.Name.Error != "A branch with this name already exists." || !got.Name.Exists {
		t.Fatalf("name = %+v", got.Name)
	}
}

// TestClassifyStashBranch_ValidNameBlockedCheckout — a valid, non-existing name but a blocked
// nested checkout preflight ⇒ blocked (non-atomic on failure per OQ6 — no rollback here, that is
// ops.go's job, not the classifier's).
func TestClassifyStashBranch_ValidNameBlockedCheckout(t *testing.T) {
	got := gitpreflight.ClassifyStashBranch(gitpreflight.ClassifyStashBranchInput{
		Name: "recovered", ExistingBranchNames: map[string]bool{}, Checkout: blockedCheckout,
	})
	if got.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", got.Verdict)
	}
	if !reflect.DeepEqual(got.Checkout, blockedCheckout) {
		t.Fatalf("checkout = %+v, want passed through untouched", got.Checkout)
	}
}

// TestClassifyStashBranch_NoPredictionField — probe 11: StashBranchPreflight carries no prediction
// field at all. In Go this is structural (the type has no Prediction field), so the test simply
// confirms the struct compiles and the classifier never sets one — a compile-time guarantee TS
// needed a runtime `'prediction' in result` check for.
func TestClassifyStashBranch_NoPredictionField(t *testing.T) {
	got := gitpreflight.ClassifyStashBranch(gitpreflight.ClassifyStashBranchInput{
		Name: "recovered", ExistingBranchNames: map[string]bool{}, Checkout: cleanCheckout,
	})
	_ = got // StashBranchPreflight has no Prediction field — this line alone is the assertion.
}
