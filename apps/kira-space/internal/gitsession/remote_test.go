package gitsession

import (
	"context"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
)

// --- opSlot: D24's own ≤1-slot concurrency matrix -----------------------------------------

func TestRemoteOpSlot_SecondClaimIsRefused(t *testing.T) {
	t.Parallel()
	var s opSlot
	if !s.claim("fetch", func() {}, false) {
		t.Fatal("first claim should succeed")
	}
	if s.claim("push", func() {}, false) {
		t.Fatal("a second claim while the slot is occupied should be refused")
	}
	s.release()
	if !s.claim("push", func() {}, false) {
		t.Fatal("a claim after release should succeed")
	}
}

func TestRemoteOpSlot_CancelOnIdleReportsFalse(t *testing.T) {
	t.Parallel()
	var s opSlot
	if s.tryCancel() {
		t.Fatal("cancelling an idle slot must report false, never true")
	}
}

func TestRemoteOpSlot_CancelOnNonKillablePhaseReportsFalseAndNeverCancels(t *testing.T) {
	t.Parallel()
	var s opSlot
	cancelled := false
	s.claim("push", func() { cancelled = true }, false)
	// killable defaults to false on claim (push's own default — never killable, D19).
	if s.tryCancel() {
		t.Fatal("cancelling a non-killable phase must report false")
	}
	if cancelled {
		t.Fatal("cancel() must never be called for a non-killable phase")
	}
}

func TestRemoteOpSlot_CancelOnKillablePhaseCancelsAndReportsTrue(t *testing.T) {
	t.Parallel()
	var s opSlot
	cancelled := false
	s.claim("fetch", func() { cancelled = true }, false)
	s.setKillable(true)
	if !s.tryCancel() {
		t.Fatal("cancelling a killable phase must report true")
	}
	if !cancelled {
		t.Fatal("cancel() must have been called")
	}
}

func TestRemoteOpSlot_ForceCancelIgnoresKillable(t *testing.T) {
	t.Parallel()
	var s opSlot
	cancelled := false
	s.claim("push", func() { cancelled = true }, false)
	s.forceCancel()
	if !cancelled {
		t.Fatal("forceCancel (teardown's own) must cancel regardless of killable")
	}
}

// --- Conn credential relay: D24's own four exits -------------------------------------------------

func TestConn_AskCredential_Answered(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var secret string
	var ok bool
	go func() {
		secret, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()

	// Find the requestId the way gitrpc's credential.provide handler would — reading it back off
	// the map this test is in the same package as.
	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})

	if !c.ProvideCredential(id, strPtrLocal("hunter2")) {
		t.Fatal("ProvideCredential should find the waiter")
	}
	<-done
	if !ok || secret != "hunter2" {
		t.Fatalf("got (%q, %v), want (\"hunter2\", true)", secret, ok)
	}
}

func TestConn_AskCredential_Dismissed(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()

	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})
	if !c.ProvideCredential(id, nil) {
		t.Fatal("ProvideCredential(nil) should still find the waiter")
	}
	<-done
	if ok {
		t.Fatal("a dismissal must answer (\"\", false)")
	}
}

func TestConn_AskCredential_CtxCancelled(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(ctx, gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		return len(c.creds) == 1
	})
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("AskCredential did not return after ctx was cancelled")
	}
	if ok {
		t.Fatal("a cancelled ctx must answer (\"\", false)")
	}
}

func TestConn_AskCredential_ConnClosed(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	var ok bool
	go func() {
		_, ok = c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		return len(c.creds) == 1
	})
	c.Close()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("AskCredential did not return after the connection closed")
	}
	if ok {
		t.Fatal("a closed connection must answer (\"\", false)")
	}
}

func TestConn_ProvideCredential_UnknownIDReportsFalse(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	if c.ProvideCredential("no-such-id", strPtrLocal("x")) {
		t.Fatal("an unknown request id must report false")
	}
}

