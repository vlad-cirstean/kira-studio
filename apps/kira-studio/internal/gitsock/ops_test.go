package gitsock

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// §8.1(f)'s own end-to-end proof: refs.list, status.get, the two pre-flights, op.run, undo.peek
// and undo.run over a real socket against a real fixture repository, including a real
// `git worktree add` — this is the phase's real proof on the Go side.

// opsFixture names the commits/branches/tags buildOpsFixtureRepo's own topology produces.
type opsFixture struct {
	dir string

	baseSha string

	siblingBranch string // at baseSha, no worktree — the checkout-preflight target
	featureBranch string // at baseSha, checked out in a LINKED worktree
	worktreeDir   string
	trackedBranch string // upstream configured, ahead of origin/tracked
	goneBranch    string // upstream configured, but the remote-tracking ref no longer exists

	lightTag string
	annTag   string

	mergeCommit  string // two parents — mainlineRequired's own target
	mergeParent1 string
	mergeParent2 string

	conflictTarget    string // reverting this against the final HEAD conflicts (probe P5)
	cleanRevertTarget string // reverting this against the final HEAD is clean
	headSha           string
}

func opsFixtureEnv() []string {
	return append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
}

func buildOpsFixtureRepo(t *testing.T) *opsFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()

	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	writeFile := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	commit := func(msg string) string {
		t.Helper()
		cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg, "--allow-empty-message")
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit: %v\n%s", err, out)
		}
		return trimNewline(run("rev-parse", "HEAD"))
	}

	run("init", "-q", "-b", "main")
	f := &opsFixture{dir: dir}

	writeFile("base.txt", "base\n")
	run("add", "base.txt")
	f.baseSha = commit("base commit")

	run("branch", "sibling", f.baseSha)
	f.siblingBranch = "sibling"

	run("branch", "feature2", f.baseSha)
	f.featureBranch = "feature2"
	f.worktreeDir = filepath.Join(t.TempDir(), "wt")
	run("worktree", "add", "-q", f.worktreeDir, "feature2")

	run("remote", "add", "origin", "https://example.invalid/repo.git")

	run("branch", "tracked", f.baseSha)
	run("update-ref", "refs/remotes/origin/tracked", f.baseSha)
	run("config", "branch.tracked.remote", "origin")
	run("config", "branch.tracked.merge", "refs/heads/tracked")
	f.trackedBranch = "tracked"

	run("branch", "gonebranch", f.baseSha)
	run("update-ref", "refs/remotes/origin/gonebranch", f.baseSha)
	run("config", "branch.gonebranch.remote", "origin")
	run("config", "branch.gonebranch.merge", "refs/heads/gonebranch")
	run("update-ref", "-d", "refs/remotes/origin/gonebranch")
	f.goneBranch = "gonebranch"

	run("tag", "v-light", f.baseSha)
	f.lightTag = "v-light"
	run("tag", "-a", "-m", "Annotated tag message", "v-ann", f.baseSha)
	f.annTag = "v-ann"
	run("tag", "v9", f.baseSha)
	run("tag", "v10", f.baseSha)

	run("branch", "merge-a", f.baseSha)
	run("checkout", "-q", "merge-a")
	writeFile("a.txt", "a\n")
	run("add", "a.txt")
	f.mergeParent2 = commit("merge-a work")
	run("checkout", "-q", "main")
	writeFile("b.txt", "b\n")
	run("add", "b.txt")
	f.mergeParent1 = commit("main work before merge")
	mergeCmd := exec.Command("git", "-c", "commit.gpgsign=false", "merge", "-q", "--no-ff", "-m", "merge merge-a", "merge-a")
	mergeCmd.Dir = dir
	mergeCmd.Env = opsFixtureEnv()
	if out, err := mergeCmd.CombinedOutput(); err != nil {
		t.Fatalf("git merge: %v\n%s", err, out)
	}
	f.mergeCommit = trimNewline(run("rev-parse", "HEAD"))

	// "tracked" now sits ahead of origin/tracked by every commit since baseSha.
	run("update-ref", "refs/heads/tracked", f.mergeCommit)

	// The revert conflict pair (probe P5): a plain add, a change to be reverted, and a further
	// change to the same line — reverting the middle commit against final HEAD conflicts.
	writeFile("conflict.txt", "line1\nline2\nline3\n")
	run("add", "conflict.txt")
	commit("add conflict.txt")
	writeFile("conflict.txt", "line1\nCHANGED-BY-TARGET\nline3\n")
	run("add", "conflict.txt")
	f.conflictTarget = commit("change to be reverted")
	writeFile("conflict.txt", "line1\nCHANGED-AGAIN\nline3\n")
	run("add", "conflict.txt")
	commit("head change conflicting with conflictTarget's own revert")

	writeFile("clean.txt", "clean content\n")
	run("add", "clean.txt")
	f.cleanRevertTarget = commit("add clean.txt (a standalone, cleanly revertible commit)")

	f.headSha = trimNewline(run("rev-parse", "HEAD"))
	return f
}

