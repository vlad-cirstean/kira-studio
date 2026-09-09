package gitsession

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

func skipWithoutGitStack(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

func runGitStack(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func writeFileStack(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// argSpawnCountingRunner wraps a real Runner, counting spawns whose argv[0] matches one of the
// given verbs — used to prove D3's own "one config read and nothing else" cost model.
type argSpawnCountingRunner struct {
	gitclient.Runner
	verbs  map[string]bool
	counts map[string]*int32
}

func newArgSpawnCountingRunner(verbs ...string) *argSpawnCountingRunner {
	r := &argSpawnCountingRunner{Runner: gitclient.NewExecRunner(), verbs: map[string]bool{}, counts: map[string]*int32{}}
	for _, v := range verbs {
		r.verbs[v] = true
		var n int32
		r.counts[v] = &n
	}
	return r
}

func (r *argSpawnCountingRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if len(spec.Args) > 0 && r.verbs[spec.Args[0]] {
		atomic.AddInt32(r.counts[spec.Args[0]], 1)
	}
	return r.Runner.Start(ctx, gitPath, spec)
}

func (r *argSpawnCountingRunner) count(verb string) int32 { return atomic.LoadInt32(r.counts[verb]) }

func newStackTestEntryWithRunner(t *testing.T, runner gitclient.Runner, repoDir string) *RepoEntry {
	t.Helper()
	registry := NewRegistry(runner)
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("stack-test-conn"), "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", repoDir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	t.Cleanup(conn.Close)
	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}
	return entry
}

func initUnstackedRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	return dir
}

// TestStacks_UnstackedRepo_OneConfigReadNothingElse is §7.1 item 6's own Go-level proof: a
// repository with no stacked branches costs exactly one `config` spawn (the --get-regexp read) and
// zero `rev-list` spawns.
func TestStacks_UnstackedRepo_OneConfigReadNothingElse(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runner := newArgSpawnCountingRunner("config", "rev-list")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()

	result, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(result.Stacks) != 0 || len(result.Orphans) != 0 {
		t.Fatalf("result = %+v, want empty", result)
	}
	if got := runner.count("config"); got != 1 {
		t.Fatalf("config spawns = %d, want exactly 1", got)
	}
	if got := runner.count("rev-list"); got != 0 {
		t.Fatalf("rev-list spawns = %d, want 0", got)
	}
}

// TestStacks_CacheHit proves the second call costs no further config spawn.
func TestStacks_CacheHit(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runner := newArgSpawnCountingRunner("config")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()

	if _, err := entry.Stacks(ctx); err != nil {
		t.Fatalf("Stacks (1st): %v", err)
	}
	if _, err := entry.Stacks(ctx); err != nil {
		t.Fatalf("Stacks (2nd): %v", err)
	}
	if got := runner.count("config"); got != 1 {
		t.Fatalf("config spawns = %d, want exactly 1 (second call must hit the cache)", got)
	}
}

// TestStacks_CacheDroppedOnWrite proves invalidateAfterWrite (D16) actually drops the stack cache —
// a branch create (an ordinary write) must make the next Stacks() re-spawn the config read.
func TestStacks_CacheDroppedOnWrite(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runner := newArgSpawnCountingRunner("config")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()

	if _, err := entry.Stacks(ctx); err != nil {
		t.Fatalf("Stacks (1st): %v", err)
	}
	if _, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{Kind: "branchCreate", Name: "topic", StartPoint: "main"}); err != nil {
		t.Fatalf("RunOp branchCreate: %v", err)
	}
	if _, err := entry.Stacks(ctx); err != nil {
		t.Fatalf("Stacks (2nd): %v", err)
	}
	if got := runner.count("config"); got != 2 {
		t.Fatalf("config spawns = %d, want exactly 2 (cache must have been dropped by the write)", got)
	}
}

