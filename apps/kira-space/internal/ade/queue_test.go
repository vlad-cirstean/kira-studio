package ade

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// queue_test.go is P129 Part 2 §9.1's own integration suite: every real git op Queue issues (fetch,
// force push, worktree add/remove, merge-tree, reflog) run against a real repo in t.TempDir(), no
// fakes below the gitsession.RepoEntry boundary — the ten scenarios §9.1 enumerates, one test
// function (or a small group) per scenario.

var skipWithoutGitQueue = testx.SkipWithoutGit

const queueMineName, queueMineEmail = "Mine Author", "mine@example.com"
const queueOtherName, queueOtherEmail = "Other Author", "other@example.com"

// runGitQueue runs a git command with the "mine" identity as both author and committer — every
// queue_test.go call not explicitly authored otherwise.
func runGitQueue(t *testing.T, dir string, args ...string) string {
	t.Helper()
	return runGitQueueAs(t, dir, queueMineName, queueMineEmail, args...)
}

func runGitQueueAs(t *testing.T, dir, name, email string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME="+name, "GIT_AUTHOR_EMAIL="+email,
		"GIT_COMMITTER_NAME="+name, "GIT_COMMITTER_EMAIL="+email,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimRight(string(out), "\n")
}

func writeQueueFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

// initQueueRepo builds a bare "origin" plus a clone checked out on "main" with one commit, the
// "mine" identity configured (Queue.snapshotLocked's own user.email read).
func initQueueRepo(t *testing.T) (origin, dir string) {
	t.Helper()
	origin = t.TempDir()
	runGitQueue(t, origin, "init", "-q", "--bare", "-b", "main")
	dir = t.TempDir()
	runGitQueue(t, dir, "clone", "-q", origin, ".")
	runGitQueue(t, dir, "config", "user.name", queueMineName)
	runGitQueue(t, dir, "config", "user.email", queueMineEmail)
	runGitQueue(t, dir, "checkout", "-q", "-b", "main")
	writeQueueFile(t, dir, "base.txt", "base\n")
	runGitQueue(t, dir, "add", "base.txt")
	runGitQueue(t, dir, "commit", "-q", "-m", "base")
	runGitQueue(t, dir, "push", "-q", "-u", "origin", "main")
	return origin, dir
}

// addQueueWorktree creates branch off base in a fresh linked worktree, returning its path.
func addQueueWorktree(t *testing.T, mainDir, branch, base string) string {
	t.Helper()
	wt := filepath.Join(t.TempDir(), branch)
	runGitQueue(t, mainDir, "worktree", "add", "-q", "-b", branch, wt, base)
	return wt
}

// --- harness -------------------------------------------------------------------------------

type queueHarness struct {
	t        *testing.T
	repos    *repos.Repos
	registry *gitsession.Registry
	q        *Queue
	clock    *fakeClock

	mu       sync.Mutex
	roots    map[string]string
	sessions map[string][]SessionRef
	closed   []string

	repoChanged     int32
	sessionsChanged int32
}

func newQueueHarness(t *testing.T) *queueHarness {
	t.Helper()
	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}

	h := &queueHarness{
		t: t, repos: repositories,
		registry: gitsession.NewRegistry(gitclient.NewExecRunner()),
		clock:    newFakeClock(),
		roots:    map[string]string{},
		sessions: map[string][]SessionRef{},
	}
	t.Cleanup(h.registry.Close)

	deps := QueueDeps{
		Store: repositories.AdeQueue,
		Sessions: func(codeRepoID string) []SessionRef {
			h.mu.Lock()
			defer h.mu.Unlock()
			return append([]SessionRef(nil), h.sessions[codeRepoID]...)
		},
		CodeRepo: func(id string) (string, bool) {
			h.mu.Lock()
			defer h.mu.Unlock()
			r, ok := h.roots[id]
			return r, ok
		},
		Registry: h.registry,
		GitPath:  func() string { return "git" },
		CloseTerminal: func(id string) error {
			h.mu.Lock()
			defer h.mu.Unlock()
			h.closed = append(h.closed, id)
			return nil
		},
		OnRepoChanged:     func(string) { atomic.AddInt32(&h.repoChanged, 1) },
		OnSessionsChanged: func() { atomic.AddInt32(&h.sessionsChanged, 1) },
		AutofetchMinutes:  func() int { return 15 },
		Now:               h.clock.Now,
	}
	h.q = NewQueue(deps)
	t.Cleanup(h.q.Close)
	return h
}

