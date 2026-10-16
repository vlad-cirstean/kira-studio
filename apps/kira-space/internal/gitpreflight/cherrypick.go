// docs/plans/P10.md §7.13's cherry-pick classifier — the direct structural sibling of
// ClassifyRevert, with different blockers (probe 7): there is no blanket dirty-worktree blocker
// here. Probe 7A found a clean pick proceeds even with an unrelated dirty file present, so every
// blocker below is a set intersection against the picked commit's OWN paths (mirroring
// ClassifyCheckout's D∩T pattern), except `stagedChanges`, which git refuses no matter what it
// touches (probe 7 B/D). Ported verbatim from @kira/git-core's own preflight/cherryPick.ts (D2).
package gitpreflight

// CherryPickCommitPaths is the picked commit's own changed paths, split "added" (probe 7E: an
// untracked file at one of these is refused) from everything else (probe 7C: an unstaged change
// overlapping one of these is refused).
type CherryPickCommitPaths struct {
	Touched []string `json:"touched"`
	Added   []string `json:"added"`
}

// CherryPickBlocker is CherryPickPreflight.blockers' own element — a flattened struct (Kind/Paths/
// Parents/Operation), the same convention CheckoutBlocker/StashPopBlocker already use.
type CherryPickBlocker struct {
	Kind      string               `json:"kind"`
	Paths     []string             `json:"paths,omitempty"`
	Parents   []RevertParentChoice `json:"parents,omitempty"`
	Operation *InProgressOperation `json:"operation,omitempty"`
}

// CherryPickPreflight mirrors @kira/git-ipc's own CherryPickPreflight field for field.
type CherryPickPreflight struct {
	Sha              string               `json:"sha"`
	Subject          string               `json:"subject"`
	MainlineRequired []RevertParentChoice `json:"mainlineRequired"`
	Prediction       RevertPrediction     `json:"prediction"`
	AlreadyApplied   bool                 `json:"alreadyApplied"`
	InProgress       *InProgressOperation `json:"inProgress"`
	DetachedHead     bool                 `json:"detachedHead"`
	Verdict          string               `json:"verdict"` // "clean" | "willConflict" | "blocked"
	Blockers         []CherryPickBlocker  `json:"blockers"`
}

// ClassifyCherryPickInput is ClassifyCherryPick's own input — a direct port of
// preflight/cherryPick.ts's parameter object.
type ClassifyCherryPickInput struct {
	Sha     string
	Subject string
	// MergeParents: empty ⇒ not a merge commit.
	MergeParents   []RevertParentChoice
	Mainline       *int
	CommitPaths    CherryPickCommitPaths
	Dirty          ResetDirty
	Prediction     RevertPrediction
	AlreadyApplied bool
	InProgress     *InProgressOperation
	DetachedHead   bool
}

// intersect returns the elements of a that are also in b, preserving a's own order.
func intersect(a, b []string) []string {
	set := make(map[string]bool, len(b))
	for _, p := range b {
		set[p] = true
	}
	out := []string{}
	for _, p := range a {
		if set[p] {
			out = append(out, p)
		}
	}
	return out
}

// ClassifyCherryPick is §7.13's cherry-pick classifier, ported verbatim from
// preflight/cherryPick.ts (D2): blockers, in order, are inProgressOperation, mainlineRequired,
// stagedChanges, untrackedWouldBeOverwritten, localChangesWouldBeOverwritten.
func ClassifyCherryPick(in ClassifyCherryPickInput) CherryPickPreflight {
	mainlineRequired := []RevertParentChoice{}
	if len(in.MergeParents) > 0 && in.Mainline == nil {
		mainlineRequired = in.MergeParents
	}

	blockers := []CherryPickBlocker{}
	if in.InProgress != nil {
		blockers = append(blockers, CherryPickBlocker{Kind: "inProgressOperation", Operation: in.InProgress})
	}
	if len(mainlineRequired) > 0 {
		blockers = append(blockers, CherryPickBlocker{Kind: "mainlineRequired", Parents: mainlineRequired})
	}
	if len(in.Dirty.Staged) > 0 {
		blockers = append(blockers, CherryPickBlocker{Kind: "stagedChanges", Paths: in.Dirty.Staged})
	}
	untrackedHit := intersect(in.Dirty.Untracked, in.CommitPaths.Added)
	if len(untrackedHit) > 0 {
		blockers = append(blockers, CherryPickBlocker{Kind: "untrackedWouldBeOverwritten", Paths: untrackedHit})
	}
	unstagedHit := intersect(in.Dirty.Unstaged, in.CommitPaths.Touched)
	if len(unstagedHit) > 0 {
		blockers = append(blockers, CherryPickBlocker{Kind: "localChangesWouldBeOverwritten", Paths: unstagedHit})
	}

	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case in.Prediction.Kind == "conflicts":
		verdict = "willConflict"
	}

	return CherryPickPreflight{
		Sha: in.Sha, Subject: in.Subject, MainlineRequired: mainlineRequired,
		Prediction: in.Prediction, AlreadyApplied: in.AlreadyApplied,
		InProgress: in.InProgress, DetachedHead: in.DetachedHead,
		Verdict: verdict, Blockers: blockers,
	}
}
