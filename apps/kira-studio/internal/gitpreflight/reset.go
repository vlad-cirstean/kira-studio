// docs/plans/P10.md §7.7's reset classifier — a direct Go port of @kira/git-core's own
// preflight/reset.ts, field for field and blocker order for blocker order (D1). Unlike
// ClassifyCheckout/ClassifyRevert, there is NO dirty-worktree blocker here at all: a dirty tree is
// exactly what soft/mixed are FOR (probe 1), and hard's destruction of it is `destroys` plus
// `requiresTypedConfirmation`, an advisory the dialog surfaces, not a refusal. The only real
// blockers are an in-progress operation (probe 3: git does not refuse a mid-merge reset on its
// own, so this classifier is the one place that does) and an unresolved target.
//
// This classifier is also ported to TypeScript, at packages/git-core/src/preflight/reset.ts
// (D3/D12) — that copy exists solely for previewResetMode's no-round-trip mode-radio recompute.
// This file is the authoritative twin; any change to the classification rules must land in both.
package gitpreflight

// ResetLeavingCommit is one entry of ResetPreflight.leavingCommits — a plain {sha, subject} pair.
type ResetLeavingCommit struct {
	Sha     string `json:"sha"`
	Subject string `json:"subject"`
}

// ResetDirty is the staged/unstaged/untracked split ClassifyReset and ClassifyCherryPick both
// need — the split DirtyPaths' own tracked/untracked discrimination cannot make. Wire-shaped: it
// is ResetPreflight.dirty verbatim.
type ResetDirty struct {
	Staged    []string `json:"staged"`
	Unstaged  []string `json:"unstaged"`
	Untracked []string `json:"untracked"`
}

// ResetPreflight mirrors @kira/git-ipc's own ResetPreflight field for field.
type ResetPreflight struct {
	Target           string               `json:"target"`
	TargetSubject    string               `json:"targetSubject"`
	Mode             string               `json:"mode"` // "soft" | "mixed" | "hard"
	CurrentHead      string               `json:"currentHead"`
	Branch           *string              `json:"branch"` // null on a detached HEAD.
	Leaving          int                  `json:"leaving"`
	Gaining          int                  `json:"gaining"`
	LeavingCommits   []ResetLeavingCommit `json:"leavingCommits"`
	LeavingTruncated bool                 `json:"leavingTruncated"`
	Dirty            ResetDirty           `json:"dirty"`
	// Destroys is what --hard will actually destroy. Empty for soft/mixed, always.
	Destroys                  []string             `json:"destroys"`
	InProgress                *InProgressOperation `json:"inProgress"`
	RequiresTypedConfirmation bool                 `json:"requiresTypedConfirmation"`
	Routes                    []string             `json:"routes"`   // "stashFirst"
	Verdict                   string               `json:"verdict"`  // "clean" | "destructive" | "blocked"
	Blockers                  []string             `json:"blockers"` // "inProgressOperation" | "unknownTarget"
}

// ClassifyResetInput is ClassifyReset's own input — a direct port of preflight/reset.ts's
// parameter object.
type ClassifyResetInput struct {
	Target           string
	TargetSubject    string
	Mode             string
	CurrentHead      string
	Branch           *string
	Leaving          int
	Gaining          int
	LeavingCommits   []ResetLeavingCommit
	LeavingTruncated bool
	Dirty            ResetDirty
	// StagedNew: staged-but-uncommitted NEW files (status `A.`/`A?`) — probe 1's third finding:
	// `--hard` destroys these, though they look untracked to a naive reading.
	StagedNew      []string
	InProgress     *InProgressOperation
	TargetResolves bool
}

// unique de-duplicates paths, first occurrence wins — matching JS `Set` iteration order.
func unique(paths []string) []string {
	seen := make(map[string]bool, len(paths))
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// ClassifyReset is §7.7's reset classifier, ported verbatim from preflight/reset.ts (D1): every
// slice field is initialized to []T{}, never left nil — []string(nil) marshals to null, and the
// dialog reads .length on all of them.
func ClassifyReset(in ClassifyResetInput) ResetPreflight {
	destroys := []string{}
	if in.Mode == "hard" {
		combined := make([]string, 0, len(in.Dirty.Staged)+len(in.Dirty.Unstaged)+len(in.StagedNew))
		combined = append(combined, in.Dirty.Staged...)
		combined = append(combined, in.Dirty.Unstaged...)
		combined = append(combined, in.StagedNew...)
		destroys = unique(combined)
	}
	requiresTypedConfirmation := in.Mode == "hard" && len(destroys) > 0

	blockers := []string{}
	if in.InProgress != nil {
		blockers = append(blockers, "inProgressOperation")
	}
	if !in.TargetResolves {
		blockers = append(blockers, "unknownTarget")
	}

	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case len(destroys) > 0:
		verdict = "destructive"
	}

	leavingCommits := []ResetLeavingCommit{}
	leavingTruncated := false
	if in.Leaving > 0 {
		leavingCommits = in.LeavingCommits
		if leavingCommits == nil {
			leavingCommits = []ResetLeavingCommit{}
		}
		leavingTruncated = in.LeavingTruncated
	}

	routes := []string{}
	if len(destroys) > 0 {
		routes = append(routes, "stashFirst")
	}

	dirty := in.Dirty
	if dirty.Staged == nil {
		dirty.Staged = []string{}
	}
	if dirty.Unstaged == nil {
		dirty.Unstaged = []string{}
	}
	if dirty.Untracked == nil {
		dirty.Untracked = []string{}
	}

	return ResetPreflight{
		Target: in.Target, TargetSubject: in.TargetSubject, Mode: in.Mode,
		CurrentHead: in.CurrentHead, Branch: in.Branch,
		Leaving: in.Leaving, Gaining: in.Gaining,
		LeavingCommits: leavingCommits, LeavingTruncated: leavingTruncated,
		Dirty: dirty, Destroys: destroys, InProgress: in.InProgress,
		RequiresTypedConfirmation: requiresTypedConfirmation, Routes: routes,
		Verdict: verdict, Blockers: blockers,
	}
}
