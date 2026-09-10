// G26's own session-level orchestration: reads (stackConfig/Stacks/RestackPreflight, this file's
// first half) and, once the write side lands, the dedicated stack.restack executor (D6) modelled on
// remote.go's RunRemote. Every spawn here follows the same discipline the rest of this package
// already uses: a display-only read (Stacks) may use the entry's own caches, but anything that
// PRECEDES A WRITE (RestackPreflight, RunRestack itself) always re-reads config and refs fresh
// (D10/F16's own rule, restated here rather than merely inherited).
package gitsession

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// ---------------------------------------------------------------------------------------
// stack.list (D3)
// ---------------------------------------------------------------------------------------

// rawStackConfig spawns D1's own read argv and parses it — exit 1 (no match) is the common case
// for a repository with no stacked branches at all, and costs nothing beyond this one spawn (D3's
// own stated cost model).
func (e *RepoEntry) rawStackConfig(ctx context.Context) (map[string]gitpreflight.StackConfigEntry, error) {
	res, err := e.runAllowingExit(ctx, gitops.StackConfigReadArgs(), 0, 1)
	if err != nil {
		return nil, err
	}
	if res.ExitCode != 0 {
		return map[string]gitpreflight.StackConfigEntry{}, nil
	}
	return gitpreflight.ParseStackConfig(res.Stdout), nil
}

// stackedCandidates returns the local branches with a non-empty recorded parent, sorted by name —
// deterministic spawn order, and the same list BuildStacks itself iterates in (matching cache
// content to what a fresh rebuild would produce).
func stackedCandidates(config map[string]gitpreflight.StackConfigEntry, localNames map[string]bool) []string {
	out := []string{}
	for name := range localNames {
		if entry, ok := config[name]; ok && entry.Parent != "" {
			out = append(out, name)
		}
	}
	sort.Strings(out)
	return out
}

// buildStacksFromSnapshot is Stacks/RestackPreflight's own shared assembly step: given a stack
// config and a refs snapshot (either the cached one for a display read, or a freshly re-read one
// for a preflight), spawn exactly one `rev-list --left-right --count` per candidate stacked branch
// (bounded by gitpreflight.MaxStackedBranches, D3), then hand everything to the pure BuildStacks.
func (e *RepoEntry) buildStacksFromSnapshot(ctx context.Context, config map[string]gitpreflight.StackConfigEntry, snapshot RefsResult) (gitpreflight.StackListResult, error) {
	if len(config) == 0 {
		return gitpreflight.StackListResult{Stacks: []gitpreflight.StackSummary{}, Orphans: []gitpreflight.StackBranch{}}, nil
	}

	localRefs := map[string]gitpreflight.StackRefInfo{}
	localNames := map[string]bool{}
	baseTips := map[string]string{}
	for _, r := range snapshot.Branches {
		localRefs[r.ShortName] = gitpreflight.StackRefInfo{
			Tip: r.ObjectID, CheckedOutIn: r.CheckedOutIn, Track: r.Track, IsHead: r.IsHead,
			HasUpstream: r.Upstream != nil,
		}
		localNames[r.ShortName] = true
		baseTips[r.ShortName] = r.ObjectID
	}
	for _, r := range snapshot.RemoteBranches {
		baseTips[r.ShortName] = r.ObjectID
	}

	candidates := stackedCandidates(config, localNames)
	if len(candidates) > gitpreflight.MaxStackedBranches {
		candidates = candidates[:gitpreflight.MaxStackedBranches]
	}

	// G31 round-2 performance review, finding #6: up to gitpreflight.MaxStackedBranches (64)
	// `rev-list --left-right --count` processes used to spawn strictly serially, one full pipe
	// round trip awaited before the next began — after every ref movement and every local write
	// (the cache this feeds is dropped by both, entry.go), a stack-using repo paid up to 64
	// sequential spawns. RangeFiles (incremental.go) already establishes the concurrent shape for
	// exactly this situation — a small, fixed set of independent spawns under one sync.WaitGroup —
	// generalized here to N candidates (D3 already bounds N at 64, so no separate concurrency cap
	// is needed on top of it). Each candidate writes only its own slot, so no lock is needed around
	// behindAhead's own build below — that map is populated single-threaded, after Wait.
	type stackDiffSlot struct {
		name          string
		behind, ahead int
		err           error
	}
	slots := make([]stackDiffSlot, len(candidates))
	var wg sync.WaitGroup
	for i, name := range candidates {
		parent := config[name].Parent
		parentTip, ok := baseTips[parent]
		if !ok {
			continue // an unresolvable parent is an orphan; nothing to diff against.
		}
		childTip, ok := localRefs[name]
		if !ok {
			continue
		}
		wg.Add(1)
		go func(i int, name, parentTip, childTip string) {
			defer wg.Done()
			raw, err := e.runOne(ctx, porcelain.LeftRightCountArgs(parentTip, childTip))
			if err != nil {
				slots[i] = stackDiffSlot{err: err}
				return
			}
			behind, ahead, perr := porcelain.ParseLeftRightCount(raw)
			if perr != nil {
				slots[i] = stackDiffSlot{err: perr}
				return
			}
			slots[i] = stackDiffSlot{name: name, behind: behind, ahead: ahead}
		}(i, name, parentTip, childTip.Tip)
	}
	wg.Wait()

	behindAhead := map[string]gitpreflight.LeftRightCount{}
	for _, slot := range slots {
		if slot.err != nil {
			return gitpreflight.StackListResult{}, slot.err
		}
		if slot.name == "" {
			continue // this candidate's own parent/child lookup missed above; nothing to record.
		}
		behindAhead[slot.name] = gitpreflight.LeftRightCount{Behind: slot.behind, Ahead: slot.ahead}
	}

	return gitpreflight.BuildStacks(gitpreflight.BuildStacksInput{
		Config: config, LocalRefs: localRefs, BaseTips: baseTips, BehindAhead: behindAhead,
	}), nil
}

