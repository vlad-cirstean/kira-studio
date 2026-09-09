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
	"sort"
	"strings"

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

	behindAhead := map[string]gitpreflight.LeftRightCount{}
	for _, name := range candidates {
		parent := config[name].Parent
		parentTip, ok := baseTips[parent]
		if !ok {
			continue // an unresolvable parent is an orphan; nothing to diff against.
		}
		childTip, ok := localRefs[name]
		if !ok {
			continue
		}
		raw, err := e.runOne(ctx, porcelain.LeftRightCountArgs(parentTip, childTip.Tip))
		if err != nil {
			return gitpreflight.StackListResult{}, err
		}
		behind, ahead, perr := porcelain.ParseLeftRightCount(raw)
		if perr != nil {
			return gitpreflight.StackListResult{}, perr
		}
		behindAhead[name] = gitpreflight.LeftRightCount{Behind: behind, Ahead: ahead}
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