func opRunOK(t *testing.T, c *testClient, repoID string, op gitsession.OpRequest) gitsession.OpResult {
	t.Helper()
	resp := requestOK(t, c, "op.run", gitrpc.OpRunParams{RepoID: repoID, Op: op})
	return unmarshalResult[gitsession.OpResult](t, resp.Result)
}

func hasCheckoutBlocker(blockers []gitpreflight.CheckoutBlocker, kind string) bool {
	for _, b := range blockers {
		if b.Kind == kind {
			return true
		}
	}
	return false
}

func TestIntegration_RefsList(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "refs-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	resp := requestOK(t, client, "refs.list", gitrpc.RefsListParams{RepoID: repoID})
	result := unmarshalResult[gitsession.RefsResult](t, resp.Result)

	main := findRefRow(result.Branches, "main")
	if main == nil {
		t.Fatal("no main row")
	}
	if !main.IsHead {
		t.Fatal("main should be HEAD")
	}
	if main.CheckedOutIn != nil {
		t.Fatalf("main.CheckedOutIn = %v, want nil (our own worktree)", *main.CheckedOutIn)
	}

	feature2 := findRefRow(result.Branches, "feature2")
	if feature2 == nil {
		t.Fatal("no feature2 row")
	}
	if feature2.CheckedOutIn == nil || *feature2.CheckedOutIn == "" {
		t.Fatal("feature2.CheckedOutIn should name the linked worktree")
	}

	tracked := findRefRow(result.Branches, "tracked")
	if tracked == nil {
		t.Fatal("no tracked row")
	}
	trackShape, ok := tracked.Track.(map[string]any)
	if !ok {
		t.Fatalf("tracked.Track = %#v, want a RefTrack object", tracked.Track)
	}
	if ahead, _ := trackShape["ahead"].(float64); ahead <= 0 {
		t.Fatalf("tracked.Track = %+v, want ahead > 0", trackShape)
	}

	gone := findRefRow(result.Branches, "gonebranch")
	if gone == nil {
		t.Fatal("no gonebranch row")
	}
	if s, ok := gone.Track.(string); !ok || s != "gone" {
		t.Fatalf("gonebranch.Track = %#v, want \"gone\"", gone.Track)
	}

	remote := findRefRow(result.RemoteBranches, "origin/tracked")
	if remote == nil {
		t.Fatal("no origin/tracked remote row")
	}

	light := findRefRow(result.Tags, "v-light")
	if light == nil || light.Annotation != nil {
		t.Fatalf("v-light = %+v, want no annotation", light)
	}
	ann := findRefRow(result.Tags, "v-ann")
	if ann == nil || ann.Annotation == nil {
		t.Fatalf("v-ann = %+v, want an annotation", ann)
	}
	if ann.Annotation.Subject != "Annotated tag message" {
		t.Fatalf("v-ann subject = %q", ann.Annotation.Subject)
	}
	if ann.PeeledObjectID == nil {
		t.Fatal("v-ann.PeeledObjectID should be set")
	}

	// git's own version-aware sort: v10 sorts after v9 in refname order but --sort=-v:refname
	// (descending) must place it BEFORE v9.
	v9idx, v10idx := -1, -1
	for i, r := range result.Tags {
		if r.ShortName == "v9" {
			v9idx = i
		}
		if r.ShortName == "v10" {
			v10idx = i
		}
	}
	if v9idx == -1 || v10idx == -1 {
		t.Fatalf("v9/v10 not both found: %+v", result.Tags)
	}
	if v10idx >= v9idx {
		t.Fatalf("v10 at %d, v9 at %d — want v10 sorted before v9 (version-aware sort)", v10idx, v9idx)
	}

	if result.Head.Kind != "branch" || result.Head.Name != "main" {
		t.Fatalf("head = %+v", result.Head)
	}
}

