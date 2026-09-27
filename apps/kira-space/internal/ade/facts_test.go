package ade

import (
	"errors"
	"testing"
)

// facts_test.go covers exactly §4.5's own bullet list for the six pure functions in facts.go —
// package ade (white-box), matching tracker_test.go/command_test.go's own convention.

// ---------------------------------------------------------------------------------------
// inferParents (§0.5)
// ---------------------------------------------------------------------------------------

func TestInferParents_ConfigWins(t *testing.T) {
	t.Parallel()
	nodes := map[string]branchNode{
		"a": {ConfigParent: "b"},
		"b": {},
	}
	got := inferParents(nodes, map[string]int{})
	if got["a"] != "b" {
		t.Fatalf("a's parent = %q, want b", got["a"])
	}
}

func TestInferParents_ConfigNamingMergedFallsThrough(t *testing.T) {
	t.Parallel()
	nodes := map[string]branchNode{
		"a": {ConfigParent: "b", Ancestors: []string{"c"}},
		"b": {Merged: true},
		"c": {},
	}
	got := inferParents(nodes, map[string]int{"c": 1})
	if got["a"] != "c" {
		t.Fatalf("a's parent = %q, want c (config parent b is merged, falls through to rule 2)", got["a"])
	}
}

func TestInferParents_DeepestAncestorChosen(t *testing.T) {
	t.Parallel()
	nodes := map[string]branchNode{
		"a":       {Ancestors: []string{"shallow", "deep"}},
		"shallow": {},
		"deep":    {},
	}
	depths := map[string]int{"shallow": 1, "deep": 3}
	got := inferParents(nodes, depths)
	if got["a"] != "deep" {
		t.Fatalf("a's parent = %q, want deep (larger depth)", got["a"])
	}
}

func TestInferParents_TieBrokenByStartFromThenName(t *testing.T) {
	t.Parallel()
	// Equal depths, start_from names one of the two ancestors: that one wins over the name-order
	// tie-break.
	nodes := map[string]branchNode{
		"a": {Ancestors: []string{"x", "y"}, StartFrom: "y"},
		"x": {},
		"y": {},
	}
	depths := map[string]int{"x": 2, "y": 2}
	got := inferParents(nodes, depths)
	if got["a"] != "y" {
		t.Fatalf("a's parent = %q, want y (start_from tie-break)", got["a"])
	}

	// Equal depths, no start_from hint among them: falls to lexicographically smallest name.
	nodes2 := map[string]branchNode{
		"a": {Ancestors: []string{"y", "x"}},
		"x": {},
		"y": {},
	}
	depths2 := map[string]int{"x": 2, "y": 2}
	got2 := inferParents(nodes2, depths2)
	if got2["a"] != "x" {
		t.Fatalf("a's parent = %q, want x (name tie-break)", got2["a"])
	}
}

func TestInferParents_EqualTipStartFromHint(t *testing.T) {
	t.Parallel()
	// No ancestors at all (freshly branched, zero commits), start_from hint applies via rule 3.
	nodes := map[string]branchNode{
		"a": {StartFrom: "b", MergeBaseEqualsStartFrom: true},
		"b": {},
	}
	got := inferParents(nodes, map[string]int{})
	if got["a"] != "b" {
		t.Fatalf("a's parent = %q, want b (rule 3 start_from hint)", got["a"])
	}
}

func TestInferParents_CycleViaConfigResolvesOneSideToMain(t *testing.T) {
	t.Parallel()
	nodes := map[string]branchNode{
		"a": {ConfigParent: "b"},
		"b": {ConfigParent: "a"},
	}
	got := inferParents(nodes, map[string]int{})
	// Sorted processing order is a, b: a's own walk (a -> b -> a) is the one that runs first and
	// detects the cycle, closing it at its own last hop before the repeat — b's parent (not a's) is
	// the one broken to main, since b -> a is the edge that would revisit a. a keeps pointing at b.
	if got["a"] != "b" {
		t.Fatalf("a's parent = %q, want b", got["a"])
	}
	if got["b"] != "" {
		t.Fatalf("b's parent = %q, want \"\" (cycle break)", got["b"])
	}
}

func TestInferParents_RootFallsToMain(t *testing.T) {
	t.Parallel()
	nodes := map[string]branchNode{"a": {}}
	got := inferParents(nodes, map[string]int{})
	if got["a"] != "" {
		t.Fatalf("a's parent = %q, want \"\" (no config/ancestor/start_from)", got["a"])
	}
}

// ---------------------------------------------------------------------------------------
// pairFacts (§0.7, §4.3)
// ---------------------------------------------------------------------------------------

