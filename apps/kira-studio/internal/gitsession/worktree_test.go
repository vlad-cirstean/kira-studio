package gitsession

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitprepare"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// --- prepareOpSlot: D13's own ≤1-slot concurrency matrix, mirroring remoteOpSlot's own tests ------

func TestPrepareOpSlot_SecondClaimIsRefused(t *testing.T) {
	t.Parallel()
	var s prepareOpSlot
	if !s.claim(func() {}) {
		t.Fatal("first claim should succeed")
	}
	if s.claim(func() {}) {
		t.Fatal("a second claim while the slot is occupied should be refused")
	}
	s.release()
	if !s.claim(func() {}) {
		t.Fatal("a claim after release should succeed")
	}
}

func TestPrepareOpSlot_CancelOnIdleReportsFalse(t *testing.T) {
	t.Parallel()
	var s prepareOpSlot
	if s.tryCancel() {
		t.Fatal("cancelling an idle slot must report false, never true")
	}
}

func TestPrepareOpSlot_CancelCancelsAndReportsTrue(t *testing.T) {
	t.Parallel()
	var s prepareOpSlot
	cancelled := false
	s.claim(func() { cancelled = true })
	if !s.tryCancel() {
		t.Fatal("cancelling an active slot must report true")
	}
	if !cancelled {
		t.Fatal("cancel() must have been called")
	}
}

func TestPrepareOpSlot_ForceCancel(t *testing.T) {
	t.Parallel()
	var s prepareOpSlot
	cancelled := false
	s.claim(func() { cancelled = true })
	s.forceCancel()
	if !cancelled {
		t.Fatal("forceCancel must cancel")
	}
}

// --- test fixtures ---------------------------------------------------------------------------

// newWorktreeTestEntry opens repoDir exactly like newQueriesTestEntry, but with an overridable
// per-repo prepare script (D18: gitsession's own tests never spawn a real shell — RunPrepare's own
// tests below all inject a fake gitprepare.Runner too).
func newWorktreeTestEntry(t *testing.T, repoDir, script string) *RepoEntry {
	t.Helper()
	runner := gitclient.NewExecRunner()
	registry := NewRegistry(runner)
	registry.RepoSettingsGet = func(string) (model.GitRepoSettings, error) {
		s := model.DefaultGitRepoSettings()
		s.WorktreePrepareScript = script
		return s, nil
	}
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("worktree-test-conn"), "test-client", "test-client-label", nil)
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

// initWorktreeTestRepo builds a bare-minimum one-commit repo on branch "main".
func initWorktreeTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatalf("write f.txt: %v", err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	return dir
}

// fakePrepareRunner is gitprepare.Runner's own fake (D18) — every gitsession test that reaches
// RunPrepare injects this, never gitprepare.NewOSRunner.
type fakePrepareRunner struct {
	called   bool
	lastSpec gitprepare.Spec
	result   gitprepare.Result
	err      error
}

func (f *fakePrepareRunner) Run(_ context.Context, spec gitprepare.Spec) (gitprepare.Result, error) {
	f.called = true
	f.lastSpec = spec
	return f.result, f.err
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// --- Worktrees (worktree.list, D1) ------------------------------------------------------------

func TestWorktrees_MainAndLinked(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "linked")
	runGitQ(t, dir, "worktree", "add", "-b", "feature", wtPath)

	entry := newWorktreeTestEntry(t, dir, "")
	list, err := entry.Worktrees(context.Background())
	if err != nil {
		t.Fatalf("Worktrees: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d worktrees, want 2: %+v", len(list), list)
	}
	if !list[0].IsMain || !list[0].IsCurrent {
		t.Fatalf("first entry = %+v, want IsMain and IsCurrent both true (this entry's own root)", list[0])
	}
	if list[1].IsMain || list[1].IsCurrent {
		t.Fatalf("second entry = %+v, want IsMain and IsCurrent both false", list[1])
	}
	if list[1].Branch == nil || *list[1].Branch != "refs/heads/feature" {
		t.Fatalf("second entry branch = %v, want refs/heads/feature", list[1].Branch)
	}
}