// Stacks is stack.list's own query (D3): cache-reading (this entry's stack cache, dropped on
// refsChanged and invalidateAfterWrite exactly like refs/detail, D16), using the entry's own
// (also-cached) ref snapshot — a display read, never the fresh-read discipline a preflight needs.
func (e *RepoEntry) Stacks(ctx context.Context) (gitpreflight.StackListResult, error) {
	if cached, ok := e.stack.get(); ok {
		return cached, nil
	}
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return gitpreflight.StackListResult{}, err
	}
	snapshot, err := e.Refs(ctx)
	if err != nil {
		return gitpreflight.StackListResult{}, err
	}
	result, err := e.buildStacksFromSnapshot(ctx, config, snapshot)
	if err != nil {
		return gitpreflight.StackListResult{}, err
	}
	e.stack.set(result)
	return result, nil
}

// ---------------------------------------------------------------------------------------
// preflight.restack (D14)
// ---------------------------------------------------------------------------------------

// commitResolves answers "does sha still name a real commit" through the entry's own cat-file batch
// session — the same existence check UndoRun already uses for a RecoverySha, reused here for D14/F4's
// own "recordedBase, when it still resolves" rule. false (never an error) for an empty sha, a torn-
// down entry, or anything catfile.ErrMissing reports.
func (e *RepoEntry) commitResolves(sha string) (bool, error) {
	if sha == "" {
		return false, nil
	}
	session := e.CatFile()
	if session == nil {
		return false, ErrRepoTornDown
	}
	if _, err := session.Check(sha + "^{commit}"); err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// resolveBranchBase is D14/F4's own per-branch base resolution: the recorded base when it still
// resolves as a commit (the correct value after a parent amend/rebase, F4/probe P6), the merge-base
// fallback otherwise (gitops.MergeBaseArgs, D10) — an honest degrade for a branch that joined a
// stack before this phase, or whose recorded base has since been gc'd.
func (e *RepoEntry) resolveBranchBase(ctx context.Context, parent, branch, recordedBase string) (gitpreflight.RestackBaseInfo, error) {
	if recordedBase != "" {
		ok, err := e.commitResolves(recordedBase)
		if err != nil {
			return gitpreflight.RestackBaseInfo{}, err
		}
		if ok {
			return gitpreflight.RestackBaseInfo{Base: recordedBase, Source: "recorded"}, nil
		}
	}
	res, err := e.runAllowingExit(ctx, gitops.MergeBaseArgs(parent, branch), 0, 1)
	if err != nil {
		return gitpreflight.RestackBaseInfo{}, err
	}
	base := ""
	if res.ExitCode == 0 {
		base = strings.TrimSpace(string(res.Stdout))
	}
	return gitpreflight.RestackBaseInfo{Base: base, Source: "mergeBase"}, nil
}

// RestackPreflight is preflight.restack's own orchestration (D14): every read here is FRESH — never
// this entry's caches — because this decision precedes a write, the same discipline
// WorktreeAddPreflight/prepareCheckout already follow via refsSnapshot rather than Refs.
func (e *RepoEntry) RestackPreflight(ctx context.Context, branch string) (gitpreflight.RestackPreflight, error) {
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return gitpreflight.RestackPreflight{}, err
	}
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return gitpreflight.RestackPreflight{}, err
	}
	stacksResult, err := e.buildStacksFromSnapshot(ctx, config, snapshot)
	if err != nil {
		return gitpreflight.RestackPreflight{}, err
	}

	statusResult, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return gitpreflight.RestackPreflight{}, err
	}
	dirtyPaths := dirtyPathStrings(statusResult)

	head, err := e.Head(ctx)
	if err != nil {
		return gitpreflight.RestackPreflight{}, err
	}
	headRef := gitpreflight.HeadRef{Sha: head.SHA}
	if head.Kind == "branch" {
		headRef.Branch = head.Name
	}

	branchBases := map[string]gitpreflight.RestackBaseInfo{}
	checkedOutElsewhere := map[string]string{}
	hasUpstream := map[string]bool{}
	for _, stack := range stacksResult.Stacks {
		inThisStack := false
		for _, b := range stack.Branches {
			if b.Name == branch {
				inThisStack = true
				break
			}
		}
		if !inThisStack {
			continue
		}
		for _, b := range stack.Branches {
			recorded := ""
			if b.RecordedBase != nil {
				recorded = *b.RecordedBase
			}
			baseInfo, berr := e.resolveBranchBase(ctx, b.Parent, b.Name, recorded)
			if berr != nil {
				return gitpreflight.RestackPreflight{}, berr
			}
			branchBases[b.Name] = baseInfo
			if b.CheckedOutIn != nil {
				checkedOutElsewhere[b.Name] = *b.CheckedOutIn
			}
			hasUpstream[b.Name] = b.Track != nil
		}
		break
	}

	return gitpreflight.ClassifyRestack(gitpreflight.ClassifyRestackInput{
		Target: branch, Stacks: stacksResult.Stacks, Orphans: stacksResult.Orphans, Config: config,
		InProgress: inProgress, CurrentHead: headRef, DirtyPaths: dirtyPaths,
		CheckedOutElsewhere: checkedOutElsewhere, BranchBases: branchBases, HasUpstream: hasUpstream,
	}), nil
}