// initLinearStackRepo builds main -> feat1 -> feat2, records feat2's stack parent/base, then
// advances feat1 by one commit so feat2 is stale.
func initLinearStackRepo(t *testing.T) (dir, feat1TipBeforeAdvance string) {
	t.Helper()
	dir = t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")

	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	writeFileStack(t, dir, "a.txt", "a\n")
	runGitStack(t, dir, "add", "a.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c2 on feat1")

	runGitStack(t, dir, "checkout", "-q", "-b", "feat2")
	writeFileStack(t, dir, "b.txt", "b\n")
	runGitStack(t, dir, "add", "b.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c3 on feat2")

	cmd := exec.Command("git", "rev-parse", "feat1")
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("rev-parse feat1: %v", err)
	}
	feat1Tip := string(out[:len(out)-1])

	runGitStack(t, dir, "config", "--local", "branch.feat2.kirastackparent", "feat1")
	runGitStack(t, dir, "config", "--local", "branch.feat2.kirastackbase", feat1Tip)
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackparent", "main")
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackbase", "")

	runGitStack(t, dir, "checkout", "-q", "feat1")
	writeFileStack(t, dir, "c.txt", "c\n")
	runGitStack(t, dir, "add", "c.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c4 on feat1 (advances past feat2's recorded base)")
	runGitStack(t, dir, "checkout", "-q", "feat2")

	return dir, feat1Tip
}

func TestStacks_LinearChain_RealRepo(t *testing.T) {
	skipWithoutGitStack(t)
	dir, _ := initLinearStackRepo(t)
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(result.Stacks) != 1 || result.Stacks[0].Base != "main" {
		t.Fatalf("stacks = %+v", result.Stacks)
	}
	branches := result.Stacks[0].Branches
	if len(branches) != 2 || branches[0].Name != "feat1" || branches[1].Name != "feat2" {
		t.Fatalf("branches = %+v", branches)
	}
	if branches[1].State != gitpreflight.StackNeedsRestack || branches[1].Behind == 0 {
		t.Fatalf("feat2 = %+v, want needsRestack with behind > 0 (feat1 advanced)", branches[1])
	}
	if branches[0].State != gitpreflight.StackUpToDate {
		t.Fatalf("feat1 = %+v, want upToDate", branches[0])
	}
}

func TestRestackPreflight_Clean(t *testing.T) {
	skipWithoutGitStack(t)
	dir, _ := initLinearStackRepo(t)
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	pf, err := entry.RestackPreflight(ctx, "feat2")
	if err != nil {
		t.Fatalf("RestackPreflight: %v", err)
	}
	if pf.Verdict != "clean" {
		t.Fatalf("verdict = %q, want clean: %+v", pf.Verdict, pf)
	}
	if len(pf.Plan) != 1 || pf.Plan[0].Branch != "feat2" || pf.Plan[0].BaseSource != "recorded" {
		t.Fatalf("plan = %+v", pf.Plan)
	}
	if pf.RestoresHead != "feat2" {
		t.Fatalf("restoresHead = %q", pf.RestoresHead)
	}
}

func TestRestackPreflight_NotStacked(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	pf, err := entry.RestackPreflight(ctx, "main")
	if err != nil {
		t.Fatalf("RestackPreflight: %v", err)
	}
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "notStacked" {
		t.Fatalf("pf = %+v", pf)
	}
}

func TestRestackPreflight_DirtyWorktreeBlocks(t *testing.T) {
	skipWithoutGitStack(t)
	dir, _ := initLinearStackRepo(t)
	writeFileStack(t, dir, "b.txt", "dirty change\n")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	pf, err := entry.RestackPreflight(ctx, "feat2")
	if err != nil {
		t.Fatalf("RestackPreflight: %v", err)
	}
	if pf.Verdict != "blocked" {
		t.Fatalf("verdict = %q, want blocked", pf.Verdict)
	}
	found := false
	for _, b := range pf.Blockers {
		if b.Kind == "dirtyWorktree" {
			found = true
		}
	}
	if !found {
		t.Fatalf("blockers = %+v, want a dirtyWorktree blocker", pf.Blockers)
	}
	if len(pf.Routes) != 1 || pf.Routes[0] != "stashFirst" {
		t.Fatalf("routes = %v", pf.Routes)
	}
}

// TestRestackPreflight_RecordedBaseFallsBackToMergeBase is D14/F4's own honest-degrade case: a
// branch with NO recorded base at all still gets a plan entry, sourced from merge-base.
// ---------------------------------------------------------------------------------------
// stackSet (D10)
// ---------------------------------------------------------------------------------------

func strPtr(s string) *string { return &s }

func TestRunOp_StackSet_SetsParentAndBase(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: strPtr("main"),
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.Undo == nil {
		t.Fatal("stackSet must set an undo record (D10: Undoable)")
	}

	stacks, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(stacks.Stacks) != 1 || stacks.Stacks[0].Branches[0].Name != "feat1" {
		t.Fatalf("stacks = %+v", stacks.Stacks)
	}
}