func noAncestor(x, y string) bool { return false }

func mergeTreeReturning(paths ...string) func(string, string) ([]string, error) {
	return func(string, string) ([]string, error) { return paths, nil }
}

func TestPairFacts_MineReviewConflict(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "rev1", Tip: "t2", Kind: "review", Files: map[string]bool{"a.go": true}},
	}
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning("a.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 1 {
		t.Fatalf("got %d pairs, want 1: %+v", len(pairs), pairs)
	}
	if pairs[0].A != "mine1" || pairs[0].B != "rev1" {
		t.Fatalf("pair = %+v, want A=mine1 B=rev1 (mine always ordered a)", pairs[0])
	}
	if len(pairs[0].Conflicts) != 1 || pairs[0].Conflicts[0] != "a.go" {
		t.Fatalf("Conflicts = %v, want [a.go]", pairs[0].Conflicts)
	}
}

func TestPairFacts_MineMineShare(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "b", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "a", Tip: "t2", Kind: "mine", Files: map[string]bool{"a.go": true}},
	}
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning())
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 1 {
		t.Fatalf("got %d pairs, want 1: %+v", len(pairs), pairs)
	}
	if pairs[0].A != "a" || pairs[0].B != "b" {
		t.Fatalf("pair = %+v, want A=a B=b (mine x mine ordered by name)", pairs[0])
	}
	if len(pairs[0].Shared) != 1 || pairs[0].Shared[0] != "a.go" {
		t.Fatalf("Shared = %v, want [a.go]", pairs[0].Shared)
	}
	if len(pairs[0].Conflicts) != 0 {
		t.Fatalf("Conflicts = %v, want none (clean merge)", pairs[0].Conflicts)
	}
}

func TestPairFacts_ParkedExcluded(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "parked1", Tip: "t2", Kind: "parked", Files: map[string]bool{"a.go": true}},
	}
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning("a.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 0 {
		t.Fatalf("got %d pairs, want 0 (parked excluded)", len(pairs))
	}
}

func TestPairFacts_MergedExcluded(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "t2", Kind: "mine", Merged: true, Files: map[string]bool{"a.go": true}},
	}
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning("a.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 0 {
		t.Fatalf("got %d pairs, want 0 (merged excluded)", len(pairs))
	}
}

func TestPairFacts_AncestorPairExcluded(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "t2", Kind: "mine", Files: map[string]bool{"a.go": true}},
	}
	isAncestor := func(x, y string) bool { return true }
	pairs, err := pairFacts(items, isAncestor, mergeTreeReturning("a.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 0 {
		t.Fatalf("got %d pairs, want 0 (ancestor pair excluded)", len(pairs))
	}
}

func TestPairFacts_ReviewReviewExcluded(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "rev1", Tip: "t1", Kind: "review", Files: map[string]bool{"a.go": true}},
		{Item: "rev2", Tip: "t2", Kind: "review", Files: map[string]bool{"a.go": true}},
	}
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning("a.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 0 {
		t.Fatalf("got %d pairs, want 0 (review x review is never a pair)", len(pairs))
	}
}

func TestPairFacts_NoSharedPathsNoMergeTreeCall(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "t2", Kind: "mine", Files: map[string]bool{"b.go": true}},
	}
	calls := 0
	mergeTree := func(a, b string) ([]string, error) {
		calls++
		return nil, nil
	}
	pairs, err := pairFacts(items, noAncestor, mergeTree)
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 0 {
		t.Fatalf("got %d pairs, want 0 (no shared paths)", len(pairs))
	}
	if calls != 0 {
		t.Fatalf("mergeTree called %d times, want 0 (no candidate pair to check)", calls)
	}
}

func TestPairFacts_ConflictedPathOutsideSharedDropped(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "t2", Kind: "mine", Files: map[string]bool{"a.go": true}},
	}
	// merge-tree reports a conflict in c.go too, but c.go is not one of the two items' own shared
	// changed files (e.g. it's a file only one of them ever touched, base picked up elsewhere) —
	// Conflicts must stay confined to shared.
	pairs, err := pairFacts(items, noAncestor, mergeTreeReturning("a.go", "c.go"))
	if err != nil {
		t.Fatalf("pairFacts: %v", err)
	}
	if len(pairs) != 1 {
		t.Fatalf("got %d pairs, want 1", len(pairs))
	}
	if len(pairs[0].Conflicts) != 1 || pairs[0].Conflicts[0] != "a.go" {
		t.Fatalf("Conflicts = %v, want [a.go] (c.go dropped, outside shared)", pairs[0].Conflicts)
	}
}