func (h *queueHarness) addRepo(codeRepoID, root string) {
	h.t.Helper()
	h.mu.Lock()
	h.roots[codeRepoID] = root
	h.mu.Unlock()
	if _, err := h.repos.CodeRepos.Create(model.CodeRepo{ID: codeRepoID, Name: codeRepoID, Root: root, RepoID: codeRepoID}); err != nil {
		h.t.Fatalf("create code repo %s: %v", codeRepoID, err)
	}
}

func (h *queueHarness) setSessions(codeRepoID string, refs ...SessionRef) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.sessions[codeRepoID] = refs
}

func findBranchFact(snap RepoSnapshot, id string) (BranchFact, bool) {
	for _, b := range snap.Branches {
		if b.ID == id {
			return b, true
		}
	}
	return BranchFact{}, false
}

func findPair(snap RepoSnapshot, a, b string) (PairFact, bool) {
	for _, p := range snap.Pairs {
		if p.A == a && p.B == b {
			return p, true
		}
	}
	return PairFact{}, false
}

func findNewWork(snap RepoSnapshot, id string) (NewWorkFact, bool) {
	for _, w := range snap.NewWork {
		if w.ID == id {
			return w, true
		}
	}
	return NewWorkFact{}, false
}

// --- 1: pairs (conflict / shared-only / no shared files) ------------------------------------

func TestQueue_Snapshot_PairsConflictShareNoOverlap(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	// shared.txt: 5 lines, wide enough apart that editing line 1 vs line 5 never conflicts.
	writeQueueFile(t, dir, "shared.txt", "l1\nl2\nl3\nl4\nl5\n")
	runGitQueue(t, dir, "add", "shared.txt")
	runGitQueue(t, dir, "commit", "-q", "-m", "add shared.txt")
	runGitQueue(t, dir, "push", "-q", "origin", "main")
	mainTip := runGitQueue(t, dir, "rev-parse", "main")

	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "shared.txt", "a1\nl2\nl3\nl4\nl5\n")
	runGitQueue(t, wtA, "commit", "-q", "-am", "a edits line 1")

	wtB := addQueueWorktree(t, dir, "b", "main")
	writeQueueFile(t, wtB, "shared.txt", "b1\nl2\nl3\nl4\nl5\n")
	runGitQueue(t, wtB, "commit", "-q", "-am", "b edits line 1 differently")

	wtC := addQueueWorktree(t, dir, "c", "main")
	writeQueueFile(t, wtC, "shared.txt", "l1\nl2\nl3\nl4\nc5\n")
	runGitQueue(t, wtC, "commit", "-q", "-am", "c edits line 5")

	wtD := addQueueWorktree(t, dir, "d", "main")
	writeQueueFile(t, wtD, "other.txt", "d\n")
	runGitQueue(t, wtD, "add", "other.txt")
	runGitQueue(t, wtD, "commit", "-q", "-m", "d touches a different file")

	ctx := context.Background()
	for _, b := range []string{"a", "b", "c", "d"} {
		if _, err := h.q.AddBranch(ctx, "cr1", b, ""); err != nil {
			t.Fatalf("AddBranch(%s): %v", b, err)
		}
	}
	_ = mainTip

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	ab, ok := findPair(snap, "a", "b")
	if !ok {
		t.Fatal("expected a pair (a, b)")
	}
	if len(ab.Conflicts) != 1 || ab.Conflicts[0] != "shared.txt" {
		t.Fatalf("pair(a,b).Conflicts = %v, want [shared.txt]", ab.Conflicts)
	}

	ac, ok := findPair(snap, "a", "c")
	if !ok {
		t.Fatal("expected a pair (a, c)")
	}
	if len(ac.Shared) != 1 || ac.Shared[0] != "shared.txt" {
		t.Fatalf("pair(a,c).Shared = %v, want [shared.txt]", ac.Shared)
	}
	if len(ac.Conflicts) != 0 {
		t.Fatalf("pair(a,c).Conflicts = %v, want none (different hunks)", ac.Conflicts)
	}

	for _, p := range snap.Pairs {
		if p.A == "d" || p.B == "d" {
			t.Fatalf("d shares no file with anything, must not appear in a pair: %+v", p)
		}
	}
}

// --- 2: mine x review conflict, review authored by another email ----------------------------