func TestConn_ProvideCredential_TwiceIsANoOp(t *testing.T) {
	t.Parallel()
	c := NewConn("c1", "client-1", "label-1", func(string, any) {})
	done := make(chan struct{})
	go func() {
		c.AskCredential(context.Background(), gitaskpass.Request{Prompt: "Password: "})
		close(done)
	}()
	var id string
	waitFor(t, func() bool {
		c.credMu.Lock()
		defer c.credMu.Unlock()
		for k := range c.creds {
			id = k
			return true
		}
		return false
	})
	if !c.ProvideCredential(id, strPtrLocal("first")) {
		t.Fatal("first ProvideCredential should succeed")
	}
	<-done
	if c.ProvideCredential(id, strPtrLocal("second")) {
		t.Fatal("a second ProvideCredential for the same (already-answered) id must report false, never an error")
	}
}

func strPtrLocal(s string) *string { return &s }

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition never became true")
}

// TestResolveUpstreamRemoteBranch is G32 round-3 functional-correctness review finding #1/#3's own
// regression proof: fetch/pull/push used to assume a branch's remote-side name always matches its
// local name — real for a first push, false for `git checkout -b feat origin/main` and every fork
// workflow. %(upstream) doesn't need a reachable remote or an existing remote-tracking ref to
// resolve (it's computed purely from branch.<name>.{remote,merge} config), so this needs no bare
// remote repo to exercise the three cases that matter.
func TestResolveUpstreamRemoteBranch(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "branch", "feat")
	runGitStack(t, dir, "branch", "untracked")
	// %(upstream) only resolves once "origin" is a real configured remote (remote.origin.url) --
	// it need not be reachable, no fetch/network is involved in what this test exercises.
	runGitStack(t, dir, "remote", "add", "origin", t.TempDir())
	// feat tracks origin/main -- a differently-named upstream, the exact repro shape.
	runGitStack(t, dir, "config", "branch.feat.remote", "origin")
	runGitStack(t, dir, "config", "branch.feat.merge", "refs/heads/main")

	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	if remoteBranch, hasUpstream, err := entry.resolveUpstreamRemoteBranch(ctx, "origin", "feat"); err != nil {
		t.Fatalf("resolveUpstreamRemoteBranch(origin, feat): %v", err)
	} else if !hasUpstream || remoteBranch != "main" {
		t.Fatalf("resolveUpstreamRemoteBranch(origin, feat) = (%q, %v), want (\"main\", true) -- "+
			"feat tracks origin/main, not origin/feat", remoteBranch, hasUpstream)
	}

	// No upstream at all: falls back to the branch's own name, the pre-fix same-name behavior --
	// still correct for the common "never pushed yet" case, which this fix must not disturb.
	if remoteBranch, hasUpstream, err := entry.resolveUpstreamRemoteBranch(ctx, "origin", "untracked"); err != nil {
		t.Fatalf("resolveUpstreamRemoteBranch(origin, untracked): %v", err)
	} else if hasUpstream || remoteBranch != "untracked" {
		t.Fatalf("resolveUpstreamRemoteBranch(origin, untracked) = (%q, %v), want (\"untracked\", false)",
			remoteBranch, hasUpstream)
	}

	// An upstream configured for a DIFFERENT remote than the one asked about is not a match either
	// -- same fallback, not a cross-remote guess.
	if remoteBranch, hasUpstream, err := entry.resolveUpstreamRemoteBranch(ctx, "upstream", "feat"); err != nil {
		t.Fatalf("resolveUpstreamRemoteBranch(upstream, feat): %v", err)
	} else if hasUpstream || remoteBranch != "feat" {
		t.Fatalf("resolveUpstreamRemoteBranch(upstream, feat) = (%q, %v), want (\"feat\", false) -- "+
			"feat's upstream is on origin, not upstream", remoteBranch, hasUpstream)
	}
}