func TestPairFacts_CacheHitOnUnchangedTips(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "tip-a", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "tip-b", Kind: "mine", Files: map[string]bool{"a.go": true}},
	}
	realCalls := 0
	real := func(a, b string) ([]string, error) {
		realCalls++
		return []string{"a.go"}, nil
	}
	// A tip-keyed cache wrapping mergeTree — the property under test is that pairFacts' own
	// tip-based callback signature (not item ids) lets the CALLER cache across repeat calls with
	// unchanged tips, exactly as queue.go's own golang-lru wrapper does (§4.2).
	cache := map[[2]string][]string{}
	cached := func(a, b string) ([]string, error) {
		key := [2]string{a, b}
		if v, ok := cache[key]; ok {
			return v, nil
		}
		v, err := real(a, b)
		if err != nil {
			return nil, err
		}
		cache[key] = v
		return v, nil
	}

	if _, err := pairFacts(items, noAncestor, cached); err != nil {
		t.Fatalf("pairFacts (1st call): %v", err)
	}
	if _, err := pairFacts(items, noAncestor, cached); err != nil {
		t.Fatalf("pairFacts (2nd call): %v", err)
	}
	if realCalls != 1 {
		t.Fatalf("real mergeTree called %d times across two pairFacts calls with unchanged tips, want 1 (cache hit)", realCalls)
	}
}

func TestPairFacts_MergeTreeError(t *testing.T) {
	t.Parallel()
	items := []pairItem{
		{Item: "mine1", Tip: "t1", Kind: "mine", Files: map[string]bool{"a.go": true}},
		{Item: "mine2", Tip: "t2", Kind: "mine", Files: map[string]bool{"a.go": true}},
	}
	wantErr := errors.New("boom")
	mergeTree := func(a, b string) ([]string, error) { return nil, wantErr }
	if _, err := pairFacts(items, noAncestor, mergeTree); !errors.Is(err, wantErr) {
		t.Fatalf("pairFacts error = %v, want %v propagated", err, wantErr)
	}
}

// ---------------------------------------------------------------------------------------
// mergedRule (§0.8)
// ---------------------------------------------------------------------------------------