func TestQueue_Snapshot_MineReviewConflictOwnerSet(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	writeQueueFile(t, dir, "shared.txt", "l1\nl2\n")
	runGitQueue(t, dir, "add", "shared.txt")
	runGitQueue(t, dir, "commit", "-q", "-m", "add shared.txt")
	runGitQueue(t, dir, "push", "-q", "origin", "main")

	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "shared.txt", "a1\nl2\n")
	runGitQueue(t, wtA, "commit", "-q", "-am", "a edits line 1")

	wtR := filepath.Join(t.TempDir(), "r")
	runGitQueueAs(t, dir, queueOtherName, queueOtherEmail, "worktree", "add", "-q", "-b", "r", wtR, "main")
	writeQueueFile(t, wtR, "shared.txt", "r1\nl2\n")
	runGitQueueAs(t, wtR, queueOtherName, queueOtherEmail, "commit", "-q", "-am", "r edits line 1 too")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}
	if _, err := h.q.AddBranch(ctx, "cr1", "r", ""); err != nil {
		t.Fatalf("AddBranch(r): %v", err)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	rf, ok := findBranchFact(snap, "r")
	if !ok {
		t.Fatal("no fact for r")
	}
	if rf.Kind != model.AdeBranchKindReview {
		t.Fatalf("r.Kind = %q, want review", rf.Kind)
	}
	if rf.Owner != queueOtherName || rf.AuthorEmail != queueOtherEmail {
		t.Fatalf("r owner/email = %q/%q, want %q/%q", rf.Owner, rf.AuthorEmail, queueOtherName, queueOtherEmail)
	}

	pair, ok := findPair(snap, "a", "r")
	if !ok {
		t.Fatal("expected a mine x review pair (a, r)")
	}
	if len(pair.Conflicts) != 1 || pair.Conflicts[0] != "shared.txt" {
		t.Fatalf("pair(a,r).Conflicts = %v, want [shared.txt]", pair.Conflicts)
	}
}

// --- 3: stack — base/behind tracks the config parent's own tip ------------------------------

func TestQueue_Snapshot_StackBaseAndBehindTrackParent(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	// Named so the child ("achild") sorts alphabetically before the base ("zbase"): inferParents'
	// own cycle guard (§0.5) processes items in sorted order, and once zbase gets a commit of its
	// own, achild's now-unmoved tip becomes a genuine git ancestor of zbase's new tip too (rule 2's
	// own "nearest ancestor" candidate for zbase) -- a real, spec-anticipated a<->b cycle between
	// rule 1 (achild's config parent is zbase) and rule 2 (zbase's guessed parent is achild).
	// Processing achild first walks achild->zbase->achild(seen) and zeroes zbase's OWN (wrong)
	// guess, leaving achild's correct config-based parent intact -- the opposite name order would
	// zero achild's instead (facts_test.go's own TestInferParents_CycleViaConfigResolvesOneSideToMain
	// exercises this exact mechanic in isolation).
	wtBase := addQueueWorktree(t, dir, "zbase", "main")
	addQueueWorktree(t, dir, "achild", "zbase")
	runGitQueue(t, dir, "config", "branch.achild.kirastackparent", "zbase")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "zbase", ""); err != nil {
		t.Fatalf("AddBranch(zbase): %v", err)
	}
	if _, err := h.q.AddBranch(ctx, "cr1", "achild", ""); err != nil {
		t.Fatalf("AddBranch(achild): %v", err)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	cf, ok := findBranchFact(snap, "achild")
	if !ok {
		t.Fatal("no fact for achild")
	}
	if cf.Base != "zbase" {
		t.Fatalf("achild.Base = %q, want zbase", cf.Base)
	}
	if cf.Behind != 0 {
		t.Fatalf("achild.Behind = %d, want 0 (achild == zbase's tip)", cf.Behind)
	}

	writeQueueFile(t, wtBase, "onBase.txt", "x\n")
	runGitQueue(t, wtBase, "add", "onBase.txt")
	runGitQueue(t, wtBase, "commit", "-q", "-m", "commit on zbase")

	snap, err = h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (2): %v", err)
	}
	cf, ok = findBranchFact(snap, "achild")
	if !ok {
		t.Fatal("no fact for achild (2)")
	}
	if cf.Behind != 1 {
		t.Fatalf("achild.Behind = %d, want 1 after a commit landed on zbase", cf.Behind)
	}
}

// --- 4: files deltas + binary flag; commits newest first; dirty codes -----------------------