// --- WorktreeAddPreflight (D4) -----------------------------------------------------------------

func TestWorktreeAddPreflight_Clean(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	pf, err := entry.WorktreeAddPreflight(context.Background(), WorktreeAddParams{
		Path: filepath.Join(t.TempDir(), "wt"), Mode: "newBranch", Branch: "topic", StartPoint: "main",
	})
	if err != nil {
		t.Fatalf("WorktreeAddPreflight: %v", err)
	}
	if pf.Verdict != "clean" {
		t.Fatalf("got %+v", pf)
	}
}

func TestWorktreeAddPreflight_BranchCheckedOutElsewhere(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "linked")
	runGitQ(t, dir, "worktree", "add", "-b", "feature", wtPath)

	entry := newWorktreeTestEntry(t, dir, "")
	pf, err := entry.WorktreeAddPreflight(context.Background(), WorktreeAddParams{
		Path: filepath.Join(t.TempDir(), "wt2"), Mode: "existingBranch", Branch: "feature",
	})
	if err != nil {
		t.Fatalf("WorktreeAddPreflight: %v", err)
	}
	if pf.Verdict != "blocked" || len(pf.Blockers) != 1 || pf.Blockers[0].Kind != "branchCheckedOutElsewhere" {
		t.Fatalf("got %+v", pf)
	}
}

// --- WorktreeRemovePreflight / RunOp worktreeRemove (D8/F7/F8) ----------------------------------

func TestWorktreeRemovePreflight_MainAndCurrentBlocked(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	pf, err := entry.WorktreeRemovePreflight(context.Background(), dir)
	if err != nil {
		t.Fatalf("WorktreeRemovePreflight: %v", err)
	}
	if pf.Verdict != "blocked" {
		t.Fatalf("got %+v", pf)
	}
	kinds := map[string]bool{}
	for _, b := range pf.Blockers {
		kinds[b.Kind] = true
	}
	if !kinds["mainWorktree"] || !kinds["currentWorktree"] {
		t.Fatalf("blockers = %+v, want both mainWorktree and currentWorktree", pf.Blockers)
	}
}