// TestPushPreflight_DifferentlyNamedUpstreamIsNotWouldSetUpstream is G32 round-3
// functional-correctness review finding #3's own regression proof: before the fix, PushPreflight
// checked refs/remotes/<remote>/<localBranchName> for existence regardless of the branch's real
// configured upstream, so a branch already tracking a differently-named remote branch was reported
// as "would set upstream" (and pushed to a brand-new same-named remote branch, silently rebinding
// the branch's tracking config) purely because no same-named ref happened to exist yet.
func TestPushPreflight_DifferentlyNamedUpstreamIsNotWouldSetUpstream(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "branch", "feat")
	runGitStack(t, dir, "remote", "add", "origin", t.TempDir())
	// feat tracks origin/main -- a differently-named upstream. Simulate it having already been
	// fetched once (what a real tracking branch looks like) without needing a reachable remote:
	// point the remote-tracking ref at feat's own current tip, so ahead/behind reads as 0/0.
	headSha := runGitStackOutput(t, dir, "rev-parse", "feat")
	runGitStack(t, dir, "update-ref", "refs/remotes/origin/main", headSha)
	runGitStack(t, dir, "config", "branch.feat.remote", "origin")
	runGitStack(t, dir, "config", "branch.feat.merge", "refs/heads/main")

	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	got, err := entry.PushPreflight(context.Background(), "origin", "feat")
	if err != nil {
		t.Fatalf("PushPreflight: %v", err)
	}
	if got.WouldSetUpstream {
		t.Fatal("feat already tracks origin/main -- must not report wouldSetUpstream")
	}
	if got.Upstream == nil || *got.Upstream != "refs/remotes/origin/main" {
		t.Fatalf("Upstream = %v, want refs/remotes/origin/main", got.Upstream)
	}
	if got.Ahead != 0 || got.Behind != 0 {
		t.Fatalf("Ahead/Behind = %d/%d, want 0/0 (feat's tip matches its resolved upstream)", got.Ahead, got.Behind)
	}
}

// TestRunRemote_ForcePush_ProtectedGateChecksUpstreamName is P108 Part 15 F1's own regression
// proof, a security-relevant force-push bypass (flagged for Part 16's future reviewer — this file
// is Part 16's, not yet reviewed, but the bug and its fix both sit at this exact boundary). Before
// the fix, RunRemote's protected-branch gate matched/confirmed against params.Branch, the LOCAL
// branch name — but a force-push actually lands on resolveUpstreamRemoteBranch's result, which can
// differ. A local "feat" tracking a protected "origin/main" upstream slipped past the gate
// entirely: MatchProtectedBranch never saw "main", so any (or no) confirmation matched by omission.
func TestRunRemote_ForcePush_ProtectedGateChecksUpstreamName(t *testing.T) {
	t.Parallel()
	skipWithoutGitStack(t)

	remoteDir := t.TempDir()
	runGitStack(t, remoteDir, "init", "-q", "--bare", "-b", "main")

	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "remote", "add", "origin", remoteDir)
	runGitStack(t, dir, "push", "-q", "origin", "main")
	runGitStack(t, dir, "fetch", "-q", "origin")
	// feat tracks origin/main -- a differently-named upstream, "main" is the protected pattern.
	runGitStack(t, dir, "branch", "feat")
	runGitStack(t, dir, "config", "branch.feat.remote", "origin")
	runGitStack(t, dir, "config", "branch.feat.merge", "refs/heads/main")
	mainSha := runGitStackOutput(t, dir, "rev-parse", "refs/remotes/origin/main")

	registry := NewRegistry(gitclient.NewExecRunner())
	registry.Settings = func() ([]string, int, string) { return []string{"main"}, 0, "" }
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("f1-test-conn"), "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	t.Cleanup(conn.Close)
	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}
	ctx := context.Background()

	// Typing the LOCAL branch name ("feat") must NOT clear the gate -- "main" is what's actually
	// protected and what this force-push actually targets on the remote.
	result, err := entry.RunRemote(ctx, conn, RemoteOpParams{
		Kind: "forcePush", Remote: "origin", Branch: "feat", ConfirmToken: "feat",
		ExpectedRemoteTip: &mainSha,
	}, RemoteDeps{})
	if err != nil {
		t.Fatalf("RunRemote(forcePush, confirm=feat): %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "ProtectedBranch" {
		t.Fatalf("RunRemote(forcePush, confirm=feat) = %+v, want a blocked ProtectedBranch result -- "+
			"feat's upstream is origin/main, a protected branch, regardless of feat's own local name", result)
	}

	// Typing the UPSTREAM's real name ("main") clears the gate -- the push may still fail or
	// succeed past this point, but never on ProtectedBranch again.
	result, err = entry.RunRemote(ctx, conn, RemoteOpParams{
		Kind: "forcePush", Remote: "origin", Branch: "feat", ConfirmToken: "main",
		ExpectedRemoteTip: &mainSha,
	}, RemoteDeps{})
	if err != nil {
		t.Fatalf("RunRemote(forcePush, confirm=main): %v", err)
	}
	if result.Error != nil && result.Error.Kind == "ProtectedBranch" {
		t.Fatalf("RunRemote(forcePush, confirm=main) = %+v, want the gate cleared once the real upstream name is typed", result)
	}
}