func TestQueue_Snapshot_FilesCommitsDirty(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "text.txt", "one\n")
	runGitQueue(t, wtA, "add", "text.txt")
	runGitQueue(t, wtA, "commit", "-q", "-m", "first commit")
	if err := os.WriteFile(filepath.Join(wtA, "bin.dat"), []byte{0x00, 0x01, 0x02, 0x03}, 0o644); err != nil {
		t.Fatalf("write bin.dat: %v", err)
	}
	runGitQueue(t, wtA, "add", "bin.dat")
	runGitQueue(t, wtA, "commit", "-q", "-m", "second commit adds binary")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}

	// dirty: modify a tracked file (M), add an untracked one (??), delete a tracked one (D).
	writeQueueFile(t, wtA, "text.txt", "one\nmodified\n")
	writeQueueFile(t, wtA, "untracked.txt", "new\n")
	if err := os.Remove(filepath.Join(wtA, "bin.dat")); err != nil {
		t.Fatalf("remove bin.dat: %v", err)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	af, ok := findBranchFact(snap, "a")
	if !ok {
		t.Fatal("no fact for a")
	}

	if len(af.Commits) != 2 {
		t.Fatalf("len(Commits) = %d, want 2", len(af.Commits))
	}
	if !strings.Contains(af.Commits[0].Message, "second commit") {
		t.Fatalf("Commits[0] = %+v, want newest (second commit) first", af.Commits[0])
	}
	if !strings.Contains(af.Commits[1].Message, "first commit") {
		t.Fatalf("Commits[1] = %+v, want oldest (first commit) last", af.Commits[1])
	}

	var binDelta *FileDelta
	for i := range af.Files {
		if af.Files[i].Path == "bin.dat" {
			binDelta = &af.Files[i]
		}
	}
	if binDelta == nil || !binDelta.Binary {
		t.Fatalf("expected bin.dat to be reported binary, got %+v", af.Files)
	}

	codes := map[string]string{}
	for _, d := range af.Dirty {
		codes[d.Path] = d.Code
	}
	if codes["text.txt"] != "M" {
		t.Fatalf("text.txt dirty code = %q, want M", codes["text.txt"])
	}
	if codes["untracked.txt"] != "??" {
		t.Fatalf("untracked.txt dirty code = %q, want ??", codes["untracked.txt"])
	}
	if codes["bin.dat"] != "D" {
		t.Fatalf("bin.dat dirty code = %q, want D", codes["bin.dat"])
	}
}

// --- 5: merged detection (ancestor reachability, gated on had_commits) ----------------------

func TestQueue_Refresh_MergedDetection(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	origin, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "onA.txt", "x\n")
	runGitQueue(t, wtA, "add", "onA.txt")
	runGitQueue(t, wtA, "commit", "-q", "-m", "commit on a")

	// empty: branched at main's own tip, never gets a commit of its own -- must never be reported
	// merged even once main moves past it (ancestor-reachable trivially, but had_commits stays false).
	addQueueWorktree(t, dir, "empty", "main")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}
	if _, err := h.q.AddBranch(ctx, "cr1", "empty", ""); err != nil {
		t.Fatalf("AddBranch(empty): %v", err)
	}
	// Baseline snapshot so a's had_commits latches true before the merge lands.
	if _, err := h.q.Snapshot(ctx, "cr1"); err != nil {
		t.Fatalf("Snapshot (baseline): %v", err)
	}

	runGitQueue(t, dir, "merge", "-q", "--no-ff", "-m", "merge a", "a")
	runGitQueue(t, dir, "push", "-q", "origin", "main")
	_ = origin

	res, err := h.q.Refresh(ctx, "cr1")
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if res.Error != nil {
		t.Fatalf("Refresh.Error = %+v, want none", res.Error)
	}
	if len(res.NewlyMerged) != 1 || res.NewlyMerged[0] != "a" {
		t.Fatalf("Refresh.NewlyMerged = %v, want [a]", res.NewlyMerged)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (after): %v", err)
	}
	af, _ := findBranchFact(snap, "a")
	if !af.Merged || af.MergedAt == nil {
		t.Fatalf("a fact = %+v, want Merged with MergedAt set", af)
	}
	ef, _ := findBranchFact(snap, "empty")
	if ef.Merged {
		t.Fatalf("empty fact = %+v, want never merged (no commits of its own)", ef)
	}
}

// --- 6: Refresh fetches a moved review branch; refsChanged, facts rerun ---------------------