// stackChildrenOf returns the sorted list of branch names whose recorded parent (in config) is
// exactly name — G26 §10.9/D-3.12's own "who points at the branch about to be renamed/deleted"
// query, shared by prepareBranchRename's fix-up, prepareBranchDelete's re-parent step, and
// captureBranchDeleteUndo's own widened capture.
func stackChildrenOf(config map[string]gitpreflight.StackConfigEntry, name string) []string {
	out := []string{}
	for branch, entry := range config {
		if entry.Parent == name {
			out = append(out, branch)
		}
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------------------
// opTable's stackSet kind (D10)
// ---------------------------------------------------------------------------------------

// isLocalBranch answers "does name match a local branch in snapshot" — D10 step 2's own "branch
// must be an existing LOCAL branch" check (a remote-tracking branch or a tag is never itself
// something stackSet can operate ON, only something a parent can point AT).
func isLocalBranch(snapshot RefsResult, name string) bool {
	for _, r := range snapshot.Branches {
		if r.ShortName == name {
			return true
		}
	}
	return false
}

// resolvesAsRef answers "does name match a local branch or a remote-tracking branch in snapshot" —
// D10 step 3's own "parent, when set, must resolve as a local branch or a remote-tracking branch"
// check, and D1's own "the parent may name a local branch OR a remote-tracking branch" rule.
func resolvesAsRef(snapshot RefsResult, name string) bool {
	if isLocalBranch(snapshot, name) {
		return true
	}
	for _, r := range snapshot.RemoteBranches {
		if r.ShortName == name {
			return true
		}
	}
	return false
}

// ancestorChainFrom walks parent pointers up from start using the CURRENT (pre-write) config table
// — D10 step 4's own cycle check: "walk parent pointers up from parent; reaching branch ⇒
// StackCycle". Bounded by gitpreflight.MaxStackedBranches iterations (F3's own stated defence: a
// pre-existing cycle elsewhere in a hand-edited config cannot spin this walk either).
func ancestorChainFrom(config map[string]gitpreflight.StackConfigEntry, start string) []string {
	chain := []string{start}
	seen := map[string]bool{start: true}
	current := start
	for i := 0; i < gitpreflight.MaxStackedBranches; i++ {
		entry, ok := config[current]
		if !ok || entry.Parent == "" {
			return chain
		}
		if seen[entry.Parent] {
			return chain // an unrelated pre-existing cycle — not this check's concern.
		}
		seen[entry.Parent] = true
		chain = append(chain, entry.Parent)
		current = entry.Parent
	}
	return chain
}

// prepareStackSet is stackSet's own opSpec.Prepare (D10), in the plan's own exact order: fresh
// refs+config (never the caches — the same rule prepareCheckout's refsSnapshot already follows),
// branch/parent existence, the cycle check, the join-time merge-base, undo capture, then exactly
// two `git config --local` writes, always exit 0 (D2).
func prepareStackSet(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return prepared{}, err
	}
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return prepared{}, err
	}

	branch := op.Branch
	if !isLocalBranch(snapshot, branch) {
		return prepared{earlyError: &OpError{Kind: "NotFound", Message: fmt.Sprintf("%q is not a local branch.", branch)}}, nil
	}

	parent := ""
	if op.Parent != nil {
		parent = strings.TrimSpace(*op.Parent)
	}

	if parent != "" {
		if !resolvesAsRef(snapshot, parent) {
			return prepared{earlyError: &OpError{Kind: "NotFound", Message: fmt.Sprintf("%q does not resolve to a branch.", parent)}}, nil
		}
		if parent == branch {
			return prepared{earlyError: &OpError{Kind: "StackCycle", Message: "a branch cannot be its own stack parent."}}, nil
		}
		chain := ancestorChainFrom(config, parent)
		for _, name := range chain {
			if name == branch {
				return prepared{earlyError: &OpError{
					Kind:    "StackCycle",
					Message: fmt.Sprintf("setting %q's parent to %q would make %q its own ancestor.", branch, parent, branch),
				}}, nil
			}
		}
	}

	newBase := ""
	if parent != "" {
		res, merr := e.runAllowingExit(ctx, gitops.MergeBaseArgs(parent, branch), 0, 1)
		if merr != nil {
			return prepared{}, merr
		}
		if res.ExitCode == 0 {
			newBase = strings.TrimSpace(string(res.Stdout))
		}
	}

	undo := e.captureStackSetUndo(ctx, conn, connLabel, branch, parent, config, snapshot)

	return prepared{
		argvList: [][]string{
			gitops.StackConfigSetArgs(gitops.StackParentKey(branch), parent),
			gitops.StackConfigSetArgs(gitops.StackBaseKey(branch), newBase),
		},
		undo: undo,
	}, nil
}

