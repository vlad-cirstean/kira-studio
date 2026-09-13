package gitpreflight

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"

// HeadState mirrors gitclient.HeadState field for field and tag for tag (never imported directly
// — this package imports gitclient/porcelain and stdlib only, D3) so it stays convertible with a
// plain Go type conversion at gitsession's own boundary.
type HeadState struct {
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
	SHA  string `json:"sha,omitempty"`
}

// DirtyPathsDisplayCap is StatusSummary.dirtyPaths' own display cap (D11) — applied by gitsession's
// handler, never here: the checkout/revert classifiers below must see the FULL, uncapped set (a
// wrong verdict is worse than a long dialog), so capping belongs at the one layer that knows what
// "too many to show" means.
const DirtyPathsDisplayCap = 200

// StatusCounts mirrors @kira/git-ipc's own StatusSummary.counts.
type StatusCounts struct {
	Staged    int `json:"staged"`
	Unstaged  int `json:"unstaged"`
	Untracked int `json:"untracked"`
	Unmerged  int `json:"unmerged"`
}

// StatusUpstream mirrors @kira/git-ipc's own StatusSummary.upstream.
type StatusUpstream struct {
	Name   string `json:"name"`
	Ahead  int    `json:"ahead"`
	Behind int    `json:"behind"`
}

// StatusSummary mirrors @kira/git-ipc's own StatusSummary field for field (D5's encoding rule).
type StatusSummary struct {
	Head           HeadState            `json:"head"`
	Upstream       *StatusUpstream      `json:"upstream,omitempty"`
	Counts         StatusCounts         `json:"counts"`
	IsClean        bool                 `json:"isClean"`
	DirtyPaths     []string             `json:"dirtyPaths"`
	DirtyTruncated bool                 `json:"dirtyTruncated"`
	InProgress     *InProgressOperation `json:"inProgress"`
}

// headStateFromBranch derives HeadState from status --branch's own header — free, since
// statusAndInProgress already has this on hand, versus a third rev-parse/symbolic-ref spawn
// (gitclient.ResolveHead's own route). Unborn is exactly probe P11's rule: a named branch with no
// commit behind it yet ("(initial)").
func headStateFromBranch(b porcelain.StatusBranchInfo) HeadState {
	if b.Detached {
		return HeadState{Kind: "detached", SHA: b.OID}
	}
	if b.Unborn {
		return HeadState{Kind: "unborn", Name: b.HeadName}
	}
	return HeadState{Kind: "branch", Name: b.HeadName}
}

// SummarizeStatus is the wire-shaped fold from one porcelain.StatusResult (plus the in-progress
// classification, joined by the caller — gitsession's statusAndInProgress, never here) into
// StatusSummary — a direct port of model/status.ts's own summarizeStatus. dirtyPaths is always the
// FULL, uncapped list; DirtyTruncated is always false here (the cap is gitsession's own concern,
// D11).
func SummarizeStatus(result porcelain.StatusResult, inProgress *InProgressOperation) StatusSummary {
	var staged, unstaged, untracked, unmerged int
	dirtyPaths := []string{}

	for _, e := range result.Entries {
		switch e.Kind {
		case "ordinary", "renamed":
			if e.Staged != '.' {
				staged++
			}
			if e.Unstaged != '.' {
				unstaged++
			}
			dirtyPaths = append(dirtyPaths, e.Path)
		case "unmerged":
			unmerged++
			dirtyPaths = append(dirtyPaths, e.Path)
		case "untracked":
			untracked++
			dirtyPaths = append(dirtyPaths, e.Path)
		case "ignored":
			// Never dirty — status only reports these at all when --ignored was passed, and this
			// chapter's classification has no use for a path git will never touch on checkout.
		}
	}

	var upstream *StatusUpstream
	if result.Branch.HasUpstream {
		upstream = &StatusUpstream{Name: result.Branch.Upstream, Ahead: result.Branch.Ahead, Behind: result.Branch.Behind}
	}

	return StatusSummary{
		Head:           headStateFromBranch(result.Branch),
		Upstream:       upstream,
		Counts:         StatusCounts{Staged: staged, Unstaged: unstaged, Untracked: untracked, Unmerged: unmerged},
		IsClean:        staged == 0 && unstaged == 0 && untracked == 0 && unmerged == 0,
		DirtyPaths:     dirtyPaths,
		DirtyTruncated: false,
		InProgress:     inProgress,
	}
}