// TestPushPreflight_ProtectedByChecksUpstreamName is P108 Part 15 F1's own second regression proof:
// PushPreflight's ClassifyPushInput.Branch had the identical local-vs-upstream bug — a differently
// named upstream's protection never surfaced in the preflight's own protectedBy field.
func TestPushPreflight_ProtectedByChecksUpstreamName(t *testing.T) {
	t.Parallel()
	skipWithoutGitStack(t)
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "branch", "feat")
	runGitStack(t, dir, "remote", "add", "origin", t.TempDir())
	headSha := runGitStackOutput(t, dir, "rev-parse", "feat")
	runGitStack(t, dir, "update-ref", "refs/remotes/origin/main", headSha)
	runGitStack(t, dir, "config", "branch.feat.remote", "origin")
	runGitStack(t, dir, "config", "branch.feat.merge", "refs/heads/main")

	registry := NewRegistry(gitclient.NewExecRunner())
	registry.Settings = func() ([]string, int, string) { return []string{"main"}, 0, "" }
	t.Cleanup(registry.Close)
	conn := NewConn(ConnID("f1-preflight-conn"), "test-client", "test-client-label", nil)
	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	t.Cleanup(conn.Close)
	entry, ok := conn.Entry(summary.RepoID)
	if !ok {
		t.Fatal("conn.Entry: not held after Open")
	}

	got, err := entry.PushPreflight(context.Background(), "origin", "feat")
	if err != nil {
		t.Fatalf("PushPreflight: %v", err)
	}
	if got.ProtectedBy == nil || *got.ProtectedBy != "main" {
		t.Fatalf("ProtectedBy = %v, want \"main\" -- feat's real upstream (origin/main) is protected, "+
			"regardless of feat's own local name", got.ProtectedBy)
	}
}

// TestPushPreflight_ResolvedBranchIsUpstreamName is F2's own regression proof (P108 Part 16
// review): ForcePushDialog.vue can only ever gate on and display the LOCAL branch name unless the
// wire response also carries the resolved UPSTREAM one -- a local "feat" tracking a differently
// named "main" must report ResolvedBranch "main", not "feat", or the dialog's own confirm gate
// can never be satisfied against a backend that (correctly, since Part 15's F1) checks the
// upstream name.
func TestPushPreflight_ResolvedBranchIsUpstreamName(t *testing.T) {
	t.Parallel()
	skipWithoutGitStack(t)
	dir := t.TempDir()
	runGitStack(t, dir, "init", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "x\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "branch", "feat")
	runGitStack(t, dir, "remote", "add", "origin", t.TempDir())
	headSha := runGitStackOutput(t, dir, "rev-parse", "feat")
	runGitStack(t, dir, "update-ref", "refs/remotes/origin/main", headSha)
	runGitStack(t, dir, "config", "branch.feat.remote", "origin")
	runGitStack(t, dir, "config", "branch.feat.merge", "refs/heads/main")

	entry := newStackTestEntryWithRunner(t, gitclient.NewExecRunner(), dir)
	got, err := entry.PushPreflight(context.Background(), "origin", "feat")
	if err != nil {
		t.Fatalf("PushPreflight: %v", err)
	}
	if got.ResolvedBranch != "main" {
		t.Fatalf("ResolvedBranch = %q, want \"main\" -- feat's real upstream, not its own local name", got.ResolvedBranch)
	}
}

func runGitStackOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return strings.TrimSpace(string(out))
}