// captureStackSetUndo is undo-capture for stackSet (D10): the branch's OWN CURRENT parent/base raw
// config values (possibly both "", meaning it was not stacked before this write, D2), replayed back
// as the same two argv writes on undo — always exit 0, symmetric with the write itself. RecoverySha
// is the branch's own tip (D10: "so UndoRun's existing cat-file existence check has something real
// to validate") — a stackSet never moves any ref, so the tip before and after is identical, but the
// check still guards against the branch itself having been deleted in the meantime.
func (e *RepoEntry) captureStackSetUndo(ctx context.Context, conn ConnID, connLabel, branch, newParent string, config map[string]gitpreflight.StackConfigEntry, snapshot RefsResult) *gitpreflight.UndoRecord {
	tip := ""
	for _, r := range snapshot.Branches {
		if r.ShortName == branch {
			tip = r.ObjectID
			break
		}
	}
	if tip == "" {
		return nil
	}

	oldEntry := config[branch]
	label := fmt.Sprintf("Removed %s from its stack", branch)
	if newParent != "" {
		label = fmt.Sprintf("Set %s's stack parent to %s", branch, newParent)
	}

	return &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: label, RecoverySha: tip, CreatedAt: time.Now().UnixMilli(),
		Replay: [][]string{
			gitops.StackConfigSetArgs(gitops.StackParentKey(branch), oldEntry.Parent),
			gitops.StackConfigSetArgs(gitops.StackBaseKey(branch), oldEntry.Base),
		},
		OriginConn: string(conn), OriginLabel: connLabel,
	}
}