// DirtyPath is the sibling fold ClassifyCheckout's own `dirty` input needs: every path git
// considers not-clean, discriminated tracked/untracked — the split §7.5's two blocker kinds
// (blockedByTracked/blockedByUntracked) are built from. An unmerged path counts as tracked: it has
// index stages, and blockedByTracked's remedy (discard) is the one that actually applies to it.
type DirtyPath struct {
	Path    string
	Tracked bool
}

// DirtyPaths ports model/status.ts's own dirtyPathsFrom.
func DirtyPaths(result porcelain.StatusResult) []DirtyPath {
	out := make([]DirtyPath, 0, len(result.Entries))
	for _, e := range result.Entries {
		switch e.Kind {
		case "ordinary", "renamed", "unmerged":
			out = append(out, DirtyPath{Path: e.Path, Tracked: true})
		case "untracked":
			out = append(out, DirtyPath{Path: e.Path, Tracked: false})
		case "ignored":
		}
	}
	return out
}

// UnmergedPaths is ClassifyInProgress's own unmergedPaths input, shared by SummarizeStatus, both
// pre-flights and the executor's post-op read-back, so all four never drift on what "unmerged"
// means (repoService.ts's own unmergedPathsFrom).
func UnmergedPaths(result porcelain.StatusResult) []string {
	out := []string{}
	for _, e := range result.Entries {
		if e.Kind == "unmerged" {
			out = append(out, e.Path)
		}
	}
	return out
}

// DirtySplit ports repoService.ts's own dirtySplitFrom — the staged/unstaged/untracked split
// ClassifyReset and ClassifyCherryPick both need, which DirtyPaths' own tracked/untracked
// discrimination cannot make. An unmerged path counts as BOTH staged and unstaged — the XY code's
// two halves can each be non-'.' on a real merge conflict, and there is no case in this phase's
// scope where either classifier reaches this fold with one outstanding without inProgress already
// blocking first.
func DirtySplit(result porcelain.StatusResult) ResetDirty {
	staged := []string{}
	unstaged := []string{}
	untracked := []string{}
	for _, e := range result.Entries {
		switch e.Kind {
		case "ordinary", "renamed":
			if e.Staged != '.' {
				staged = append(staged, e.Path)
			}
			if e.Unstaged != '.' {
				unstaged = append(unstaged, e.Path)
			}
		case "unmerged":
			staged = append(staged, e.Path)
			unstaged = append(unstaged, e.Path)
		case "untracked":
			untracked = append(untracked, e.Path)
		case "ignored":
		}
	}
	return ResetDirty{Staged: staged, Unstaged: unstaged, Untracked: untracked}
}

// StagedNewPaths ports stagedNewPathsFrom — probe 1's third finding: a staged-but-uncommitted NEW
// file (status `A.`) reads as "added", not "modified". --hard destroys it exactly as it does a
// staged edit, but it is neither DirtySplit's `unstaged` (nothing in the worktree differs from the
// index) nor its `untracked` (the index already has it staged) list, so ClassifyReset's `destroys`
// needs it as its own third input rather than reading it off either.
func StagedNewPaths(result porcelain.StatusResult) []string {
	out := []string{}
	for _, e := range result.Entries {
		if e.Kind == "ordinary" && e.Staged == 'A' {
			out = append(out, e.Path)
		}
	}
	return out
}