func TestIntegration_StatusAndInProgressBanner(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "status-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	resp := requestOK(t, client, "status.get", gitrpc.StatusGetParams{RepoID: repoID})
	clean := unmarshalResult[gitpreflight.StatusSummary](t, resp.Result)
	if !clean.IsClean || clean.InProgress != nil {
		t.Fatalf("clean status = %+v", clean)
	}

	if err := os.WriteFile(filepath.Join(f.dir, "base.txt"), []byte("dirty\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := os.WriteFile(filepath.Join(f.dir, "untracked.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	respDirty := requestOK(t, client, "status.get", gitrpc.StatusGetParams{RepoID: repoID})
	dirty := unmarshalResult[gitpreflight.StatusSummary](t, respDirty.Result)
	if dirty.IsClean {
		t.Fatal("status should no longer be clean")
	}
	if dirty.Counts.Unstaged != 1 || dirty.Counts.Untracked != 1 {
		t.Fatalf("counts = %+v", dirty.Counts)
	}
	if len(dirty.DirtyPaths) != 2 {
		t.Fatalf("dirtyPaths = %v", dirty.DirtyPaths)
	}
	// Discard the dirt before attempting the conflicting revert below.
	runGitIn(t, f.dir, "checkout", "-q", "--", "base.txt")
	if err := os.Remove(filepath.Join(f.dir, "untracked.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}

	revertResp := opRunOK(t, client, repoID, gitsession.OpRequest{Kind: "revert", Shas: []string{f.conflictTarget}})
	if revertResp.OK {
		t.Fatalf("revert should have conflicted: %+v", revertResp)
	}
	if revertResp.Error == nil || revertResp.Error.Kind != "Conflict" {
		t.Fatalf("revert error = %+v, want Conflict", revertResp.Error)
	}
	if revertResp.InProgress == nil || revertResp.InProgress.Kind != gitpreflight.InProgressRevert {
		t.Fatalf("inProgress = %+v, want a revert in progress", revertResp.InProgress)
	}
	if !revertResp.InProgress.CanContinue || !revertResp.InProgress.CanAbort || !revertResp.InProgress.CanSkip {
		t.Fatalf("inProgress = %+v, want continue/abort/skip all offered", revertResp.InProgress)
	}
	if revertResp.InProgress.IsSequence {
		t.Fatal("a single-commit revert is not a sequence (probe P5)")
	}
	if len(revertResp.InProgress.ConflictedPaths) == 0 {
		t.Fatal("want at least one conflicted path")
	}

	respBanner := requestOK(t, client, "status.get", gitrpc.StatusGetParams{RepoID: repoID})
	bannerStatus := unmarshalResult[gitpreflight.StatusSummary](t, respBanner.Result)
	if bannerStatus.InProgress == nil || bannerStatus.InProgress.Kind != gitpreflight.InProgressRevert {
		t.Fatalf("status.get's own inProgress = %+v", bannerStatus.InProgress)
	}

	abortResp := opRunOK(t, client, repoID, gitsession.OpRequest{Kind: "opAbort"})
	if !abortResp.OK {
		t.Fatalf("opAbort failed: %+v", abortResp)
	}
	if abortResp.InProgress != nil {
		t.Fatalf("inProgress after abort = %+v, want nil", abortResp.InProgress)
	}
}

func TestIntegration_CheckoutPreflightAndRun(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "checkout-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	preflight := func(target, mode string) gitpreflight.CheckoutPreflight {
		t.Helper()
		resp := requestOK(t, client, "preflight.checkout", gitrpc.PreflightCheckoutParams{RepoID: repoID, Target: target, Mode: mode})
		return unmarshalResult[gitpreflight.CheckoutPreflight](t, resp.Result)
	}

	// clean.
	clean := preflight("sibling", "switch")
	if clean.Verdict != "clean" {
		t.Fatalf("clean verdict = %q: %+v", clean.Verdict, clean)
	}

	// cleanCarry: an untracked file outside T.
	if err := os.WriteFile(filepath.Join(f.dir, "scratch.txt"), []byte("scratch\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	carry := preflight("sibling", "switch")
	if carry.Verdict != "cleanCarry" {
		t.Fatalf("cleanCarry verdict = %q: %+v", carry.Verdict, carry)
	}
	if err := os.Remove(filepath.Join(f.dir, "scratch.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}

	// blockedByTracked: a tracked, dirty file that IS in T (sibling lacks conflict.txt entirely).
	if err := os.WriteFile(filepath.Join(f.dir, "conflict.txt"), []byte("locally modified\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	tracked := preflight("sibling", "switch")
	if tracked.Verdict != "blocked" || !hasCheckoutBlocker(tracked.Blockers, "blockedByTracked") {
		t.Fatalf("blockedByTracked: %+v", tracked)
	}
	// G17 D8: StashAvailable is now unconditionally true, so a tracked-only block also offers
	// "stashAndCarry" alongside "discard" (ClassifyCheckout's own rule — an untracked block still
	// suppresses both, per the blockedByUntracked case below, which is unaffected by this flip).
	// G28 D2: a tracked-only block ALSO now offers "autoStash" (the one route that clears both
	// dirty-blocker kinds, F5/probe P15) alongside the other two.
	if len(tracked.Routes) != 3 || tracked.Routes[0] != "discard" || tracked.Routes[1] != "stashAndCarry" || tracked.Routes[2] != "autoStash" {
		t.Fatalf("routes = %v, want [discard stashAndCarry autoStash]", tracked.Routes)
	}
	runGitIn(t, f.dir, "checkout", "-q", "--", "conflict.txt")

	// blockedByUntracked: switch to sibling first (for real), then an untracked file collides
	// with a path "main" would need to CREATE.
	runGitIn(t, f.dir, "checkout", "-q", "-f", "sibling")
	if err := os.WriteFile(filepath.Join(f.dir, "conflict.txt"), []byte("untracked collision\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	untracked := preflight("main", "switch")
	if untracked.Verdict != "blocked" || !hasCheckoutBlocker(untracked.Blockers, "blockedByUntracked") {
		t.Fatalf("blockedByUntracked: %+v", untracked)
	}
	// G28 D2: "discard"/"stashAndCarry" stay suppressed (probe P9), but "autoStash" is now offered
	// even for an untracked-only block -- `stash push -u` is the one argv proven to clear it
	// (F5/probe P15).
	if len(untracked.Routes) != 1 || untracked.Routes[0] != "autoStash" {
		t.Fatalf("routes = %v, want exactly [autoStash]", untracked.Routes)
	}
	if err := os.Remove(filepath.Join(f.dir, "conflict.txt")); err != nil {
		t.Fatalf("remove: %v", err)
	}

	// worktreeConflict: feature2 is checked out in a linked worktree that is not ours.
	wc := preflight("feature2", "switch")
	if wc.Verdict != "blocked" || !hasCheckoutBlocker(wc.Blockers, "worktreeConflict") {
		t.Fatalf("worktreeConflict: %+v", wc)
	}
	for _, b := range wc.Blockers {
		if b.Kind == "worktreeConflict" && b.Branch != "feature2" {
			t.Fatalf("worktreeConflict blocker branch = %q, want feature2", b.Branch)
		}
	}
	// G28 D6: a switch to a branch target whose sole blocker is worktreeConflict offers
	// "detachHere" over the real wire, not just the pure classifier's own unit tests.
	if len(wc.Routes) != 1 || wc.Routes[0] != "detachHere" {
		t.Fatalf("routes = %v, want exactly [detachHere]", wc.Routes)
	}

	// The real switch: op.run performing the checkout, its OWN reply naming the new head — read
	// synchronously, before any repo.changed event is consumed.
	runResp := opRunOK(t, client, repoID, gitsession.OpRequest{Kind: "checkout", Target: "main", Mode: "switch"})
	if !runResp.OK {
		t.Fatalf("checkout op.run failed: %+v", runResp)
	}
	if runResp.Head.Kind != "branch" || runResp.Head.Name != "main" {
		t.Fatalf("head after checkout = %+v", runResp.Head)
	}
	ev := client.recvEvent("repo.changed")
	if ev.Kind != "refsChanged" {
		t.Fatalf("event = %+v, want refsChanged", ev)
	}
}

func TestIntegration_RevertPreflightAndConflict(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "revert-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	revertPreflight := func(shas []string, mainline *int) gitpreflight.RevertPreflight {
		t.Helper()
		resp := requestOK(t, client, "preflight.revert", gitrpc.PreflightRevertParams{RepoID: repoID, Shas: shas, Mainline: mainline})
		return unmarshalResult[gitpreflight.RevertPreflight](t, resp.Result)
	}

	clean := revertPreflight([]string{f.cleanRevertTarget}, nil)
	if clean.Verdict != "clean" || clean.Prediction.Kind != "clean" {
		t.Fatalf("clean revert preflight = %+v", clean)
	}

	conflict := revertPreflight([]string{f.conflictTarget}, nil)
	if conflict.Verdict != "willConflict" || conflict.Prediction.Kind != "conflicts" {
		t.Fatalf("conflicting revert preflight = %+v", conflict)
	}
	if conflict.PredictedFor == nil || *conflict.PredictedFor != f.conflictTarget {
		t.Fatalf("predictedFor = %v", conflict.PredictedFor)
	}

	mainlineReq := revertPreflight([]string{f.mergeCommit}, nil)
	if mainlineReq.Verdict != "blocked" || len(mainlineReq.MainlineRequired) != 1 {
		t.Fatalf("mainlineRequired preflight = %+v", mainlineReq)
	}
	if mainlineReq.MainlineRequired[0].Sha != f.mergeCommit || len(mainlineReq.MainlineRequired[0].Parents) != 2 {
		t.Fatalf("mainlineRequired entry = %+v", mainlineReq.MainlineRequired[0])
	}

	runResp := opRunOK(t, client, repoID, gitsession.OpRequest{Kind: "revert", Shas: []string{f.conflictTarget}})
	if runResp.OK {
		t.Fatalf("revert should have failed: %+v", runResp)
	}
	if runResp.Error == nil || runResp.Error.Kind != "Conflict" {
		t.Fatalf("error = %+v, want Conflict", runResp.Error)
	}
	if runResp.InProgress == nil || runResp.InProgress.Kind != gitpreflight.InProgressRevert {
		t.Fatalf("inProgress = %+v, want revert populated even on failure", runResp.InProgress)
	}
}

func TestIntegration_UndoBranchDeleteRestoresTracking(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "undo-branch-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	deleteResp := opRunOK(t, client, repoID, gitsession.OpRequest{Kind: "branchDelete", Name: f.trackedBranch, Force: true})
	if !deleteResp.OK {
		t.Fatalf("branchDelete failed: %+v", deleteResp)
	}
	if deleteResp.Undo == nil || deleteResp.Undo.Label != "Deleted branch tracked" {
		t.Fatalf("undo snapshot = %+v", deleteResp.Undo)
	}

	peekResp := requestOK(t, client, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID})
	peek := unmarshalResult[gitrpc.UndoPeekResult](t, peekResp.Result)
	if peek.Slot == nil || peek.Slot.ID != deleteResp.Undo.ID {
		t.Fatalf("undo.peek = %+v", peek.Slot)
	}

	runResp := requestOK(t, client, "undo.run", gitrpc.UndoRunParams{RepoID: repoID, ID: deleteResp.Undo.ID})
	undoResult := unmarshalResult[gitsession.OpResult](t, runResp.Result)
	if !undoResult.OK {
		t.Fatalf("undo.run failed: %+v", undoResult)
	}

	out := runGitOutput(t, f.dir, "rev-parse", "--verify", "refs/heads/tracked")
	if trimNewline(out) != f.mergeCommit {
		t.Fatalf("restored branch sha = %q, want %q (tracked was moved to mergeCommit in the fixture)", trimNewline(out), f.mergeCommit)
	}
	cfg := runGitOutput(t, f.dir, "config", "--get-regexp", `^branch\.tracked\.`)
	if !containsSubstring(cfg, "branch.tracked.remote origin") || !containsSubstring(cfg, "branch.tracked.merge refs/heads/tracked") {
		t.Fatalf("restored config = %q", cfg)
	}

	secondResp := requestOK(t, client, "undo.run", gitrpc.UndoRunParams{RepoID: repoID, ID: deleteResp.Undo.ID})
	second := unmarshalResult[gitsession.OpResult](t, secondResp.Result)
	if second.OK || second.Error == nil || second.Error.Kind != "NotFound" {
		t.Fatalf("second undo.run = %+v, want NotFound", second)
	}
}

// pairAndReadyWithLabel is pairAndReady with a caller-chosen client LABEL (pairAndReady itself
// hardcodes "integration test" for every caller) — needed only here, to prove D7/F9's own
// per-window attribution actually varies with the handshake's own label.
func pairAndReadyWithLabel(t *testing.T, server *Server, sockPath, clientID, label string) *testClient {
	t.Helper()
	c := dialTestClient(t, sockPath)
	errCh := make(chan error, 1)
	go approveHead(server, errCh)
	kind, _ := c.hello(clientID, label, nil)
	if err := <-errCh; err != nil {
		t.Fatalf("approveHead: %v", err)
	}
	if kind != "ready" {
		t.Fatalf("hello outcome for %s: got %q", clientID, kind)
	}
	return c
}

func TestIntegration_UndoSlotIsSharedAndAttributed(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA := pairAndReadyWithLabel(t, server, sockPath, "undo-window-a", "undo-window-a")
	clientB := pairAndReadyWithLabel(t, server, sockPath, "undo-window-b", "undo-window-b")

	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	deleteResp := opRunOK(t, clientA, repoID, gitsession.OpRequest{Kind: "tagDelete", Name: f.lightTag})
	if !deleteResp.OK {
		t.Fatalf("tagDelete failed: %+v", deleteResp)
	}

	peekAResp := requestOK(t, clientA, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID})
	peekA := unmarshalResult[gitrpc.UndoPeekResult](t, peekAResp.Result)
	if peekA.Slot == nil || peekA.Slot.Label != "Deleted tag v-light" {
		t.Fatalf("window A's own peek = %+v, want the unsuffixed label", peekA.Slot)
	}

	peekBResp := requestOK(t, clientB, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID})
	peekB := unmarshalResult[gitrpc.UndoPeekResult](t, peekBResp.Result)
	if peekB.Slot == nil || peekB.Slot.Label != "Deleted tag v-light (window: undo-window-a)" {
		t.Fatalf("window B's own peek = %+v, want the suffixed label", peekB.Slot)
	}

	// Any op from either window clears it.
	if !opRunOK(t, clientB, repoID, gitsession.OpRequest{Kind: "branchRename", From: "sibling", To: "sibling2"}).OK {
		t.Fatal("branchRename should have succeeded")
	}
	peekAfterResp := requestOK(t, clientA, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID})
	peekAfter := unmarshalResult[gitrpc.UndoPeekResult](t, peekAfterResp.Result)
	if peekAfter.Slot != nil {
		t.Fatalf("slot after another op = %+v, want nil", peekAfter.Slot)
	}
}

func TestIntegration_UnservedOpKindIsRefused(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "unserved-client")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	resp := client.request("op.run", gitrpc.OpRunParams{RepoID: repoID, Op: gitsession.OpRequest{Kind: "tagPush"}})
	if resp.T != "res" || resp.OK == nil || *resp.OK {
		t.Fatalf("op.run tagPush = %+v, want a refused response", resp)
	}
	if resp.Error == nil || resp.Error.Code != "E_UNKNOWN_METHOD" {
		t.Fatalf("error = %+v, want E_UNKNOWN_METHOD", resp.Error)
	}
	if !containsSubstring(resp.Error.Message, "tagPush") {
		t.Fatalf("message = %q, want it to name the kind", resp.Error.Message)
	}
}

// TestIntegration_WriteSurvivesClientCancel is D8's own end-to-end proof: a `cancel` frame sent
// mid-op.run does not prevent the write from completing, nor the shared head from being updated —
// observed from a second connection, since the cancelling connection is never sent a reply at all
// (rpcstream's own "result simply not delivered anywhere"). Driven through an injected Runner that
// blocks the checkout's own write spawn until the test releases it, so the race is deterministic.
func TestIntegration_WriteSurvivesClientCancel(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	realRunner := gitclient.NewExecRunner()

	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	blockingRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if !spec.ReadOnly && argvContains(spec.Args, "switch") {
			once.Do(func() { close(started) })
			<-release
		}
		return realRunner.Start(ctx, gitPath, spec)
	})

	server, sockPath, _, _ := newIntegrationServerWithRunner(t, blockingRunner)
	clientA := pairAndReady(t, server, sockPath, "cancel-client-a")
	clientB := pairAndReady(t, server, sockPath, "cancel-client-b")

	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	id := clientA.next
	clientA.next++
	params, err := json.Marshal(gitrpc.OpRunParams{RepoID: repoID, Op: gitsession.OpRequest{Kind: "checkout", Target: "sibling", Mode: "switch"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "op.run", Params: params}})

	<-started // the write spawn is now blocked inside the runner — a real spawn, mid-flight.

	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "cancel", ID: id}})
	close(release) // let the (already-detached) write proceed regardless of the cancel's timing.

	// clientB observes the write actually completing: a fresh refs.list confirming HEAD moved to
	// "sibling" — proof the write survived the cancel. The checkout can fire more than one
	// repo.changed event (refs AND worktree both move), so this drains and ignores any interleaved
	// 'evt' frames rather than assuming exactly one — graphstream_test.go's own recvEvent has no
	// such tolerance and is deliberately not reused here for that reason.
	refs := waitForHeadName(t, clientB, repoID, "sibling")
	if refs.Head.Kind != "branch" || refs.Head.Name != "sibling" {
		t.Fatalf("head after the cancelled-but-completed write = %+v", refs.Head)
	}
}