// dirtyPathStrings flattens gitpreflight.DirtyPaths' own []DirtyPath into the plain path list
// RestackBlocker.dirtyWorktree carries (D14) — the mode/kind split that list also has is not
// meaningful here: any dirt at all blocks any restack, since every rebase checks out its branch.
func dirtyPathStrings(status porcelain.StatusResult) []string {
	dirty := gitpreflight.DirtyPaths(status)
	out := make([]string, len(dirty))
	for i, d := range dirty {
		out[i] = d.Path
	}
	return out
}

// ---------------------------------------------------------------------------------------
// stack.restack (D6/D8/D9/D11) — its own executor, modelled on remote.go's RunRemote, NOT an
// opTable kind (F7: recording each child's new base needs the parent's post-rebase tip, which no
// static argv list can express).
// ---------------------------------------------------------------------------------------

// RestackResult mirrors @kira/git-ipc's own stack.restack result shape (D17).
type RestackResult struct {
	OK        bool     `json:"ok"`
	Error     *OpError `json:"error,omitempty"`
	Restacked []string `json:"restacked"`
	// StoppedAt: the branch a conflict (or a failed base write) paused the restack at — nil on a
	// full success, a full no-write refusal, or a cancellation (which stops BETWEEN branches, never
	// mid-rebase, D9).
	StoppedAt  *string                           `json:"stoppedAt,omitempty"`
	Remaining  []string                          `json:"remaining"`
	Undo       *gitpreflight.UndoSlotSnapshot    `json:"undo"`
	Head       gitclient.HeadState               `json:"head"`
	InProgress *gitpreflight.InProgressOperation `json:"inProgress"`
}

// RestackProgress mirrors @kira/git-ipc's own stack.progress event payload (D17) — emitted BEFORE
// each branch's own rebase spawn (D6 step 4).
type RestackProgress struct {
	RepoID string `json:"repoId"`
	Branch string `json:"branch"`
	Index  int    `json:"index"` // 1-based
	Total  int    `json:"total"`
}

// restackSlot is the ≤1-per-repository box (D6/D9) — the same shape prepareOpSlot (worktree.go)
// uses: a restack is ALWAYS cancellable, never needing remoteOpSlot's own killable toggle, because
// there is no phase of a restack whose outcome is unknowable the way a half-delivered push is (D9).
type restackSlot struct {
	mu     sync.Mutex
	active bool
	cancel context.CancelFunc
}

func (s *restackSlot) claim(cancel context.CancelFunc) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return false
	}
	s.active = true
	s.cancel = cancel
	return true
}

func (s *restackSlot) release() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active, s.cancel = false, nil
}

func (s *restackSlot) tryCancel() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.active {
		return false
	}
	s.cancel()
	return true
}

func (s *restackSlot) forceCancel() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
}

// CancelRestack is stack.cancelRestack's own executor (D9) — false, never an error, when nothing
// is running (a cancel racing a just-finished restack is ordinary, not a fault). No palette command
// serves this directly (D13: cancel is a button on the surface that started the work, matching
// worktree.cancelPrepare's own precedent).
func (e *RepoEntry) CancelRestack() bool {
	return e.restack.tryCancel()
}

// restackResultNoSpawn answers a call that never reaches a write at all — a refused already-running
// claim, a blocked preflight, or a genuine no-op (opErr nil) — still reading back head/in-progress
// (G5's own rule, applied again: always, success or failure), and touching NEITHER e.undo nor
// e.stack: nothing happened, so whatever was already true of the repository (including any pending
// undo) is still exactly as true as before this call (RunRemote's own no-spawn convention, not
// RunOp's — RunOp's own kinds always supersede a prior undo even on an early error; a restack that
// never wrote anything has no more claim to do that than a refused fetch does).
func (e *RepoEntry) restackResultNoSpawn(ctx context.Context, opErr *OpError) (RestackResult, error) {
	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return RestackResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return RestackResult{}, herr
	}
	return RestackResult{
		OK: opErr == nil, Error: opErr, Restacked: []string{}, Remaining: []string{},
		Head: head, InProgress: inProgress,
	}, nil
}

