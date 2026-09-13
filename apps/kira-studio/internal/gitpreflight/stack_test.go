package gitpreflight_test

import (
	"reflect"
	"sort"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// ---------------------------------------------------------------------------------------
// ParseStackConfig
// ---------------------------------------------------------------------------------------

func nullFraming(records ...[2]string) []byte {
	var out []byte
	for _, r := range records {
		out = append(out, []byte(r[0]+"\n"+r[1])...)
		out = append(out, 0)
	}
	return out
}

func TestParseStackConfig_Basic(t *testing.T) {
	t.Parallel()
	raw := nullFraming(
		[2]string{"branch.feat2.kirastackparent", "feat1"},
		[2]string{"branch.feat2.kirastackbase", "abc123"},
	)
	got := gitpreflight.ParseStackConfig(raw)
	want := map[string]gitpreflight.StackConfigEntry{
		"feat2": {Branch: "feat2", Parent: "feat1", Base: "abc123"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// TestParseStackConfig_DottedBranchName is probe P4's own case: never split on ".".
func TestParseStackConfig_DottedBranchName(t *testing.T) {
	t.Parallel()
	raw := nullFraming([2]string{"branch.feat.x.kirastackparent", "main"})
	got := gitpreflight.ParseStackConfig(raw)
	want := map[string]gitpreflight.StackConfigEntry{"feat.x": {Branch: "feat.x", Parent: "main"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

// TestParseStackConfig_EmptyValue is D2's own "not stacked" encoding: an empty value parses to "",
// never causing the branch to vanish from the map (a residual "kirastackparent=" line for a branch
// that left its stack, per D2's stated cost).
func TestParseStackConfig_EmptyValue(t *testing.T) {
	t.Parallel()
	raw := nullFraming([2]string{"branch.feat2.kirastackparent", ""})
	got := gitpreflight.ParseStackConfig(raw)
	want := map[string]gitpreflight.StackConfigEntry{"feat2": {Branch: "feat2", Parent: ""}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestParseStackConfig_LowercasedKeys(t *testing.T) {
	t.Parallel()
	// Probe P1: git stores/reads back the variable name lowercased regardless of how it was set.
	raw := nullFraming([2]string{"branch.Feat2.kirastackparent", "feat1"})
	got := gitpreflight.ParseStackConfig(raw)
	if _, ok := got["Feat2"]; !ok {
		t.Fatalf("branch name case must be preserved from the original key: got %+v", got)
	}
}

func TestParseStackConfig_TruncatedOrMalformedRecordsIgnored(t *testing.T) {
	t.Parallel()
	raw := []byte("not-a-key-value-pair\x00branch.feat2.kirastackparent\nfeat1\x00")
	got := gitpreflight.ParseStackConfig(raw)
	if len(got) != 1 || got["feat2"].Parent != "feat1" {
		t.Fatalf("got %+v", got)
	}
}

func TestParseStackConfig_IgnoresUnrelatedBranchConfig(t *testing.T) {
	t.Parallel()
	raw := nullFraming(
		[2]string{"branch.feat2.remote", "origin"},
		[2]string{"branch.feat2.merge", "refs/heads/feat2"},
		[2]string{"branch.feat2.kirastackparent", "feat1"},
	)
	got := gitpreflight.ParseStackConfig(raw)
	if len(got) != 1 {
		t.Fatalf("got %+v, want exactly one entry (unrelated branch.* keys ignored)", got)
	}
}

// ---------------------------------------------------------------------------------------
// BuildStacks
// ---------------------------------------------------------------------------------------

func ref(tip string) gitpreflight.StackRefInfo { return gitpreflight.StackRefInfo{Tip: tip} }

func names(branches []gitpreflight.StackBranch) []string {
	out := make([]string, len(branches))
	for i, b := range branches {
		out[i] = b.Name
	}
	return out
}

func TestBuildStacks_LinearChain(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "main"},
			"feat2": {Branch: "feat2", Parent: "feat1"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{
			"main": ref("m1"), "feat1": ref("f1"), "feat2": ref("f2"),
		},
		BaseTips: map[string]string{"main": "m1", "feat1": "f1", "feat2": "f2"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 1 || result.Stacks[0].Base != "main" {
		t.Fatalf("stacks = %+v", result.Stacks)
	}
	got := names(result.Stacks[0].Branches)
	want := []string{"feat1", "feat2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("branch order = %v, want %v (pre-order, bottom-to-top)", got, want)
	}
	if result.Stacks[0].Branches[0].Depth != 0 || result.Stacks[0].Branches[1].Depth != 1 {
		t.Fatalf("depths = %d, %d", result.Stacks[0].Branches[0].Depth, result.Stacks[0].Branches[1].Depth)
	}
	if len(result.Orphans) != 0 {
		t.Fatalf("orphans = %+v, want none", result.Orphans)
	}
}

func TestBuildStacks_Fork(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "main"},
			"feat2a": {Branch: "feat2a", Parent: "feat1"},
			"feat2b": {Branch: "feat2b", Parent: "feat1"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{
			"main": ref("m1"), "feat1": ref("f1"), "feat2a": ref("a1"), "feat2b": ref("b1"),
		},
		BaseTips: map[string]string{"main": "m1", "feat1": "f1", "feat2a": "a1", "feat2b": "b1"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 1 {
		t.Fatalf("stacks = %+v", result.Stacks)
	}
	got := names(result.Stacks[0].Branches)
	want := []string{"feat1", "feat2a", "feat2b"} // sorted-name sibling order
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("branch order = %v, want %v", got, want)
	}
}

// TestBuildStacks_Orphan_DanglingParent: a recorded parent that no longer resolves to any ref.
func TestBuildStacks_Orphan_DanglingParent(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat2": {Branch: "feat2", Parent: "deleted-branch"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{"feat2": ref("f2")},
		BaseTips:  map[string]string{"feat2": "f2"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 0 {
		t.Fatalf("stacks = %+v, want none", result.Stacks)
	}
	if len(result.Orphans) != 1 || result.Orphans[0].Name != "feat2" || result.Orphans[0].State != gitpreflight.StackParentMissing {
		t.Fatalf("orphans = %+v", result.Orphans)
	}
	if result.Orphans[0].Parent != "deleted-branch" {
		t.Fatalf("orphan parent = %q, want the recorded (unresolvable) name preserved", result.Orphans[0].Parent)
	}
}

func TestBuildStacks_SelfCycle(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat2": {Branch: "feat2", Parent: "feat2"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{"feat2": ref("f2")},
		BaseTips:  map[string]string{"feat2": "f2"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 0 || len(result.Orphans) != 1 {
		t.Fatalf("stacks=%+v orphans=%+v", result.Stacks, result.Orphans)
	}
}

func TestBuildStacks_TwoBranchCycle(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"a": {Branch: "a", Parent: "b"},
			"b": {Branch: "b", Parent: "a"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{"a": ref("a1"), "b": ref("b1")},
		BaseTips:  map[string]string{"a": "a1", "b": "b1"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 0 {
		t.Fatalf("stacks = %+v, want none", result.Stacks)
	}
	if len(result.Orphans) != 2 {
		t.Fatalf("orphans = %+v, want both cycle members orphaned", result.Orphans)
	}
}

// TestBuildStacks_RemoteBranchBase: the stack sits on origin/main, never itself a stack member.
func TestBuildStacks_RemoteBranchBase(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "origin/main"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{"feat1": ref("f1")},
		BaseTips:  map[string]string{"origin/main": "m1", "feat1": "f1"},
	}
	result := gitpreflight.BuildStacks(in)
	if len(result.Stacks) != 1 || result.Stacks[0].Base != "origin/main" {
		t.Fatalf("stacks = %+v", result.Stacks)
	}
	if result.Stacks[0].BaseTip == nil || *result.Stacks[0].BaseTip != "m1" {
		t.Fatalf("baseTip = %v", result.Stacks[0].BaseTip)
	}
}

// TestBuildStacks_BehindAheadDrivesState is D4's own predicate: behind > 0 is needsRestack, and
// nothing else.
func TestBuildStacks_BehindAheadDrivesState(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "main"},
		},
		LocalRefs:   map[string]gitpreflight.StackRefInfo{"main": ref("m1"), "feat1": ref("f1")},
		BaseTips:    map[string]string{"main": "m1", "feat1": "f1"},
		BehindAhead: map[string]gitpreflight.LeftRightCount{"feat1": {Behind: 2, Ahead: 1}},
	}
	result := gitpreflight.BuildStacks(in)
	row := result.Stacks[0].Branches[0]
	if row.State != gitpreflight.StackNeedsRestack || row.Behind != 2 || row.Ahead != 1 {
		t.Fatalf("row = %+v", row)
	}
	if !result.Stacks[0].NeedsRestack {
		t.Fatal("StackSummary.NeedsRestack should propagate from a stale member")
	}
}

// TestBuildStacks_BeyondCapZeroedNotDropped: a branch with no BehindAhead entry (beyond the cap) is
// still listed, with behind/ahead left at zero rather than being dropped.
func TestBuildStacks_BeyondCapZeroedNotDropped(t *testing.T) {
	t.Parallel()
	in := gitpreflight.BuildStacksInput{
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "main"},
		},
		LocalRefs: map[string]gitpreflight.StackRefInfo{"main": ref("m1"), "feat1": ref("f1")},
		BaseTips:  map[string]string{"main": "m1", "feat1": "f1"},
		// No BehindAhead entry at all.
	}
	result := gitpreflight.BuildStacks(in)
	row := result.Stacks[0].Branches[0]
	if row.Behind != 0 || row.Ahead != 0 || row.State != gitpreflight.StackUpToDate {
		t.Fatalf("row = %+v, want zeroed/upToDate rather than dropped", row)
	}
}

func TestDetectCycleFrom_NoCycle(t *testing.T) {
	t.Parallel()
	config := map[string]gitpreflight.StackConfigEntry{
		"feat1": {Branch: "feat1", Parent: "main"},
	}
	if got := gitpreflight.DetectCycleFrom(config, "feat1"); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}

func TestDetectCycleFrom_TwoBranchCycle(t *testing.T) {
	t.Parallel()
	config := map[string]gitpreflight.StackConfigEntry{
		"a": {Branch: "a", Parent: "b"},
		"b": {Branch: "b", Parent: "a"},
	}
	got := gitpreflight.DetectCycleFrom(config, "a")
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("got %v", got)
	}
}

// ---------------------------------------------------------------------------------------
// ClassifyRestack
// ---------------------------------------------------------------------------------------

func chainStacks(behind int) []gitpreflight.StackSummary {
	states := []gitpreflight.StackBranchState{gitpreflight.StackUpToDate, gitpreflight.StackUpToDate}
	b1, b2 := 0, 0
	if behind > 0 {
		states[1] = gitpreflight.StackNeedsRestack
		b2 = behind
	}
	return []gitpreflight.StackSummary{{
		Base: "main",
		Branches: []gitpreflight.StackBranch{
			{Name: "feat1", Parent: "main", Depth: 0, State: states[0], Behind: b1, Ahead: 1},
			{Name: "feat2", Parent: "feat1", Depth: 1, State: states[1], Behind: b2, Ahead: 1},
		},
	}}
}

func baseInput() gitpreflight.ClassifyRestackInput {
	return gitpreflight.ClassifyRestackInput{
		Target: "feat2",
		Stacks: chainStacks(1),
		Config: map[string]gitpreflight.StackConfigEntry{
			"feat1": {Branch: "feat1", Parent: "main"},
			"feat2": {Branch: "feat2", Parent: "feat1"},
		},
		CurrentHead: gitpreflight.HeadRef{Branch: "feat2"},
		BranchBases: map[string]gitpreflight.RestackBaseInfo{
			"feat2": {Base: "abc", Source: "recorded"},
		},
	}
}

func TestClassifyRestack_Clean(t *testing.T) {
	t.Parallel()
	pf := gitpreflight.ClassifyRestack(baseInput())
	if pf.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean: %+v", pf.Verdict, pf)
	}
	if len(pf.Plan) != 1 || pf.Plan[0].Branch != "feat2" || pf.Plan[0].Reason != "stale" {
		t.Fatalf("plan = %+v", pf.Plan)
	}
	if pf.RestoresHead != "feat2" {
		t.Fatalf("restoresHead = %q", pf.RestoresHead)
	}
}

func TestClassifyRestack_Noop(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.Stacks = chainStacks(0)
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "noop" || len(pf.Plan) != 0 {
		t.Fatalf("pf = %+v", pf)
	}
}

// TestClassifyRestack_AncestorRestackedCascade: feat1 stale, feat2 up to date on its own — feat2
// must still be planned because its ancestor moves (D14's cascade rule).
func TestClassifyRestack_AncestorRestackedCascade(t *testing.T) {
	t.Parallel()
	stacks := []gitpreflight.StackSummary{{
		Base: "main",
		Branches: []gitpreflight.StackBranch{
			{Name: "feat1", Parent: "main", Depth: 0, State: gitpreflight.StackNeedsRestack, Behind: 3, Ahead: 2},
			{Name: "feat2", Parent: "feat1", Depth: 1, State: gitpreflight.StackUpToDate, Behind: 0, Ahead: 1},
		},
	}}
	in := baseInput()
	in.Stacks = stacks
	pf := gitpreflight.ClassifyRestack(in)
	if len(pf.Plan) != 2 {
		t.Fatalf("plan = %+v, want both branches planned", pf.Plan)
	}
	if pf.Plan[0].Reason != "stale" || pf.Plan[1].Reason != "ancestorRestacked" {
		t.Fatalf("plan reasons = %q, %q", pf.Plan[0].Reason, pf.Plan[1].Reason)
	}
}

func TestClassifyRestack_NotStacked(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.Target = "unrelated"
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "notStacked" {
		t.Fatalf("pf = %+v", pf)
	}
}

func TestClassifyRestack_ParentMissing(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.Target = "orphaned"
	in.Orphans = []gitpreflight.StackBranch{{Name: "orphaned", Parent: "gone"}}
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "parentMissing" {
		t.Fatalf("pf = %+v", pf)
	}
	if pf.Blockers[0].Branch != "orphaned" || pf.Blockers[0].Parent != "gone" {
		t.Fatalf("blocker = %+v", pf.Blockers[0])
	}
}

func TestClassifyRestack_Cycle(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.Target = "a"
	in.Orphans = []gitpreflight.StackBranch{{Name: "a", Parent: "b"}, {Name: "b", Parent: "a"}}
	in.Config = map[string]gitpreflight.StackConfigEntry{
		"a": {Branch: "a", Parent: "b"},
		"b": {Branch: "b", Parent: "a"},
	}
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "cycle" {
		t.Fatalf("pf = %+v", pf)
	}
}

func TestClassifyRestack_CheckedOutElsewhere(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.CheckedOutElsewhere = map[string]string{"feat2": "/tmp/other-worktree"}
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "checkedOutElsewhere" {
		t.Fatalf("pf = %+v", pf)
	}
	if pf.Blockers[0].WorktreePath != "/tmp/other-worktree" {
		t.Fatalf("blocker = %+v", pf.Blockers[0])
	}
}

func TestClassifyRestack_DirtyWorktree(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.DirtyPaths = []string{"f.txt"}
	pf := gitpreflight.ClassifyRestack(in)
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "dirtyWorktree" {
		t.Fatalf("pf = %+v", pf)
	}
	if len(pf.Routes) != 1 || pf.Routes[0] != "stashFirst" {
		t.Fatalf("routes = %v, want [stashFirst]", pf.Routes)
	}
}

// TestClassifyRestack_BlockerOrder proves D14's exact fixed order: inProgressOperation first even
// when a dirtyWorktree also applies.
func TestClassifyRestack_BlockerOrder(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.InProgress = &gitpreflight.InProgressOperation{Kind: gitpreflight.InProgressRebase}
	in.DirtyPaths = []string{"f.txt"}
	pf := gitpreflight.ClassifyRestack(in)
	if len(pf.Blockers) != 2 || pf.Blockers[0].Kind != "inProgressOperation" || pf.Blockers[1].Kind != "dirtyWorktree" {
		t.Fatalf("blockers = %+v", pf.Blockers)
	}
}

func TestClassifyRestack_RestoresHeadDetached(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.CurrentHead = gitpreflight.HeadRef{Sha: "0123456789abcdef"}
	pf := gitpreflight.ClassifyRestack(in)
	if pf.RestoresHead != "0123456" {
		t.Fatalf("restoresHead = %q, want a short sha", pf.RestoresHead)
	}
}

func TestClassifyRestack_NeedsForcePush(t *testing.T) {
	t.Parallel()
	in := baseInput()
	in.HasUpstream = map[string]bool{"feat2": true}
	pf := gitpreflight.ClassifyRestack(in)
	if !reflect.DeepEqual(pf.NeedsForcePush, []string{"feat2"}) {
		t.Fatalf("needsForcePush = %v", pf.NeedsForcePush)
	}
}