// waitForHeadName polls refs.list (draining and ignoring any interleaved 'evt' frames on the way)
// until head.name == want or a bounded number of attempts is exhausted — the write under test
// completes asynchronously once the blocking runner is released, so this is not instantaneous.
func waitForHeadName(t *testing.T, c *testClient, repoID, want string) gitsession.RefsResult {
	t.Helper()
	var last gitsession.RefsResult
	for i := 0; i < 200; i++ {
		resp := requestIgnoringEvents(t, c, "refs.list", gitrpc.RefsListParams{RepoID: repoID})
		if resp.T != "res" || resp.OK == nil || !*resp.OK {
			t.Fatalf("refs.list: got %+v", resp)
		}
		last = unmarshalResult[gitsession.RefsResult](t, resp.Result)
		if last.Head.Name == want {
			return last
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("head never became %q, last = %+v", want, last.Head)
	return last
}

// requestIgnoringEvents is testClient.request, tolerant of 'evt' frames interleaved before the
// matching 'res' — needed only by tests that read from a connection with a live repo.changed
// subscription while a request is outstanding on it (every other test in this file avoids that
// interleaving entirely, per graphstream_test.go's own recvEvent doc comment).
func requestIgnoringEvents(t *testing.T, c *testClient, method string, params any) wireFrame {
	t.Helper()
	id := c.next
	c.next++
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	env := wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: method, Params: paramsJSON}}
	c.sendRaw(env)
	for {
		raw, err := readFrame(c.r)
		if err != nil {
			c.t.Fatalf("read response: %v", err)
		}
		var respEnv wireEnvelope
		if err := json.Unmarshal(raw, &respEnv); err != nil {
			c.t.Fatalf("unmarshal response: %v\n%s", err, raw)
		}
		if respEnv.Body.T == "evt" {
			continue
		}
		if respEnv.Body.ID != id {
			c.t.Fatalf("response id %d, want %d", respEnv.Body.ID, id)
		}
		return respEnv.Body
	}
}

func argvContains(args []string, needle string) bool {
	for _, a := range args {
		if a == needle {
			return true
		}
	}
	return false
}

func containsSubstring(s, substr string) bool {
	return len(s) >= len(substr) && (substr == "" || indexOf(s, substr) >= 0)
}

func indexOf(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

func runGitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = opsFixtureEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// findRefRow looks up one row of RefsResult.Branches/RemoteBranches/Tags (porcelain.RefRow,
// gitsession's own direct re-export onto the wire, D5's precedent) by its short name.
func findRefRow(rows []porcelain.RefRow, name string) *porcelain.RefRow {
	for i := range rows {
		if rows[i].ShortName == name {
			return &rows[i]
		}
	}
	return nil
}