// restackBlockedError maps RestackPreflight's own six blocker kinds (D14) onto EXISTING OpErrorKind
// values, except cycle, which is this phase's own StackCycle (D5: rebase itself adds zero new
// kinds; this blocker never reaches a rebase spawn at all, so it costs nothing against that count).
// A defensive server-side re-check: the dialog's own Restack button is disabled by the SAME
// preflight before this is ever reachable in ordinary use (the same convention
// worktreeAddBlockedError/worktreeRemoveBlockedError already established).
func restackBlockedError(pf gitpreflight.RestackPreflight) *OpError {
	if len(pf.Blockers) == 0 {
		return &OpError{Kind: "Unknown", Message: "This stack cannot be restacked."}
	}
	b := pf.Blockers[0]
	switch b.Kind {
	case "inProgressOperation":
		return &OpError{Kind: "OperationInProgress", Message: gitpreflight.DescribeInProgress(b.Operation) + " is in progress — finish or abort it before restacking."}
	case "notStacked":
		return &OpError{Kind: "Unknown", Message: fmt.Sprintf("%q is not part of a stack.", b.Branch)}
	case "cycle":
		return &OpError{Kind: "StackCycle", Message: fmt.Sprintf("this stack has a cycle: %s.", strings.Join(b.Branches, " -> "))}
	case "parentMissing":
		return &OpError{Kind: "NotFound", Message: fmt.Sprintf("%q's recorded parent %q no longer exists.", b.Branch, b.Parent)}
	case "checkedOutElsewhere":
		return &OpError{Kind: "WorktreeConflict", Message: fmt.Sprintf("%q is checked out at %s.", b.Branch, b.WorktreePath)}
	default: // dirtyWorktree
		return &OpError{Kind: "DirtyWorktree", Message: "Commit, stash, or discard your changes before restacking."}
	}
}

// restackPlannedState is one planned branch's pre-restack snapshot — captured before any write, so
// the undo record (D11) can name exactly what to put back.
type restackPlannedState struct {
	name    string
	oldTip  string
	oldBase string
}

// buildRestackUndo is D11's own undo record, built EXACTLY as specified: Replay is
// switch -> update-ref(s) -> config(s) -> reset --keep, in that order — never built when the
// checked-out branch was not itself in the plan skips the switch/reset--keep pair entirely (there
// is nothing to restore about HEAD's position in that case: the branch it sat on was never
// rewritten).
func buildRestackUndo(conn ConnID, connLabel, base string, origBranch, origHeadSha string, planned []restackPlannedState) *gitpreflight.UndoRecord {
	origInPlan := false
	var origOldTip string
	for _, p := range planned {
		if p.name == origBranch {
			origInPlan = true
			origOldTip = p.oldTip
		}
	}

	replay := [][]string{}
	if origBranch != "" && origInPlan {
		replay = append(replay, gitops.SwitchArgs(origBranch, false))
	}
	for _, p := range planned {
		if p.name == origBranch {
			continue
		}
		replay = append(replay, []string{"update-ref", "refs/heads/" + p.name, p.oldTip})
	}
	for _, p := range planned {
		replay = append(replay, gitops.StackConfigSetArgs(gitops.StackBaseKey(p.name), p.oldBase))
	}
	if origBranch != "" && origInPlan {
		replay = append(replay, []string{"reset", "--keep", origOldTip})
	}

	return &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: fmt.Sprintf("Restacked %d branches onto %s", len(planned), base),
		RecoverySha: origHeadSha, CreatedAt: time.Now().UnixMilli(), Replay: replay,
		OriginConn: string(conn), OriginLabel: connLabel,
	}
}

// runRestackSpawn runs one `rebase --onto` under Repo.Write (D6 step 4): Setsid (G8 D6's reason — a
// rebase can invoke a gpg pinentry or a merge driver) and GIT_SEQUENCE_EDITOR=true as
// belt-and-braces (GIT_EDITOR=true is already in hygieneEnv, and probe M5/P11 both confirm
// `rebase --onto` never invokes the sequence editor anyway, since this is never `-i`).
func (e *RepoEntry) runRestackSpawn(ctx context.Context, argv []string) (gitclient.Result, error) {
	var res gitclient.Result
	err := e.Repo.Write(ctx, func(wctx context.Context) error {
		r, rerr := gitclient.Run(wctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: repoWorkingDir(e.Summary), Args: argv, ReadOnly: false,
			Env: []string{"GIT_SEQUENCE_EDITOR=true"}, Setsid: true,
		})
		res = r
		return rerr
	})
	return res, err
}

// branchNames extracts the plan's own branch names, in order — Restacked/Remaining are always this
// shape, never the full RestackPlanEntry (the wire result only needs the names, D17).
func branchNames(entries []gitpreflight.RestackPlanEntry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.Branch
	}
	return out
}