func TestQueue_Refresh_FetchesMovedReviewBranch(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	origin, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	otherDir := t.TempDir()
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "clone", "-q", origin, ".")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "config", "user.name", queueOtherName)
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "config", "user.email", queueOtherEmail)
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "checkout", "-q", "-b", "r")
	writeQueueFile(t, otherDir, "r.txt", "1\n")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "add", "r.txt")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "commit", "-q", "-m", "r commit 1")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "push", "-q", "origin", "r")

	runGitQueue(t, dir, "fetch", "-q", "origin")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "r", ""); err != nil {
		t.Fatalf("AddBranch(r): %v", err)
	}
	if _, err := h.q.Snapshot(ctx, "cr1"); err != nil {
		t.Fatalf("Snapshot (baseline): %v", err)
	}

	writeQueueFile(t, otherDir, "r.txt", "1\n2\n")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "commit", "-q", "-am", "r commit 2")
	runGitQueueAs(t, otherDir, queueOtherName, queueOtherEmail, "push", "-q", "origin", "r")

	res, err := h.q.Refresh(ctx, "cr1")
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if res.Error != nil {
		t.Fatalf("Refresh.Error = %+v, want none", res.Error)
	}
	if res.RefsChanged != 1 {
		t.Fatalf("Refresh.RefsChanged = %d, want 1 (only r moved)", res.RefsChanged)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (after): %v", err)
	}
	rf, ok := findBranchFact(snap, "r")
	if !ok || len(rf.Commits) != 2 {
		t.Fatalf("r fact after refresh = %+v, want 2 commits (facts rerun on the moved ref)", rf)
	}
}

// --- 7: force push clears unpushed; a stale lease is rejected, the loop continues -----------

func TestQueue_ForcePush_SucceedsAndRejectsStaleLease(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	origin, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	// a: pushed with upstream, then rewritten locally (amend) -- diverged, unpushed=true.
	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "a.txt", "1\n")
	runGitQueue(t, wtA, "add", "a.txt")
	runGitQueue(t, wtA, "commit", "-q", "-m", "a commit 1")
	runGitQueue(t, wtA, "push", "-q", "-u", "origin", "a")
	writeQueueFile(t, wtA, "a.txt", "1\nrewritten\n")
	runGitQueue(t, wtA, "commit", "-q", "--amend", "-am", "a commit 1 rewritten")

	// b: pushed with upstream; another clone force-moves origin's b without dir ever refetching.
	wtB := addQueueWorktree(t, dir, "b", "main")
	writeQueueFile(t, wtB, "b.txt", "1\n")
	runGitQueue(t, wtB, "add", "b.txt")
	runGitQueue(t, wtB, "commit", "-q", "-m", "b commit 1")
	runGitQueue(t, wtB, "push", "-q", "-u", "origin", "b")

	otherDir := t.TempDir()
	runGitQueue(t, otherDir, "clone", "-q", origin, ".")
	runGitQueue(t, otherDir, "checkout", "-q", "b")
	writeQueueFile(t, otherDir, "b.txt", "1\nfrom other clone\n")
	runGitQueue(t, otherDir, "commit", "-q", "-am", "b commit 2 from elsewhere")
	runGitQueue(t, otherDir, "push", "-q", "origin", "b")
	// dir's own refs/remotes/origin/b is now stale -- never fetched since.

	writeQueueFile(t, wtB, "b.txt", "1\nrewritten locally too\n")
	runGitQueue(t, wtB, "commit", "-q", "-am", "b commit 1 rewritten locally")

	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}
	if _, err := h.q.AddBranch(ctx, "cr1", "b", ""); err != nil {
		t.Fatalf("AddBranch(b): %v", err)
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if !snap.Plan.Unpushed["a"] {
		t.Fatal("Plan.Unpushed[a] = false, want true (a diverged from its own upstream)")
	}

	results, err := h.q.ForcePush(ctx, "cr1", []string{"a", "b"}, nil)
	if err != nil {
		t.Fatalf("ForcePush: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("len(results) = %d, want 2", len(results))
	}
	if results[0].Branch != "a" || !results[0].OK || results[0].Error != nil {
		t.Fatalf("results[0] (a) = %+v, want ok", results[0])
	}
	if results[1].Branch != "b" || results[1].OK || results[1].Error == nil {
		t.Fatalf("results[1] (b) = %+v, want rejected (stale lease from the other clone's push)", results[1])
	}

	snap, err = h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (after): %v", err)
	}
	if snap.Plan.Unpushed["a"] {
		t.Fatal("Plan.Unpushed[a] still true after a successful force push")
	}
}

