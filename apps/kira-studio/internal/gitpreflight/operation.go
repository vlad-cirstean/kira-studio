// Package gitpreflight is the pure, server-side half of SPEC's pre-flight engine — G5 builds it
// with exactly what this phase's own RPCs read (D3): the in-progress classifier, the status folds,
// the checkout and revert classifiers, and the undo slot. G7/G12/G13 each extend this package with
// one file of their own; nothing here is a stub for a classifier a later phase owns.
//
// Nothing in this package spawns a process or touches the filesystem — every classifier is a pure
// function over plain data, which is what makes the phase's densest logic (the checkout/revert
// matrices, the in-progress precedence table) testable with no repository at all.
package gitpreflight

// InProgressKind mirrors @kira/git-ipc's own InProgressKind union verbatim.
type InProgressKind string

const (
	InProgressMerge        InProgressKind = "merge"
	InProgressCherryPick   InProgressKind = "cherryPick"
	InProgressRevert       InProgressKind = "revert"
	InProgressRebase       InProgressKind = "rebase"
	InProgressBisect       InProgressKind = "bisect"
	InProgressUnmergedOnly InProgressKind = "unmergedOnly"
)

// InProgressOperation mirrors @kira/git-ipc's own InProgressOperation field for field (D5's
// encoding rule: an absent optional field is omitted, never present-and-null).
type InProgressOperation struct {
	Kind InProgressKind `json:"kind"`
	// OtherSha: MERGE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD's content, or rebase's own "onto".
	OtherSha *string `json:"otherSha,omitempty"`
	// HeadName: rebase only — rebase-merge/head-name's content, e.g. "refs/heads/side".
	HeadName        *string  `json:"headName,omitempty"`
	ConflictedPaths []string `json:"conflictedPaths"`
	// CanContinue is true only where `git <op> --continue` exists AND v1 offers it — false for
	// rebase (§9's report-only posture) and bisect.
	CanContinue bool `json:"canContinue"`
	CanAbort    bool `json:"canAbort"`
	// IsSequence: .git/sequencer/ present — a multi-commit revert or cherry-pick mid-run, where
	// --abort is what delivers §7.10's all-or-nothing.
	IsSequence bool `json:"isSequence"`
	// UnmergedCount: Continue is *enabled* only when this is 0 — kept separate from
	// len(ConflictedPaths) so a host that caps the path list can never accidentally enable it.
	UnmergedCount int `json:"unmergedCount"`
	// CanSkip: true for cherryPick and revert only — the two sequencer operations git gives a
	// --skip (probe P6).
	CanSkip bool `json:"canSkip"`
}

// InProgressStateFiles is what gitops.ReadInProgressStateFiles reads off the per-worktree gitDir
// (D9) — deliberately plain data, so ClassifyInProgress needs no filesystem to test. A missing
// file is the zero value, never an error.
type InProgressStateFiles struct {
	MergeHead      *string
	CherryPickHead *string
	RevertHead     *string
	BisectLog      bool
	RebaseMergeDir bool
	RebaseApplyDir bool
	RebaseHeadName *string
	RebaseOnto     *string
	SequencerDir   bool
}

type inProgressInput struct {
	otherSha      *string
	headName      *string
	canContinue   bool
	canAbort      bool
	isSequence    bool
	unmergedPaths []string
}

func operationOf(kind InProgressKind, in inProgressInput) *InProgressOperation {
	paths := in.unmergedPaths
	if paths == nil {
		paths = []string{}
	}
	return &InProgressOperation{
		Kind: kind, OtherSha: in.otherSha, HeadName: in.headName,
		ConflictedPaths: paths, CanContinue: in.canContinue, CanAbort: in.canAbort,
		IsSequence: in.isSequence, UnmergedCount: len(paths),
		CanSkip: kind == InProgressCherryPick || kind == InProgressRevert,
	}
}

// ClassifyInProgress implements §7.11's precedence table exactly, ported from
// model/operation.ts's own classifyInProgress: rebase shadows everything else (a rebase stopped
// on a conflict also leaves the sequencer files a cherry-pick would), then merge, cherry-pick,
// revert, bisect, and finally a bare "unmerged paths with none of the six state files present"
// fallback (a resolved-then-reset state, or `git checkout -m`). AUTO_MERGE is deliberately not an
// input — upstream's probe P4 found it left behind after an aborted cherry-pick, a stale artefact
// rather than a state signal.
func ClassifyInProgress(files InProgressStateFiles, unmergedPaths []string) *InProgressOperation {
	if files.RebaseMergeDir || files.RebaseApplyDir {
		return operationOf(InProgressRebase, inProgressInput{
			otherSha: files.RebaseOnto, headName: files.RebaseHeadName,
			canContinue: false, canAbort: true, isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	if files.MergeHead != nil {
		return operationOf(InProgressMerge, inProgressInput{
			otherSha: files.MergeHead, canContinue: true, canAbort: true,
			isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	if files.CherryPickHead != nil {
		return operationOf(InProgressCherryPick, inProgressInput{
			otherSha: files.CherryPickHead, canContinue: true, canAbort: true,
			isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	if files.RevertHead != nil {
		return operationOf(InProgressRevert, inProgressInput{
			otherSha: files.RevertHead, canContinue: true, canAbort: true,
			isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	if files.BisectLog {
		return operationOf(InProgressBisect, inProgressInput{
			canContinue: false, canAbort: true, isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	if len(unmergedPaths) > 0 {
		return operationOf(InProgressUnmergedOnly, inProgressInput{
			canContinue: false, canAbort: false, isSequence: files.SequencerDir, unmergedPaths: unmergedPaths,
		})
	}
	return nil
}

// KindLabel is the one sentence naming an in-progress operation in the user's own terms — shared
// by the banner and every gated control's disabled tooltip (§7.11), ported from
// describeInProgress's own KIND_LABEL table.
var kindLabel = map[InProgressKind]string{
	InProgressMerge:        "Merging",
	InProgressCherryPick:   "Cherry-picking",
	InProgressRevert:       "Reverting",
	InProgressRebase:       "Rebasing",
	InProgressBisect:       "Bisecting",
	InProgressUnmergedOnly: "Unresolved conflict",
}

// DescribeInProgress mirrors upstream's describeInProgress verbatim — used by gitsession's own
// opContinue/opAbort/opSkip early-error messages (D5's op table).
func DescribeInProgress(op *InProgressOperation) string {
	if op.Kind == InProgressRebase {
		branch := ""
		if op.HeadName != nil {
			branch = *op.HeadName
			const prefix = "refs/heads/"
			if len(branch) >= len(prefix) && branch[:len(prefix)] == prefix {
				branch = branch[len(prefix):]
			}
		}
		if branch != "" {
			return "Rebasing " + branch
		}
		return "Rebasing"
	}
	if op.Kind == InProgressUnmergedOnly {
		return "Unresolved conflict"
	}
	shortSha := ""
	if op.OtherSha != nil && len(*op.OtherSha) > 0 {
		sha := *op.OtherSha
		if len(sha) > 7 {
			sha = sha[:7]
		}
		shortSha = " `" + sha + "`"
	}
	return kindLabel[op.Kind] + shortSha
}