// RunRestack is stack.restack's own executor (D6), in EXACTLY this order:
//
//  0. ctx is already detached from the request by gitrpc (G5 D8's rule, the same one remote.run
//     follows) — wrapped here in the entry's own WithCancel, which is what CancelRestack and
//     teardown's forceCancel act on.
//  1. Claim the ≤1-per-repository slot; already claimed ⇒ {ok:false, OperationInProgress} with no
//     write.
//  2. Recompute the preflight FRESH (never the client's own copy) — any blocker ⇒ {ok:false, <that
//     blocker's error>} with no write; a genuine noop (nothing to restack) ⇒ {ok:true} with no
//     write and the undo slot left untouched (restackResultNoSpawn's own rule).
//  3. Capture the undo record (D11) BEFORE anything moves, and defer e.invalidateAfterWrite() (D7's
//     rule: drop the shared caches synchronously the moment a write is about to be attempted).
//  4. For each planned branch, in order (bottom-up, D3's own pre-order): emit stack.progress, then
//     `git rebase --onto <parent> <base> <branch>`. A non-zero exit classifies stdout+stderr
//     COMBINED (P10: a rebase conflict's own "CONFLICT (content)" is on stdout, "could not apply" on
//     stderr) and STOPS the loop, recording stoppedAt/remaining — no undo record is set (D8). A
//     clean exit re-resolves the parent's own new tip and writes it as the branch's new recorded
//     base — D6's own "a failure here is a real error, not best-effort" rule: that write's own
//     failure also stops the loop, same as a rebase conflict would.
//  5. Restore HEAD (F5: rebase always moves HEAD, even on a no-op) — only when every branch
//     succeeded.
//  6. Set the undo slot ONLY on a fully successful restack, INCLUDING the head restore (D8/D11);
//     read back head + in-progress, ALWAYS, success or failure.
//  7. Release the slot (deferred) and return.
func (e *RepoEntry) RunRestack(ctx context.Context, conn *Conn, branch string) (RestackResult, error) {
	opCtx, cancel := context.WithCancel(ctx)
	if !e.restack.claim(cancel) {
		cancel()
		return e.restackResultNoSpawn(ctx, &OpError{
			Kind: "OperationInProgress", Message: "another restack is already running on this repository",
		})
	}
	defer func() {
		e.restack.release()
		cancel()
	}()

	pf, err := e.RestackPreflight(ctx, branch)
	if err != nil {
		return RestackResult{}, err
	}
	if pf.Verdict == "blocked" {
		return e.restackResultNoSpawn(ctx, restackBlockedError(pf))
	}
	if len(pf.Plan) == 0 {
		return e.restackResultNoSpawn(ctx, nil) // verdict == "noop": already fully up to date.
	}

	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return RestackResult{}, err
	}
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return RestackResult{}, err
	}
	branchTip := map[string]string{}
	for _, r := range snapshot.Branches {
		branchTip[r.ShortName] = r.ObjectID
	}

	head, err := e.Head(ctx)
	if err != nil {
		return RestackResult{}, err
	}
	origBranch := ""
	origHeadSha := head.SHA
	if head.Kind == "branch" {
		origBranch = head.Name
		origHeadSha = branchTip[origBranch]
	}

	planned := make([]restackPlannedState, len(pf.Plan))
	for i, entry := range pf.Plan {
		planned[i] = restackPlannedState{name: entry.Branch, oldTip: branchTip[entry.Branch], oldBase: config[entry.Branch].Base}
	}
	undo := buildRestackUndo(e.connIDOf(conn), e.connLabelOf(conn), pf.Base, origBranch, origHeadSha, planned)

	defer e.invalidateAfterWrite()

	restacked := []string{}
	for i, entry := range pf.Plan {
		if opCtx.Err() != nil {
			e.undo.Set(nil)
			return e.restackPausedResult(ctx, &OpError{Kind: "Cancelled", Message: "the restack was cancelled"}, restacked, nil, branchNames(pf.Plan[i:]))
		}

		if conn != nil && conn.Emit != nil {
			conn.Emit("stack.progress", RestackProgress{RepoID: e.Summary.RepoID, Branch: entry.Branch, Index: i + 1, Total: len(pf.Plan)})
		}

		res, werr := e.runRestackSpawn(opCtx, gitops.RebaseOntoArgs(entry.Parent, entry.Base, entry.Branch))
		if werr != nil {
			return RestackResult{}, werr
		}
		if opCtx.Err() != nil {
			e.undo.Set(nil)
			return e.restackPausedResult(ctx, &OpError{Kind: "Cancelled", Message: "the restack was cancelled"}, restacked, nil, branchNames(pf.Plan[i:]))
		}
		if res.ExitCode != 0 {
			combined := string(res.Stdout) + "\n" + string(res.Stderr)
			kind, message := gitops.ClassifyOpError(combined, res.ExitCode)
			e.undo.Set(nil)
			stoppedAt := entry.Branch
			return e.restackPausedResult(ctx, &OpError{Kind: kind, Message: message}, restacked, &stoppedAt, branchNames(pf.Plan[i+1:]))
		}

		newParentTip, terr := e.resolveRefTip(ctx, entry.Parent)
		if terr != nil {
			return RestackResult{}, terr
		}
		if oe, werr := e.runWriteArgv(ctx, gitops.StackConfigSetArgs(gitops.StackBaseKey(entry.Branch), newParentTip)); werr != nil {
			return RestackResult{}, werr
		} else if oe != nil {
			e.undo.Set(nil)
			stoppedAt := entry.Branch
			return e.restackPausedResult(ctx, oe, restacked, &stoppedAt, branchNames(pf.Plan[i+1:]))
		}

		restacked = append(restacked, entry.Branch)
	}

	// F5: restore HEAD to where it started — the last rebase always leaves HEAD on that branch.
	var restoreArgv []string
	if origBranch != "" {
		restoreArgv = gitops.SwitchArgs(origBranch, false)
	} else {
		restoreArgv = gitops.SwitchDetachArgs(origHeadSha, false)
	}
	headErr, werr := e.runWriteArgv(ctx, restoreArgv)
	if werr != nil {
		return RestackResult{}, werr
	}

	if headErr != nil {
		e.undo.Set(nil)
		return e.restackPausedResult(ctx, headErr, restacked, nil, []string{})
	}

	e.undo.Set(undo)
	freshHead, herr := e.Head(ctx)
	if herr != nil {
		return RestackResult{}, herr
	}
	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return RestackResult{}, serr
	}
	var undoSnapshot *gitpreflight.UndoSlotSnapshot
	if conn != nil {
		snap := undo.SnapshotFor(string(e.connIDOf(conn)))
		undoSnapshot = &snap
	} else {
		snap := undo.SnapshotFor("")
		undoSnapshot = &snap
	}
	return RestackResult{
		OK: true, Restacked: restacked, Remaining: []string{}, Undo: undoSnapshot,
		Head: freshHead, InProgress: inProgress,
	}, nil
}

