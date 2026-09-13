package gitpreflight

import (
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// StashPopBlocker mirrors @kira/git-ipc's own StashPopBlocker discriminated union, flattened into
// one struct (CheckoutBlocker's own convention): Paths for untrackedCollision/
// localChangesWouldBeOverwritten, Operation for inProgressOperation.
type StashPopBlocker struct {
	Kind      string               `json:"kind"`
	Paths     []string             `json:"paths,omitempty"`
	Operation *InProgressOperation `json:"operation,omitempty"`
}

// StashPopPreflight mirrors @kira/git-ipc's own StashPopPreflight field for field. Prediction reuses
// RevertPrediction (already this package's own Go shape of MergeOutcomePrediction — TypeScript's
// own `RevertPrediction` stays an alias of `MergeOutcomePrediction` for the identical reason,
// preflight/types.ts:58): both share the exact three-armed {clean}/{conflicts,paths}/
// {unknown,reason} wire shape, so no second prediction type is needed.
type StashPopPreflight struct {
	StashSha   string            `json:"stashSha"`
	StashIndex int               `json:"stashIndex"`
	TargetSha  string            `json:"targetSha"`
	Prediction RevertPrediction  `json:"prediction"`
	Blockers   []StashPopBlocker `json:"blockers"`
	Verdict    string            `json:"verdict"` // "clean" | "willConflict" | "blocked"
}

// StashBranchName is StashBranchPreflight.name's own shape.
type StashBranchName struct {
	Valid  bool    `json:"valid"`
	Error  *string `json:"error,omitempty"`
	Exists bool    `json:"exists"`
}

// StashBranchPreflight mirrors @kira/git-ipc's own StashBranchPreflight field for field — no
// `prediction` field at all (probe 11: `stash branch <name> <sha>` creates the branch at the
// stash's own base, so the apply half is clean by construction and gets no merge-tree prediction).
type StashBranchPreflight struct {
	Name     StashBranchName   `json:"name"`
	Checkout CheckoutPreflight `json:"checkout"`
	Verdict  string            `json:"verdict"` // "clean" | "invalidName" | "blocked"
}

// ClassifyStashPopInput is ClassifyStashPop's own input — a direct port of
// preflight/stashPop.ts's classifyStashPop parameter object. Stash reuses porcelain.StashEntry
// directly (this package already depends on porcelain, status.go's own precedent) rather than a
// redefinition — the wire shape and the classifier's own input shape are identical, so a second
// type would only duplicate it.
type ClassifyStashPopInput struct {
	Stash     porcelain.StashEntry
	TargetSha string
	// Prediction: from predictMerge(target, stash.sha, {mergeBase: stash.baseSha}) — computed by
	// the caller because it needs a spawn. Always predicted with --merge-base=<stash's own base>
	// (probe 2); there is no variant of this classifier that accepts a prediction computed without
	// it.
	Prediction RevertPrediction
	// StashPaths: paths the stash changes (tracked half), from stash.show's own numstat.
	StashPaths []string
	// StashUntrackedPaths: ls-tree -r --name-only <stash>^3, empty when -u was not used (probe 1).
	StashUntrackedPaths []string
	// Dirty: the same DirtyPath set §7.5's checkout classifier reads.
	Dirty []DirtyPath
	// ExistingUntrackedPaths: which of StashUntrackedPaths currently exist in the worktree. A path
	// can collide while being neither tracked nor reported dirty — an ignored file, or one status
	// elides — so membership in Dirty is NOT a sufficient test (probe 3).
	ExistingUntrackedPaths []string
	InProgress             *InProgressOperation
}

// ClassifyStashPop is §7.6's stash-pop classifier — a direct Go port of
// preflight/stashPop.ts's classifyStashPop, same blocker order, same verdict rule (D2).
func ClassifyStashPop(in ClassifyStashPopInput) StashPopPreflight {
	existingSet := make(map[string]bool, len(in.ExistingUntrackedPaths))
	for _, p := range in.ExistingUntrackedPaths {
		existingSet[p] = true
	}
	untrackedCollisionPaths := []string{}
	for _, p := range in.StashUntrackedPaths {
		if existingSet[p] {
			untrackedCollisionPaths = append(untrackedCollisionPaths, p)
		}
	}

	dirtyTrackedSet := make(map[string]bool, len(in.Dirty))
	for _, d := range in.Dirty {
		if d.Tracked {
			dirtyTrackedSet[d.Path] = true
		}
	}
	localOverwritePaths := []string{}
	for _, p := range in.StashPaths {
		if dirtyTrackedSet[p] {
			localOverwritePaths = append(localOverwritePaths, p)
		}
	}

	// Ordered exactly like CheckoutBlocker's own documented ordering: inProgressOperation first (it
	// moots every other remedy), then untrackedCollision, then localChangesWouldBeOverwritten.
	blockers := []StashPopBlocker{}
	if in.InProgress != nil {
		blockers = append(blockers, StashPopBlocker{Kind: "inProgressOperation", Operation: in.InProgress})
	}
	if len(untrackedCollisionPaths) > 0 {
		blockers = append(blockers, StashPopBlocker{Kind: "untrackedCollision", Paths: untrackedCollisionPaths})
	}
	if len(localOverwritePaths) > 0 {
		blockers = append(blockers, StashPopBlocker{Kind: "localChangesWouldBeOverwritten", Paths: localOverwritePaths})
	}

	// unknown is never clean — the UI states the reason and lets the user proceed, exactly as the
	// revert dialog does for the same prediction shape.
	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case in.Prediction.Kind != "clean":
		verdict = "willConflict"
	}

	return StashPopPreflight{
		StashSha: in.Stash.Sha, StashIndex: in.Stash.Index, TargetSha: in.TargetSha,
		Prediction: in.Prediction, Blockers: blockers, Verdict: verdict,
	}
}