// --- 8: archive -- clean removed, plan row gone, color kept; dirty gated by discard ---------

func TestQueue_Archive_CleanAndDirtyPaths(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)

	wtA := addQueueWorktree(t, dir, "a", "main")
	ctx := context.Background()
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}
	if err := h.q.SetPlan("cr1", nil, []string{"a"}); err != nil {
		t.Fatalf("SetPlan: %v", err)
	}

	if err := h.q.Archive(ctx, "cr1", "a", false); err != nil {
		t.Fatalf("Archive(a, clean): %v", err)
	}
	if _, err := os.Stat(wtA); !os.IsNotExist(err) {
		t.Fatalf("worktree %s still exists after a clean archive: %v", wtA, err)
	}
	state, err := h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	var aRow model.AdeBranch
	for _, b := range state.Branches {
		if b.Branch == "a" {
			aRow = b
		}
	}
	if aRow.ArchivedAt == nil {
		t.Fatal("a not marked archived")
	}
	for _, p := range state.Plan {
		if p.Item == "a" {
			t.Fatal("plan row for a still present after archive")
		}
	}
	foundColor := false
	for _, c := range state.Colors {
		if c.Item == "a" {
			foundColor = true
		}
	}
	if !foundColor {
		t.Fatal("color row for a should survive archive (history keeps the color)")
	}

	// b: dirty worktree, discard=false must refuse; discard=true must remove it.
	wtB := addQueueWorktree(t, dir, "b", "main")
	if _, err := h.q.AddBranch(ctx, "cr1", "b", ""); err != nil {
		t.Fatalf("AddBranch(b): %v", err)
	}
	writeQueueFile(t, wtB, "dirty.txt", "uncommitted\n")

	if err := h.q.Archive(ctx, "cr1", "b", false); err == nil {
		t.Fatal("Archive(b, dirty, discard=false) should refuse")
	}
	if _, err := os.Stat(wtB); err != nil {
		t.Fatalf("worktree b should still exist after a refused archive: %v", err)
	}

	if err := h.q.Archive(ctx, "cr1", "b", true); err != nil {
		t.Fatalf("Archive(b, dirty, discard=true): %v", err)
	}
	if _, err := os.Stat(wtB); !os.IsNotExist(err) {
		t.Fatalf("worktree b still exists after a discard archive: %v", err)
	}
}

// --- 9: rebind -- typed name, exact-one heuristic match, ambiguous candidates ---------------

func TestQueue_Snapshot_RebindsNewWorkAndReportsCandidates(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)
	ctx := context.Background()

	sessionStart := time.Now().Add(-time.Minute)

	nw1, err := h.q.AddNewWork("cr1", NewWorkInput{Title: "Feature One"})
	if err != nil {
		t.Fatalf("AddNewWork(nw1): %v", err)
	}
	h.setSessions("cr1", SessionRef{ID: "s1", NewWorkID: nw1, State: model.AdeSessionStateRunning, TerminalID: "t1", StartedAt: sessionStart.UnixMilli()})
	if err := h.q.SetPlan("cr1", nil, []string{nw1}); err != nil {
		t.Fatalf("SetPlan(nw1): %v", err)
	}

	addQueueWorktree(t, dir, "feat1", "main")

	before := atomic.LoadInt32(&h.sessionsChanged)
	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if atomic.LoadInt32(&h.sessionsChanged) <= before {
		t.Fatal("expected OnSessionsChanged to fire on rebind")
	}
	if _, found := findNewWork(snap, nw1); found {
		t.Fatal("nw1 should no longer be a new-work row once rebound")
	}
	bf, ok := findBranchFact(snap, "feat1")
	if !ok {
		t.Fatal("feat1 should now be a queued branch")
	}
	_ = bf
	state, err := h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	foundPlan := false
	for _, p := range state.Plan {
		if p.Item == "feat1" {
			foundPlan = true
		}
	}
	if !foundPlan {
		t.Fatal("plan row should be rekeyed from nw1 to feat1")
	}
	foundColor := false
	for _, c := range state.Colors {
		if c.Item == "feat1" {
			foundColor = true
		}
	}
	if !foundColor {
		t.Fatal("color row should be rekeyed from nw1 to feat1")
	}

	// Ambiguous case: two qualifying candidates -> stays unbound, both served as BranchCandidates.
	nw2, err := h.q.AddNewWork("cr1", NewWorkInput{Title: "Feature Two"})
	if err != nil {
		t.Fatalf("AddNewWork(nw2): %v", err)
	}
	h.setSessions("cr1", SessionRef{ID: "s1", NewWorkID: nw1, State: model.AdeSessionStateRunning, TerminalID: "t1", StartedAt: sessionStart.UnixMilli()},
		SessionRef{ID: "s2", NewWorkID: nw2, State: model.AdeSessionStateRunning, TerminalID: "t2", StartedAt: sessionStart.UnixMilli()})
	addQueueWorktree(t, dir, "feat2a", "main")
	addQueueWorktree(t, dir, "feat2b", "main")

	snap, err = h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (2): %v", err)
	}
	w2, ok := findNewWork(snap, nw2)
	if !ok {
		t.Fatal("nw2 should remain a new-work row (ambiguous, unbound)")
	}
	got := append([]string(nil), w2.BranchCandidates...)
	sort.Strings(got)
	want := []string{"feat2a", "feat2b"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("nw2.BranchCandidates = %v, want %v", got, want)
	}
	if _, found := findBranchFact(snap, "feat2a"); found {
		t.Fatal("feat2a must not be auto-bound while ambiguous")
	}
}