// restackPausedResult composes a stopped-or-cancelled RunRestack return: reads back head/
// in-progress ALWAYS (success or failure, G5's own rule), and never sets an undo snapshot (D8: a
// partial restack has none — the caller already cleared the slot before calling this).
func (e *RepoEntry) restackPausedResult(ctx context.Context, opErr *OpError, restacked []string, stoppedAt *string, remaining []string) (RestackResult, error) {
	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return RestackResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return RestackResult{}, herr
	}
	if restacked == nil {
		restacked = []string{}
	}
	if remaining == nil {
		remaining = []string{}
	}
	return RestackResult{
		OK: false, Error: opErr, Restacked: restacked, StoppedAt: stoppedAt, Remaining: remaining,
		Head: head, InProgress: inProgress,
	}, nil
}

// resolveRefTip runs `rev-parse --verify <ref>` — used after each successful per-branch rebase to
// read the parent's OWN new tip (F7: the value only exists after the parent's own rebase already
// ran), which becomes the child's new recorded base.
func (e *RepoEntry) resolveRefTip(ctx context.Context, ref string) (string, error) {
	res, err := e.runAllowingExit(ctx, []string{"rev-parse", "--verify", ref}, 0, 1)
	if err != nil {
		return "", err
	}
	if res.ExitCode != 0 {
		return "", nil
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}

// connIDOf/connLabelOf: RunRestack takes *Conn (matching RunRemote's own signature) rather than
// ConnID+label separately (matching RunOp's), since stack.restack's own gitrpc handler already has
// a *Conn in hand from the same place remote.run's does. A nil conn (an internal/test caller with
// no real connection) attributes to the empty conn — SnapshotFor's own "no origin label" case.
func (e *RepoEntry) connIDOf(conn *Conn) ConnID {
	if conn == nil {
		return ConnID("")
	}
	return conn.ID
}

func (e *RepoEntry) connLabelOf(conn *Conn) string {
	if conn == nil {
		return ""
	}
	return conn.ClientLabel
}