// ClassifyStashBranchInput is ClassifyStashBranch's own input — a direct port of
// preflight/stashPop.ts's classifyStashBranch parameter object.
type ClassifyStashBranchInput struct {
	Name                string
	ExistingBranchNames map[string]bool
	Checkout            CheckoutPreflight
}

// validateRefName is preflight/tag.ts's own validateRefName, ported verbatim (three rules, no
// more) — the one small piece classifyStashBranch needs that no Go port existed for yet:
// TagCreatePreflight (tag.ts's other export) is never wire-carried, so nothing before this phase
// needed a Go copy of this specific function; StashBranchPreflight IS wire-carried, so this phase
// is what needs it.
func validateRefName(name string) (valid bool, errMsg string) {
	if name == "" {
		return false, "Name cannot be empty."
	}
	if strings.HasPrefix(name, "-") {
		return false, "Name cannot start with '-'."
	}
	if strings.Contains(name, "@{") {
		return false, "Name cannot contain '@{' (reserved by git's reflog shorthand)."
	}
	return true, ""
}

// ClassifyStashBranch is §7.6's stash-branch classifier — a direct Go port of
// preflight/stashPop.ts's classifyStashBranch (D2): `stash branch <name> <sha>` creates the branch
// at the stash's own base then applies against that same base, so the apply half is clean by
// construction (probe 11) — what CAN fail is the branch-creation half, exactly like any other
// checkout, hence the composed CheckoutPreflight here rather than a bespoke blocker set.
func ClassifyStashBranch(in ClassifyStashBranchInput) StashBranchPreflight {
	valid, errMsg := validateRefName(in.Name)
	exists := in.ExistingBranchNames[in.Name]

	if !valid {
		var errPtr *string
		if errMsg != "" {
			errPtr = &errMsg
		}
		return StashBranchPreflight{
			Name:     StashBranchName{Valid: false, Error: errPtr, Exists: exists},
			Checkout: in.Checkout, Verdict: "invalidName",
		}
	}
	if exists {
		msg := "A branch with this name already exists."
		return StashBranchPreflight{
			Name:     StashBranchName{Valid: true, Error: &msg, Exists: true},
			Checkout: in.Checkout, Verdict: "invalidName",
		}
	}

	verdict := "clean"
	if len(in.Checkout.Blockers) > 0 {
		verdict = "blocked"
	}
	return StashBranchPreflight{
		Name:     StashBranchName{Valid: true, Error: nil, Exists: false},
		Checkout: in.Checkout, Verdict: verdict,
	}
}