// --- P135: dependency link lifecycle across rebind, archive and resolve ---------------------

// TestQueue_Dependencies_LinkLifecycle is a cross-table invariant over Rebind/Archive, not a CRUD
// round-trip (CLAUDE.md's own unit-test bar) — a dependency's own blocker link must follow its
// blocked item through a rebind, disappear on archive, refuse a non-blockable target, and be
// deleted wholesale on resolve.
func TestQueue_Dependencies_LinkLifecycle(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)
	ctx := context.Background()

	nw1, err := h.q.AddNewWork("cr1", NewWorkInput{Title: "Feature One"})
	if err != nil {
		t.Fatalf("AddNewWork(nw1): %v", err)
	}

	depID, err := h.q.AddDependency("cr1", DependencyInput{Title: "Vendor reply", Blocks: []string{nw1}})
	if err != nil {
		t.Fatalf("AddDependency: %v", err)
	}

	state, err := h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !hasBlocker(state.Blockers, depID, nw1) {
		t.Fatal("expected a blocker link dep->nw1 right after AddDependency")
	}

	// Rebind nw1 onto a real branch (Snapshot's own auto-rebind, the exact-one-candidate path
	// TestQueue_Snapshot_RebindsNewWorkAndReportsCandidates already exercises) — the link must
	// follow. The heuristic only fires once a session names nw1 (firstSessionStart).
	h.setSessions("cr1", SessionRef{
		ID: "s1", NewWorkID: nw1, State: model.AdeSessionStateRunning, TerminalID: "t1",
		StartedAt: time.Now().Add(-time.Minute).UnixMilli(),
	})
	addQueueWorktree(t, dir, "feat1", "main")
	if _, err := h.q.Snapshot(ctx, "cr1"); err != nil {
		t.Fatalf("Snapshot (rebind): %v", err)
	}
	state, err = h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load (after rebind): %v", err)
	}
	if hasBlocker(state.Blockers, depID, nw1) {
		t.Fatal("blocker link should no longer key on nw1 after rebind")
	}
	if !hasBlocker(state.Blockers, depID, "feat1") {
		t.Fatal("blocker link should follow the rebind onto feat1")
	}

	// Linking a review branch, or an archived branch, must refuse (ErrNotBlockable).
	runGitQueue(t, dir, "branch", "b", "main")
	if _, err := h.q.AddBranch(ctx, "cr1", "b", model.AdeBranchKindReview); err != nil {
		t.Fatalf("AddBranch(b, review): %v", err)
	}
	if err := h.q.SetBlocker("cr1", depID, "b", true); !errors.Is(err, repos.ErrNotBlockable) {
		t.Fatalf("SetBlocker(review branch) = %v, want ErrNotBlockable", err)
	}
	runGitQueue(t, dir, "branch", "c", "main")
	if _, err := h.q.AddBranch(ctx, "cr1", "c", model.AdeBranchKindMine); err != nil {
		t.Fatalf("AddBranch(c, mine): %v", err)
	}
	if err := h.q.Archive(ctx, "cr1", "c", false); err != nil {
		t.Fatalf("Archive(c): %v", err)
	}
	if err := h.q.SetBlocker("cr1", depID, "c", true); !errors.Is(err, repos.ErrNotBlockable) {
		t.Fatalf("SetBlocker(archived branch) = %v, want ErrNotBlockable", err)
	}

	// Archive feat1 (the still-blocked item) — its own link must be deleted, not just orphaned.
	if err := h.q.Archive(ctx, "cr1", "feat1", false); err != nil {
		t.Fatalf("Archive(feat1): %v", err)
	}
	state, err = h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load (after archive): %v", err)
	}
	if hasBlocker(state.Blockers, depID, "feat1") {
		t.Fatal("blocker link should be deleted once its blocked item is archived")
	}

	// Resolve: sets resolved_at, deletes every remaining link, and the dependency surfaces in
	// history with kind "dependency".
	runGitQueue(t, dir, "branch", "d", "main")
	if _, err := h.q.AddBranch(ctx, "cr1", "d", model.AdeBranchKindMine); err != nil {
		t.Fatalf("AddBranch(d, mine): %v", err)
	}
	if err := h.q.SetBlocker("cr1", depID, "d", true); err != nil {
		t.Fatalf("SetBlocker(d, link): %v", err)
	}
	if err := h.q.ResolveDependency("cr1", depID); err != nil {
		t.Fatalf("ResolveDependency: %v", err)
	}
	state, err = h.repos.AdeQueue.Load("cr1")
	if err != nil {
		t.Fatalf("Load (after resolve): %v", err)
	}
	if hasBlocker(state.Blockers, depID, "d") {
		t.Fatal("resolve should delete every remaining blocker link")
	}
	var resolved model.AdeDependency
	found := false
	for _, d := range state.Dependencies {
		if d.ID == depID {
			resolved, found = d, true
		}
	}
	if !found || resolved.ResolvedAt == nil {
		t.Fatal("dependency should be marked resolved, its row kept for history")
	}

	snap, err := h.q.Snapshot(ctx, "cr1")
	if err != nil {
		t.Fatalf("Snapshot (final): %v", err)
	}
	for _, dep := range snap.Dependencies {
		if dep.ID == depID {
			t.Fatal("resolved dependency should not appear in live Dependencies")
		}
	}
	histFound := false
	for _, hi := range snap.History {
		if hi.Item == depID && hi.Kind == "dependency" {
			histFound = true
		}
	}
	if !histFound {
		t.Fatal("resolved dependency should appear in history with kind dependency")
	}
}

