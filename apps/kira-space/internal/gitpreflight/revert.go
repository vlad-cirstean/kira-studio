package gitpreflight

// RevertParentChoice mirrors @kira/git-ipc's own RevertParentChoice.
type RevertParentChoice struct {
	ParentNumber int    `json:"parentNumber"` // 1-based, as `-m` takes it.
	Sha          string `json:"sha"`
	Subject      string `json:"subject"`
}

// RevertMainlineChoice is one entry of RevertPreflight.mainlineRequired.
type RevertMainlineChoice struct {
	Sha     string               `json:"sha"`
	Parents []RevertParentChoice `json:"parents"`
}

// RevertPrediction mirrors @kira/git-ipc's own RevertPreflight.prediction discriminated union,
// flattened (Paths for "conflicts", Reason for "unknown").
type RevertPrediction struct {
	Kind   string   `json:"kind"` // "clean" | "conflicts" | "unknown"
	Paths  []string `json:"paths,omitempty"`
	Reason string   `json:"reason,omitempty"`
}

// RevertPreflight mirrors @kira/git-ipc's own RevertPreflight field for field.
type RevertPreflight struct {
	Shas             []string               `json:"shas"`
	MainlineRequired []RevertMainlineChoice `json:"mainlineRequired"`
	DirtyPaths       []string               `json:"dirtyPaths"`
	InProgress       *InProgressOperation   `json:"inProgress"`
	Prediction       RevertPrediction       `json:"prediction"`
	PredictedFor     *string                `json:"predictedFor"` // string | null, never omitted.
	DetachedHead     bool                   `json:"detachedHead"`
	Verdict          string                 `json:"verdict"` // "clean" | "willConflict" | "blocked"
	Blockers         []string               `json:"blockers"`
}

// ClassifyRevertInput is ClassifyRevert's own input — a direct port of preflight/revert.ts's
// parameter object.
type ClassifyRevertInput struct {
	Shas []string
	// MergeParents: parent lists for every MERGE commit among Shas (a non-merge has no entry) —
	// every parent's sha and subject, so the picker never re-queries.
	MergeParents map[string][]RevertParentChoice
	// Mainline: the single mainline number already chosen for this whole invocation (git's -m is
	// one flag for the entire multi-sha revert), or nil if none has been chosen yet.
	Mainline     *int
	DirtyPaths   []string
	InProgress   *InProgressOperation
	DetachedHead bool
	// Prediction: the merge-tree prediction for Shas[0] only.
	Prediction RevertPrediction
}

// ClassifyRevert is §7.10's revert classifier, ported verbatim from preflight/revert.ts: every
// merge among Shas needs an explicit mainline before the op is offered; the dirty tree and any
// in-progress operation block; a detached HEAD is a note, not a blocker; the prediction is scoped
// to Shas[0] and PredictedFor says so.
func ClassifyRevert(in ClassifyRevertInput) RevertPreflight {
	shas := in.Shas
	if shas == nil {
		shas = []string{}
	}

	mainlineRequired := []RevertMainlineChoice{}
	if in.Mainline == nil {
		for _, sha := range shas {
			if parents, ok := in.MergeParents[sha]; ok {
				mainlineRequired = append(mainlineRequired, RevertMainlineChoice{Sha: sha, Parents: parents})
			}
		}
	}

	blockers := []string{}
	if in.InProgress != nil {
		blockers = append(blockers, "inProgressOperation")
	}
	if len(mainlineRequired) > 0 {
		blockers = append(blockers, "mainlineRequired")
	}
	if len(in.DirtyPaths) > 0 {
		blockers = append(blockers, "dirtyWorktree")
	}

	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case in.Prediction.Kind == "conflicts":
		verdict = "willConflict"
	}

	var predictedFor *string
	if len(shas) > 0 {
		s := shas[0]
		predictedFor = &s
	}

	dirtyPaths := in.DirtyPaths
	if dirtyPaths == nil {
		dirtyPaths = []string{}
	}

	return RevertPreflight{
		Shas: shas, MainlineRequired: mainlineRequired, DirtyPaths: dirtyPaths,
		InProgress: in.InProgress, Prediction: in.Prediction, PredictedFor: predictedFor,
		DetachedHead: in.DetachedHead, Verdict: verdict, Blockers: blockers,
	}
}