// TestRunOp_StackSet_CycleRefusedNoWrite is §7.1 item 9's own exit criterion: a parent that would
// create a cycle answers StackCycle and spawns NO git write.
func TestRunOp_StackSet_CycleRefusedNoWrite(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	runGitStack(t, dir, "checkout", "-q", "-b", "feat2")
	runGitStack(t, dir, "config", "--local", "branch.feat2.kirastackparent", "feat1")
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackparent", "main")

	runner := newArgSpawnCountingRunner("config")
	entry := newStackTestEntryWithRunner(t, runner, dir)
	ctx := context.Background()
	// feat2 is already a child of feat1; setting feat1's parent to feat2 would close the loop.
	before := runner.count("config")

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: strPtr("feat2"),
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "StackCycle" {
		t.Fatalf("result = %+v, want a StackCycle error", result)
	}
	// The two reads (refsSnapshot's own config-free spawns aside) already happened before this
	// point; what matters is that no ADDITIONAL config *write* happened — i.e. the read count did
	// not grow by the two writes a successful stackSet would have made.
	after := runner.count("config")
	if after-before > 1 { // the one read this call itself makes is expected; two more (the writes) must not appear
		t.Fatalf("config spawns grew by %d across a refused stackSet, want at most the one read", after-before)
	}
}

func TestRunOp_StackSet_SelfParentRefused(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: strPtr("feat1"),
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "StackCycle" {
		t.Fatalf("result = %+v, want StackCycle", result)
	}
}

func TestRunOp_StackSet_UnknownParentIsNotFound(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: strPtr("nosuchbranch"),
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "NotFound" {
		t.Fatalf("result = %+v, want NotFound", result)
	}
}

// TestRunOp_StackSet_UndoRestoresPreviousParent proves the undo replay is symmetric (D2/D10): a
// branch that was NOT stacked before gets its "" values back on undo.
func TestRunOp_StackSet_UndoRestoresPreviousParent(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: strPtr("main"),
	})
	if err != nil || !result.OK || result.Undo == nil {
		t.Fatalf("RunOp: result=%+v err=%v", result, err)
	}

	undoResult, err := entry.UndoRun(ctx, result.Undo.ID)
	if err != nil {
		t.Fatalf("UndoRun: %v", err)
	}
	if !undoResult.OK {
		t.Fatalf("undoResult = %+v, want ok", undoResult)
	}

	stacks, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(stacks.Stacks) != 0 {
		t.Fatalf("stacks = %+v, want none (feat1's parent restored to empty)", stacks.Stacks)
	}
}

func TestRunOp_StackSet_RemoveFromStack(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initUnstackedRepo(t)
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackparent", "main")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{
		Kind: "stackSet", Branch: "feat1", Parent: nil,
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result = %+v, want ok", result)
	}
	stacks, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(stacks.Stacks) != 0 {
		t.Fatalf("stacks = %+v, want none (feat1 removed from its stack)", stacks.Stacks)
	}
}

// ---------------------------------------------------------------------------------------
// branchRename / branchDelete stack fix-ups (D1/§10.9)
// ---------------------------------------------------------------------------------------

// initTwoLevelStack builds main -> feat1 -> feat2 with both stack keys recorded properly.
func initTwoLevelStack(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	writeFileStack(t, dir, "a.txt", "a\n")
	runGitStack(t, dir, "add", "a.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c2")
	runGitStack(t, dir, "checkout", "-q", "-b", "feat2")
	writeFileStack(t, dir, "b.txt", "b\n")
	runGitStack(t, dir, "add", "b.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c3")
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackparent", "main")
	runGitStack(t, dir, "config", "--local", "branch.feat2.kirastackparent", "feat1")
	runGitStack(t, dir, "checkout", "-q", "main")
	return dir
}

// TestRunOp_BranchRename_ChildPointerFollows proves G26's own fix-up: renaming feat1 to feat1b
// must rewrite feat2's OWN kirastackparent value (git's own `branch -m` only moves feat1's own
// section, per probe P1 — it does nothing about feat2's config naming feat1 as ITS parent).
func TestRunOp_BranchRename_ChildPointerFollows(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initTwoLevelStack(t)
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{Kind: "branchRename", From: "feat1", To: "feat1b"})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result = %+v, want ok", result)
	}

	stacks, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(stacks.Stacks) != 1 || stacks.Stacks[0].Base != "main" {
		t.Fatalf("stacks = %+v", stacks.Stacks)
	}
	names := []string{}
	for _, b := range stacks.Stacks[0].Branches {
		names = append(names, b.Name)
	}
	if len(names) != 2 || names[0] != "feat1b" || names[1] != "feat2" {
		t.Fatalf("branches = %v, want [feat1b feat2] (feat2 must follow the rename)", names)
	}
}