func hasBlocker(blockers []model.AdeBlocker, dependency, item string) bool {
	for _, b := range blockers {
		if b.Dependency == dependency && b.Item == item {
			return true
		}
	}
	return false
}

// --- 10: -race — concurrent Snapshot x8 with a Refresh and a SetPlan ------------------------

func TestQueue_ConcurrentSnapshotRefreshSetPlan(t *testing.T) {
	skipWithoutGitQueue(t)
	h := newQueueHarness(t)
	_, dir := initQueueRepo(t)
	h.addRepo("cr1", dir)
	ctx := context.Background()

	wtA := addQueueWorktree(t, dir, "a", "main")
	writeQueueFile(t, wtA, "a.txt", "1\n")
	runGitQueue(t, wtA, "add", "a.txt")
	runGitQueue(t, wtA, "commit", "-q", "-m", "a commit")
	if _, err := h.q.AddBranch(ctx, "cr1", "a", ""); err != nil {
		t.Fatalf("AddBranch(a): %v", err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 10)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := h.q.Snapshot(ctx, "cr1"); err != nil {
				errs <- err
			}
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := h.q.Refresh(ctx, "cr1"); err != nil {
			errs <- err
		}
	}()
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.q.SetPlan("cr1", nil, []string{"a"}); err != nil {
			errs <- err
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("concurrent op error: %v", err)
	}
}

// TestMainDisplay covers P129 Part 4 §0.5/§2.2: a local-only main, a remote-tracking main, and a
// nested branch name under a remote (`a/b`) — the one place MainRef's full refname is shortened for
// display, `countRefsChanged` keeps keying on the full refname untouched.
func TestMainDisplay(t *testing.T) {
	cases := []struct {
		name, full, wantName, wantRef string
	}{
		{"local", "refs/heads/main", "main", "main"},
		{"remote", "refs/remotes/origin/main", "main", "origin/main"},
		{"remote nested branch", "refs/remotes/origin/a/b", "a/b", "origin/a/b"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotName, gotRef := mainDisplay(c.full)
			if gotName != c.wantName || gotRef != c.wantRef {
				t.Errorf("mainDisplay(%q) = (%q, %q), want (%q, %q)", c.full, gotName, gotRef, c.wantName, c.wantRef)
			}
		})
	}
}