// TestRunRemote_Pull_ClearsUndoSlot is G32 round-3 functional-correctness review finding #2's own
// regression proof: a reset (or any other Undoable RunOp kind)'s undo record is an absolute ref
// write that assumes nothing has moved the branch since it was captured. RunRemote never touched
// the undo slot at all before this fix, so a pull landing after such an op left a stale record in
// place — clicking Undo would silently move the branch back past whatever the pull just brought in.
func TestRunRemote_Pull_ClearsUndoSlot(t *testing.T) {
	t.Parallel()
	remoteDir := t.TempDir()
	runGitStack(t, remoteDir, "init", "-q", "--bare", "-b", "main")

	dir := t.TempDir()
	runGitStack(t, dir, "clone", "-q", remoteDir, ".")
	runGitStack(t, dir, "checkout", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "push", "-q", "-u", "origin", "main")

	// A second clone pushes a new commit to the remote -- what runPullOp is about to fetch.
	otherDir := t.TempDir()
	runGitStack(t, otherDir, "clone", "-q", remoteDir, ".")
	writeFileStack(t, otherDir, "g.txt", "line1\n")
	runGitStack(t, otherDir, "add", "g.txt")
	runGitStack(t, otherDir, "commit", "-q", "-m", "c2")
	runGitStack(t, otherDir, "push", "-q", "origin", "main")

	runGitStack(t, dir, "checkout", "-q", "-b", "feat")
	conn, entry := newStackTestConnAndEntry(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	// Populate the undo slot with an unrelated Undoable op (stackSet is cheap: no working-tree
	// mutation needed) -- stands in for "any local write happened before the user then pulls."
	setResult, err := entry.RunOp(ctx, conn.ID, "test", OpRequest{Kind: "stackSet", Branch: "feat", Parent: strPtr("main")})
	if err != nil || !setResult.OK || setResult.Undo == nil {
		t.Fatalf("RunOp(stackSet) = %+v, %v, want an ok result with an undo record", setResult, err)
	}
	// Pull requires the pulled branch to be the one actually checked out (FUNC1/G30 finding #2's
	// own fresh HEAD re-check) -- back to main for that.
	runGitStack(t, dir, "checkout", "-q", "main")
	if entry.undo.Peek() == nil {
		t.Fatal("undo slot must be populated before the pull this test is actually about")
	}

	result, err := entry.RunRemote(ctx, conn, RemoteOpParams{
		Kind: "pull", Remote: "origin", Branch: "main", Strategy: "ff",
	}, RemoteDeps{})
	if err != nil {
		t.Fatalf("RunRemote(pull): %v", err)
	}
	if !result.OK {
		t.Fatalf("pull result = %+v, want ok", result)
	}
	if entry.undo.Peek() != nil {
		t.Fatal("pull must clear the undo slot -- its stale reset/etc. record is no longer safe to replay")
	}
}

// TestRunRemote_Pull_BranchChangedIsDetectedInsideTheWrite is F5's own regression proof (P108 Part
// 16 review): the "is the pulled branch still checked out" re-check now runs fresh, INSIDE
// Repo.Write, immediately before the merge/rebase spawns -- not before Repo.Write is even
// acquired. Confirms the refactor still catches "the checked-out branch changed" and reports
// BranchChanged rather than silently merging into whatever is checked out now.
func TestRunRemote_Pull_BranchChangedIsDetectedInsideTheWrite(t *testing.T) {
	t.Parallel()
	skipWithoutGitStack(t)
	remoteDir := t.TempDir()
	runGitStack(t, remoteDir, "init", "-q", "--bare", "-b", "main")

	dir := t.TempDir()
	runGitStack(t, dir, "clone", "-q", remoteDir, ".")
	runGitStack(t, dir, "checkout", "-q", "-b", "main")
	writeFileStack(t, dir, "f.txt", "line1\n")
	runGitStack(t, dir, "add", "f.txt")
	runGitStack(t, dir, "commit", "-q", "-m", "c1")
	runGitStack(t, dir, "push", "-q", "-u", "origin", "main")

	// feat is checked out, not main -- what runPullOp is about to be asked to pull.
	runGitStack(t, dir, "checkout", "-q", "-b", "feat")

	conn, entry := newStackTestConnAndEntry(t, gitclient.NewExecRunner(), dir)
	ctx := context.Background()

	result, err := entry.RunRemote(ctx, conn, RemoteOpParams{
		Kind: "pull", Remote: "origin", Branch: "main", Strategy: "ff",
	}, RemoteDeps{})
	if err != nil {
		t.Fatalf("RunRemote(pull): %v", err)
	}
	if result.OK || result.Error == nil || result.Error.Kind != "BranchChanged" {
		t.Fatalf("pull result = %+v, want a blocked BranchChanged result -- feat is checked out, not main", result)
	}
}