func TestMergedRule(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name                  string
		tipReachable, commits bool
		prState               string
		want                  bool
	}{
		{"ancestor without had_commits not merged", true, false, "", false},
		{"ancestor with had_commits merged", true, true, "", true},
		{"PR merged wins", false, false, "merged", true},
		{"PR closed not merged", false, false, "closed", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := mergedRule(c.tipReachable, c.commits, c.prState); got != c.want {
				t.Fatalf("mergedRule(%v, %v, %q) = %v, want %v", c.tipReachable, c.commits, c.prState, got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------------------
// rebindCandidates (§0.10)
// ---------------------------------------------------------------------------------------

func TestRebindCandidates_TypedNameExists(t *testing.T) {
	t.Parallel()
	candidates := []rebindCandidate{{Name: "feature-x", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000}}
	got := rebindCandidates("feature-x", 500, candidates)
	if got.Bind != "feature-x" || len(got.Candidates) != 0 {
		t.Fatalf("got %+v, want Bind=feature-x", got)
	}
}

func TestRebindCandidates_TypedNameMissing(t *testing.T) {
	t.Parallel()
	candidates := []rebindCandidate{{Name: "other", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000}}
	got := rebindCandidates("feature-x", 500, candidates)
	if got.Bind != "" || len(got.Candidates) != 0 {
		t.Fatalf("got %+v, want unbound with no candidates (typed name never falls through to heuristic)", got)
	}
}

func TestRebindCandidates_OneCandidateBinds(t *testing.T) {
	t.Parallel()
	candidates := []rebindCandidate{
		{Name: "a", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000},
	}
	got := rebindCandidates("", 500, candidates)
	if got.Bind != "a" {
		t.Fatalf("got %+v, want Bind=a", got)
	}
}

func TestRebindCandidates_TwoAmbiguous(t *testing.T) {
	t.Parallel()
	candidates := []rebindCandidate{
		{Name: "b", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000},
		{Name: "a", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000},
	}
	got := rebindCandidates("", 500, candidates)
	if got.Bind != "" {
		t.Fatalf("Bind = %q, want \"\" (ambiguous)", got.Bind)
	}
	if len(got.Candidates) != 2 || got.Candidates[0] != "a" || got.Candidates[1] != "b" {
		t.Fatalf("Candidates = %v, want [a b] sorted", got.Candidates)
	}
}

func TestRebindCandidates_CreatedBeforeSessionExcluded(t *testing.T) {
	t.Parallel()
	// firstSessionStartedAtUnix=1000, cutoff=995: a branch reflog-created at 990 (before cutoff)
	// is excluded outright, even though it's the only otherwise-eligible candidate.
	candidates := []rebindCandidate{
		{Name: "old", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 990},
	}
	got := rebindCandidates("", 1000, candidates)
	if got.Bind != "" || len(got.Candidates) != 0 {
		t.Fatalf("got %+v, want unbound with no candidates (created before session, minus 5s grace)", got)
	}

	// Exactly at the cutoff (inclusive boundary) still counts.
	atCutoff := []rebindCandidate{
		{Name: "onTime", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 995},
	}
	got2 := rebindCandidates("", 1000, atCutoff)
	if got2.Bind != "onTime" {
		t.Fatalf("got %+v, want Bind=onTime (at the -5s cutoff, inclusive)", got2)
	}
}

func TestRebindCandidates_QueuedOrArchivedExcluded(t *testing.T) {
	t.Parallel()
	candidates := []rebindCandidate{
		{Name: "queued", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000, Queued: true},
		{Name: "archived", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000, Archived: true},
		{Name: "eligible", CheckedOutInLinkedWorktree: true, HasReflog: true, ReflogCreatedAtUnix: 1000},
	}
	got := rebindCandidates("", 500, candidates)
	if got.Bind != "eligible" {
		t.Fatalf("got %+v, want Bind=eligible (queued/archived excluded)", got)
	}
}

// ---------------------------------------------------------------------------------------
// colorSlot (§0.13)
// ---------------------------------------------------------------------------------------

func TestColorSlot_FirstFree(t *testing.T) {
	t.Parallel()
	visible := map[int]bool{0: true, 1: true}
	if got := colorSlot(visible, map[int]int{}); got != 2 {
		t.Fatalf("colorSlot = %d, want 2 (first free)", got)
	}
}

func TestColorSlot_AllUsedLeastUsedLowestOnTie(t *testing.T) {
	t.Parallel()
	visible := make(map[int]bool, maxColorSlots)
	usage := make(map[int]int, maxColorSlots)
	for i := 0; i < maxColorSlots; i++ {
		visible[i] = true
		usage[i] = 5
	}
	usage[3] = 2
	usage[7] = 2 // tie with slot 3, lower slot wins
	if got := colorSlot(visible, usage); got != 3 {
		t.Fatalf("colorSlot = %d, want 3 (least used, lowest on tie)", got)
	}
}

func TestColorSlot_ArchivedItemsIgnored(t *testing.T) {
	t.Parallel()
	// Slot 0 was used historically (usage count > 0) but its item is now archived, so it is not in
	// `visible` — it comes back as the first free slot even though every OTHER slot is unused too.
	visible := map[int]bool{1: true}
	usage := map[int]int{0: 3}
	if got := colorSlot(visible, usage); got != 0 {
		t.Fatalf("colorSlot = %d, want 0 (archived item's slot is free again)", got)
	}
}

// ---------------------------------------------------------------------------------------
// atRisk (§0.9)
// ---------------------------------------------------------------------------------------

func TestAtRisk_ReviewDirtyCountedUnmergedNot(t *testing.T) {
	t.Parallel()
	got := atRisk(atRiskInput{Kind: "review", HasLinkedWorktree: true, DirtyCount: 4, UnmergedAheadOfMain: 9})
	if got.Dirty != 4 {
		t.Fatalf("Dirty = %d, want 4 (review with a linked worktree still counts dirty)", got.Dirty)
	}
	if got.Unmerged != 0 {
		t.Fatalf("Unmerged = %d, want 0 (review never counts unmerged)", got.Unmerged)
	}
}

func TestAtRisk_MergedMineUnmergedZero(t *testing.T) {
	t.Parallel()
	got := atRisk(atRiskInput{Kind: "mine", Merged: true, HasLinkedWorktree: true, DirtyCount: 2, UnmergedAheadOfMain: 9})
	if got.Unmerged != 0 {
		t.Fatalf("Unmerged = %d, want 0 (merged branch's history is already safe in main)", got.Unmerged)
	}
	if got.Dirty != 2 {
		t.Fatalf("Dirty = %d, want 2 (dirty still counts regardless of merged)", got.Dirty)
	}
}

func TestAtRisk_NewWorkNone(t *testing.T) {
	t.Parallel()
	got := atRisk(atRiskInput{IsNewWork: true, HasLinkedWorktree: true, DirtyCount: 9, UnmergedAheadOfMain: 9})
	if got != (atRiskResult{}) {
		t.Fatalf("got %+v, want zero value (new work has no worktree of its own to lose anything from)", got)
	}
}