// TestRunOp_WorktreeRemove_DirtyRequiresConfirmation is the plan's own "confirmation-refusal test"
// (§7.1 item 1's own enumeration, plan exit criterion "a dirty forced removal requires a typed
// token re-checked against a freshly-read status"): no token -> refused; wrong token -> refused;
// the worktree survives both refusals; the correct token (the worktree's own basename) succeeds.
func TestRunOp_WorktreeRemove_DirtyRequiresConfirmation(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "feature-wt")
	runGitQ(t, dir, "worktree", "add", "-b", "feature", wtPath)
	if err := os.WriteFile(filepath.Join(wtPath, "dirty.txt"), []byte("uncommitted"), 0o644); err != nil {
		t.Fatalf("write dirty.txt: %v", err)
	}

	entry := newWorktreeTestEntry(t, dir, "")
	ctx := context.Background()

	// No token at all.
	result, err := entry.RunOp(ctx, ConnID("c"), "label", OpRequest{Kind: "worktreeRemove", Path: wtPath})
	if err != nil {
		t.Fatalf("RunOp (no token): %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "ConfirmationRequired" {
		t.Fatalf("got %+v, want ConfirmationRequired", result)
	}

	// Wrong token.
	wrong := "not-the-basename"
	result, err = entry.RunOp(ctx, ConnID("c"), "label", OpRequest{Kind: "worktreeRemove", Path: wtPath, ConfirmToken: &wrong})
	if err != nil {
		t.Fatalf("RunOp (wrong token): %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "ConfirmationRequired" {
		t.Fatalf("got %+v, want ConfirmationRequired", result)
	}

	// The worktree must still exist after both refusals.
	records, err := entry.rawWorktreeList(ctx)
	if err != nil {
		t.Fatalf("rawWorktreeList: %v", err)
	}
	if _, ok := findWorktree(records, wtPath); !ok {
		t.Fatal("worktree was removed despite both confirmations being refused")
	}

	// Correct token (the worktree's own basename) succeeds.
	correct := filepath.Base(wtPath)
	result, err = entry.RunOp(ctx, ConnID("c"), "label", OpRequest{Kind: "worktreeRemove", Path: wtPath, ConfirmToken: &correct})
	if err != nil {
		t.Fatalf("RunOp (correct token): %v", err)
	}
	if !result.OK {
		t.Fatalf("got %+v, want OK", result)
	}
	records, err = entry.rawWorktreeList(ctx)
	if err != nil {
		t.Fatalf("rawWorktreeList: %v", err)
	}
	if _, ok := findWorktree(records, wtPath); ok {
		t.Fatal("worktree still present after a correctly-confirmed removal")
	}
}

func TestRunOp_WorktreeRemove_MainWorktreeBlocked(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	result, err := entry.RunOp(context.Background(), ConnID("c"), "label", OpRequest{Kind: "worktreeRemove", Path: dir})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK || result.Error == nil {
		t.Fatalf("got %+v, want a refusal", result)
	}
}

func TestRunOp_WorktreeAdd_NewBranch(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	wtPath := filepath.Join(t.TempDir(), "new-wt")

	result, err := entry.RunOp(context.Background(), ConnID("c"), "label", OpRequest{
		Kind: "worktreeAdd", Path: wtPath, Mode: "newBranch", Branch: "topic", StartPoint: "main",
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if !result.OK {
		t.Fatalf("got %+v", result)
	}
	records, err := entry.rawWorktreeList(context.Background())
	if err != nil {
		t.Fatalf("rawWorktreeList: %v", err)
	}
	rec, ok := findWorktree(records, wtPath)
	if !ok || rec.Branch != "refs/heads/topic" {
		t.Fatalf("got records=%+v", records)
	}
}

// TestRunOp_WorktreeAdd_BlockedNeverSpawns proves a blocked preflight never reaches git at all —
// an unresolvable start point must leave no worktree behind.
func TestRunOp_WorktreeAdd_BlockedNeverSpawns(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	wtPath := filepath.Join(t.TempDir(), "bad-wt")

	result, err := entry.RunOp(context.Background(), ConnID("c"), "label", OpRequest{
		Kind: "worktreeAdd", Path: wtPath, Mode: "newBranch", Branch: "topic", StartPoint: "no-such-ref",
	})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "NotFound" {
		t.Fatalf("got %+v, want NotFound", result)
	}
	if _, statErr := os.Stat(wtPath); statErr == nil {
		t.Fatal("the target path was created despite the blocked preflight")
	}
}

// --- RunPrepare (D9-D14) — every test here injects fakePrepareRunner; none spawns a real shell ---

func TestRunPrepare_NotConfigured(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "")
	fake := &fakePrepareRunner{}

	result, err := entry.RunPrepare(context.Background(), nil, dir, "irrelevant", WorktreePrepareDeps{Runner: fake})
	if err != nil {
		t.Fatalf("RunPrepare: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "NotConfigured" {
		t.Fatalf("got %+v, want NotConfigured", result)
	}
	if fake.called {
		t.Fatal("the runner must never be invoked when no script is configured")
	}
}

// TestRunPrepare_ScriptChangedNeverSpawns is the exit criteria's own item 9, verbatim: "A
// worktree.prepare with a mismatched scriptSha256 answers ScriptChanged and spawns nothing (fake
// Runner fails the test if called)".
func TestRunPrepare_ScriptChangedNeverSpawns(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	entry := newWorktreeTestEntry(t, dir, "npm ci")
	fake := &fakePrepareRunner{}

	result, err := entry.RunPrepare(context.Background(), nil, dir, "0000000000000000000000000000000000000000000000000000000000000000", WorktreePrepareDeps{Runner: fake})
	if err != nil {
		t.Fatalf("RunPrepare: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "ScriptChanged" {
		t.Fatalf("got %+v, want ScriptChanged", result)
	}
	if fake.called {
		t.Fatal("the runner must never be invoked on a digest mismatch")
	}
}

func TestRunPrepare_NotAWorktree(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	script := "npm ci"
	entry := newWorktreeTestEntry(t, dir, script)
	fake := &fakePrepareRunner{}

	result, err := entry.RunPrepare(context.Background(), nil, filepath.Join(t.TempDir(), "not-a-worktree"), sha256Hex(script), WorktreePrepareDeps{Runner: fake})
	if err != nil {
		t.Fatalf("RunPrepare: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "NotAWorktree" {
		t.Fatalf("got %+v, want NotAWorktree", result)
	}
	if fake.called {
		t.Fatal("the runner must never be invoked for a path that is not a real worktree")
	}
}

func TestRunPrepare_AlreadyRunning(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	script := "npm ci"
	entry := newWorktreeTestEntry(t, dir, script)
	fake := &fakePrepareRunner{}

	if !entry.prepare.claim(func() {}) {
		t.Fatal("test setup: claim should succeed")
	}
	defer entry.prepare.release()

	result, err := entry.RunPrepare(context.Background(), nil, dir, sha256Hex(script), WorktreePrepareDeps{Runner: fake})
	if err != nil {
		t.Fatalf("RunPrepare: %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "AlreadyRunning" {
		t.Fatalf("got %+v, want AlreadyRunning", result)
	}
	if fake.called {
		t.Fatal("the runner must never be invoked while the slot is already claimed")
	}
}

// TestRunPrepare_SuccessPassesEnv proves the happy path end to end against the fake runner: the
// correct shell/env reach Spec, and the worktree's own path/branch are threaded through.
func TestRunPrepare_SuccessPassesEnv(t *testing.T) {
	t.Parallel()
	skipWithoutGitQueries(t)
	dir := initWorktreeTestRepo(t)
	wtPath := filepath.Join(t.TempDir(), "prepared-wt")
	runGitQ(t, dir, "worktree", "add", "-b", "feature", wtPath)

	script := "npm ci"
	entry := newWorktreeTestEntry(t, dir, script)
	fake := &fakePrepareRunner{result: gitprepare.Result{ExitCode: 0, Output: []gitprepare.Line{{Stream: "stdout", Text: "ok"}}}}

	result, err := entry.RunPrepare(context.Background(), nil, wtPath, sha256Hex(script), WorktreePrepareDeps{
		Runner: fake, Getenv: func(string) string { return "" }, // forces the /bin/sh fallback branch, deterministic across CI shells.
	})
	if err != nil {
		t.Fatalf("RunPrepare: %v", err)
	}
	if !result.OK || result.ExitCode != 0 {
		t.Fatalf("got %+v", result)
	}
	if !fake.called {
		t.Fatal("the runner should have been invoked")
	}
	if fake.lastSpec.Script != script {
		t.Fatalf("Spec.Script = %q, want %q", fake.lastSpec.Script, script)
	}
	if fake.lastSpec.Dir != wtPath {
		t.Fatalf("Spec.Dir = %q, want %q", fake.lastSpec.Dir, wtPath)
	}
	wantEnv := map[string]bool{
		"KIRA_PREPARE=1": true, "KIRA_WORKTREE_PATH=" + wtPath: true, "KIRA_WORKTREE_BRANCH=feature": true,
	}
	for _, kv := range fake.lastSpec.Env {
		delete(wantEnv, kv)
	}
	if len(wantEnv) != 0 {
		t.Fatalf("missing env entries: %v (full env: %v)", wantEnv, fake.lastSpec.Env)
	}
}