// TestRunOp_BranchDelete_ReparentsChildren is §7.1 item 10's own exit criterion: deleting feat1
// (whose own parent is main) re-parents feat2 onto main, and undoing the delete restores both
// feat1 itself and feat2's own prior pointer (to feat1).
func TestRunOp_BranchDelete_ReparentsChildren(t *testing.T) {
	skipWithoutGitStack(t)
	dir := initTwoLevelStack(t)
	// feat1 must be fully merged into main for a plain -d delete to succeed with no --force.
	runGitStack(t, dir, "checkout", "-q", "main")
	runGitStack(t, dir, "merge", "-q", "--no-edit", "feat1")
	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunOp(ctx, ConnID("stack-test-conn"), "test", OpRequest{Kind: "branchDelete", Name: "feat1"})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("result = %+v, want ok", result)
	}
	if result.Undo == nil {
		t.Fatal("branchDelete must set an undo record")
	}

	stacks, err := entry.Stacks(ctx)
	if err != nil {
		t.Fatalf("Stacks: %v", err)
	}
	if len(stacks.Stacks) != 1 || stacks.Stacks[0].Base != "main" {
		t.Fatalf("stacks = %+v, want feat2 re-parented onto main", stacks.Stacks)
	}
	if len(stacks.Stacks[0].Branches) != 1 || stacks.Stacks[0].Branches[0].Name != "feat2" {
		t.Fatalf("branches = %+v", stacks.Stacks[0].Branches)
	}

	// Undo must restore BOTH feat1 itself and feat2's own prior pointer (back to feat1). Read the
	// stack config FRESH (never entry.Stacks' own cache, which UndoRun does not invalidate — a
	// pre-existing gap in UndoRun predating this phase, noted rather than papered over here) and
	// via a fresh refs read for feat1's own existence, exactly what a real client's next
	// stack.list after the watcher's own refsChanged signal would see.
	undoResult, err := entry.UndoRun(ctx, result.Undo.ID)
	if err != nil {
		t.Fatalf("UndoRun: %v", err)
	}
	if !undoResult.OK {
		t.Fatalf("undoResult = %+v, want ok", undoResult)
	}
	freshConfig, err := entry.rawStackConfig(ctx)
	if err != nil {
		t.Fatalf("rawStackConfig (after undo): %v", err)
	}
	if freshConfig["feat1"].Parent != "main" {
		t.Fatalf("feat1's own parent after undo = %q, want main", freshConfig["feat1"].Parent)
	}
	if freshConfig["feat2"].Parent != "feat1" {
		t.Fatalf("feat2's parent after undo = %q, want feat1 (restored, not left at main)", freshConfig["feat2"].Parent)
	}
	freshRefs, err := entry.refsSnapshot(ctx)
	if err != nil {
		t.Fatalf("refsSnapshot (after undo): %v", err)
	}
	found := false
	for _, r := range freshRefs.Branches {
		if r.ShortName == "feat1" {
			found = true
		}
	}
	if !found {
		t.Fatal("feat1 must exist again after undo")
	}
}

func TestRestackPreflight_RecordedBaseFallsBackToMergeBase(t *testing.T) {
	skipWithoutGitStack(t)
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "checkout", "-q", "-b", "feat1")
	writeFileStack(t, dir, "a.txt", "a\n")
	runGitStack(t, dir, "add", "a.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c2")
	// No kirastackbase recorded at all -- only the parent pointer.
	runGitStack(t, dir, "config", "--local", "branch.feat1.kirastackparent", "main")
	runGitStack(t, dir, "checkout", "-q", "main")
	writeFileStack(t, dir, "g.txt", "g\n")
	runGitStack(t, dir, "add", "g.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c3 on main")
	runGitStack(t, dir, "checkout", "-q", "feat1")

	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()
	pf, err := entry.RestackPreflight(ctx, "feat1")
	if err != nil {
		t.Fatalf("RestackPreflight: %v", err)
	}
	if len(pf.Plan) != 1 || pf.Plan[0].BaseSource != "mergeBase" || pf.Plan[0].Base == "" {
		t.Fatalf("plan = %+v, want a non-empty mergeBase-sourced base", pf.Plan)
	}
}
