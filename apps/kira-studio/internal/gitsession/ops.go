package gitsession

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/catfile"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// OpRequest is op.run's own request — the Go decode of @kira/git-ipc's own twenty-four-member
// OpRequest union (G28 D17 adds globalStashSave/globalStashRemove), flattened into one struct (a
// field absent from the wire JSON for a given kind simply decodes to its zero value, which no
// served kind's Prepare function ever reads). Only fields the twenty-two kinds opTable serves
// actually need are declared — two of OpRequest's twenty-four kinds (tagPush/tagDeleteRemote) are
// unserved and unassigned (G22 §9: blocked on RunOp's own write path having no askpass wiring),
// and their own fields are never decoded here at all, since opTable rejects an unlisted kind
// before any field is read (D5).
type OpRequest struct {
	Kind string `json:"kind"`

	Target              string `json:"target,omitempty"` // checkout, tagCreate
	Mode                string `json:"mode,omitempty"`   // checkout: "switch" | "detach"
	DiscardLocalChanges bool   `json:"discardLocalChanges,omitempty"`
	// AutoStash is G28 D3's own checkout addition: prepend a whole-tree `stash push [-u]` tagged
	// with the CURRENT branch, so the switch cannot be blocked by a dirty tree. Never popped back
	// (D1). Mutually exclusive with DiscardLocalChanges — prepareCheckout refuses both at once
	// rather than guessing which the caller meant.
	AutoStash bool `json:"autoStash,omitempty"` // checkout

	Name       string  `json:"name,omitempty"` // branchCreate/branchDelete/tagCreate/tagDelete
	StartPoint string  `json:"startPoint,omitempty"`
	Checkout   bool    `json:"checkout,omitempty"`
	Track      *string `json:"track,omitempty"`

	Force bool `json:"force,omitempty"` // branchDelete, tagCreate

	From string `json:"from,omitempty"` // branchRename
	To   string `json:"to,omitempty"`

	Message *string `json:"message,omitempty"` // tagCreate

	Shas     []string `json:"shas,omitempty"` // revert
	Mainline *int     `json:"mainline,omitempty"`
	NoCommit bool     `json:"noCommit,omitempty"`

	// G17: the five stash kinds' own fields. Message is reused as-is (already declared above, for
	// tagCreate — the JSON tag already matches stashPush's own `message: string | undefined`).
	IncludeUntracked bool     `json:"includeUntracked,omitempty"` // stashPush
	KeepIndex        bool     `json:"keepIndex,omitempty"`        // stashPush
	Paths            []string `json:"paths,omitempty"`            // stashPush
	Sha              string   `json:"sha,omitempty"`              // stashApply/stashPop/stashDrop/stashBranch
	Index            int      `json:"index,omitempty"`            // stashPop/stashDrop/stashBranch
	RestoreIndex     bool     `json:"restoreIndex,omitempty"`     // stashApply/stashPop
	Branch           string   `json:"branch,omitempty"`           // stashBranch

	// ConfirmToken is G22's own addition (D8): reset's own typed confirmation, required (and
	// re-checked host-side by prepareReset) exactly when Mode == "hard" and destroys, recomputed
	// fresh from a status read immediately before the write, is non-empty. A pointer: the wire's
	// own `string | undefined` (contract.ts's own OpRequest.reset.confirmToken). G25 reuses this
	// same field for worktreeRemove's own typed confirmation (the worktree's basename, D8) — same
	// "optional, re-checked host-side against a fresh recompute" shape, different op kind.
	ConfirmToken *string `json:"confirmToken,omitempty"` // reset, worktreeRemove

	// Path is G25 D2's own addition — worktreeAdd's target path and worktreeRemove's target
	// worktree, both absolute (the client always resolves against basePath/the repo root before
	// sending). Mode/Branch/StartPoint/Force above are ALL reused as-is for the two new kinds:
	// Mode carries worktreeAdd's "existingBranch"|"newBranch"|"detach", Branch its branch name,
	// StartPoint its explicit commit-ish, and Force worktreeRemove's own client-claimed force —
	// though prepareWorktreeRemove never actually trusts that claim, recomputing it fresh from the
	// server-side preflight verdict instead (D8's own fail-safe-over-fail-open principle).
	Path string `json:"path,omitempty"` // worktreeAdd, worktreeRemove

	// Parent is G26 D10's own stackSet addition — nil means "remove Branch from its stack" (D2
	// writes "" for both kirastack keys, never `config --unset`, per F15/P5).
	Parent *string `json:"parent,omitempty"` // stackSet

	// Label is G28 D10's own globalStashSave addition — the new entry's own name. Non-empty,
	// single-line, validated host-side (a newline would corrupt the reflog-subject-shaped line
	// every reader of this bucket parses).
	Label string `json:"label,omitempty"` // globalStashSave
	// Scope is G28 D17's own addition, threaded through the wire's own widened preflight/stash.show
	// params (a later step) — "" or "stack" for the ordinary stack, "global" for the bucket. Sha
	// above is reused as-is for globalStashRemove's own target (D11) and, when non-empty, for
	// globalStashSave's own "promote an existing entry" source (D10) — the source there is resolved
	// across BOTH buckets (resolveStashEntryAnyScope), so it deliberately carries no Scope of its
	// own.
	Scope string `json:"scope,omitempty"`
}

// OpError mirrors @kira/git-ipc's own op.run/undo.run per-op error shape.
type OpError struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
}

// OpResult mirrors @kira/git-ipc's own OpResult field for field (D5's encoding rule).
type OpResult struct {
	OK         bool                              `json:"ok"`
	Error      *OpError                          `json:"error,omitempty"`
	Undo       *gitpreflight.UndoSlotSnapshot    `json:"undo"`
	Head       gitclient.HeadState               `json:"head"`
	InProgress *gitpreflight.InProgressOperation `json:"inProgress"`
}

// ErrUnservedOpKind is RunOp's answer for an OpRequest.Kind not present in opTable (D5) — two of
// OpRequest's twenty-four kinds (tagPush/tagDeleteRemote) are unserved and unassigned — see G22 §9.
// gitrpc maps this to E_UNKNOWN_METHOD naming the kind — never a stub, never a silent success.
type ErrUnservedOpKind struct{ Kind string }

func (e ErrUnservedOpKind) Error() string {
	return "gitsession: op.run: " + e.Kind + " is not served yet"
}

// prepared is #prepareOp's own return shape (D6's opSpec.Prepare): the argv sequence to write, an
// undo record captured BEFORE any write (nil for a notUndoable kind or a failed best-effort
// capture), and earlyError for a refusal that never reaches a write at all.
type prepared struct {
	argvList   [][]string
	undo       *gitpreflight.UndoRecord
	earlyError *OpError
}

// opSpec is one opTable entry (D6) — the Go stand-in for upstream's TypeScript mapped type
// (UNDO_POLICY): Undo and Prepare live in the SAME struct literal, so there is no second place to
// forget an undo policy when adding an operation. TestOpTable_EveryEntryStatesAnUndoPolicy is what
// stands where `tsc` stood upstream.
type opSpec struct {
	Undo    gitpreflight.UndoPolicy
	Prepare func(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error)
	// Reclassify: nil for every kind that does not need it (fourteen of seventeen served kinds
	// after G22). When set, called AFTER the write loop and AFTER the post-write
	// statusAndInProgress read RunOp already performs — reusing that read, not adding a second one
	// — with the raw OpError the stderr-only classification produced (nil on a clean exit), the
	// fresh porcelain.StatusResult, and the fresh *gitpreflight.InProgressOperation (nil when
	// nothing is in progress). G22 widened this by the third parameter: an empty cherry-pick is
	// distinguishable from every other clean-tree pick failure ONLY by CHERRY_PICK_HEAD still
	// being set, which lives in the in-progress classification, never in status output. Returns
	// the OpError RunOp should actually report; a kind with no Reclassify keeps the stderr-only
	// result unchanged.
	Reclassify func(opErr *OpError, status porcelain.StatusResult, inProgress *gitpreflight.InProgressOperation) *OpError
}

// opTable serves twenty-two of OpRequest's twenty-four kinds (D5) — the other two (tagPush/
// tagDeleteRemote) answer ErrUnservedOpKind, never a stub. Labels are ported verbatim from
// undo/slot.ts's own UNDO_POLICY; G17 added the five stash kinds (note stashDrop's own Undo:
// undo/slot.ts marks it undoable, not notUndoable like its four stash siblings —
// captureStashDropUndo below is why); G22 adds reset/cherryPick, both undoable (D9); G28 adds
// globalStashSave (notUndoable — copies, never drops its source, D10) and globalStashRemove
// (undoable — the cleanest undo in the table, an exact single-argv replay, D11).
var opTable = map[string]opSpec{
	// checkout: notUndoable, its reason widened at G28 D3 to name the auto-stash honestly — an
	// auto-stashed switch leaves a clean tree on the new branch, and the reason text is the one
	// place a user re-discovering this op later (via the undo-slot tooltip's own reason fallback)
	// learns where their work went.
	"checkout": {
		Undo: gitpreflight.UndoPolicy{
			Kind: gitpreflight.NotUndoable,
			Reason: "Switch back to the previous ref to undo this. Auto-stashed changes stay in the stash list, " +
				"tagged with the branch they came from.",
		},
		Prepare: prepareCheckout,
	},
	"branchCreate": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Delete the branch to undo this."},
		Prepare: prepareBranchCreate,
	},
	"branchDelete": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareBranchDelete,
	},
	"branchRename": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Rename it back to undo this."},
		Prepare: prepareBranchRename,
	},
	"tagCreate": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Delete the tag to undo this."},
		Prepare: prepareTagCreate,
	},
	"tagDelete": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareTagDelete,
	},
	"revert": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Revert the revert, or reset to before it."},
		Prepare: prepareRevert,
	},
	"opContinue": {
		Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Continuing an operation has no undo."},
		Prepare: func(ctx context.Context, e *RepoEntry, _ ConnID, _ string, _ OpRequest) (prepared, error) {
			return prepareSequencerVerb(ctx, e, "Continue", gitops.ContinueArgs)
		},
	},
	"opAbort": {
		Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Aborting an operation has no undo."},
		Prepare: func(ctx context.Context, e *RepoEntry, _ ConnID, _ string, _ OpRequest) (prepared, error) {
			return prepareSequencerVerb(ctx, e, "Abort", gitops.AbortArgs)
		},
	},
	"opSkip": {
		Undo: gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Skipping a commit in an operation has no undo."},
		Prepare: func(ctx context.Context, e *RepoEntry, _ ConnID, _ string, _ OpRequest) (prepared, error) {
			return prepareSequencerVerb(ctx, e, "Skip", gitops.SkipArgs)
		},
	},
	"stashPush": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Pop the stash to undo this."},
		Prepare: prepareStashPush,
	},
	"stashApply": {
		Undo:       gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "The stash is still in the list; discard the applied changes to undo this."},
		Prepare:    prepareStashApply,
		Reclassify: reclassifyStashPop,
	},
	"stashPop": {
		Undo:       gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "The stash was removed once applied; stash again to undo this."},
		Prepare:    prepareStashPop,
		Reclassify: reclassifyStashPop,
	},
	// stashDrop: undoable, NOT notUndoable like its four stash siblings — undo/slot.ts's own
	// UNDO_POLICY names it so, and StashDialog's own runStashDrop announcement ("undo available
	// until your next operation") already expects a real undo slot. captureStashDropUndo captures
	// the entry's own sha/message immediately before the drop; the replay is `stash store`, which
	// re-inserts it at the top of the stack under the same message.
	"stashDrop": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareStashDrop,
	},
	"stashBranch": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Delete the branch and stash again to undo this."},
		Prepare: prepareStashBranch,
	},
	// reset: undoable (D9) — the replay is mode-matched (`reset --<mode> <prev>`), captured
	// BEFORE the write, since the reflog cannot supply the mode a reset used (every reset logs
	// `reset: moving to <sha>`, soft or hard alike).
	"reset": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareReset,
	},
	// cherryPick: undoable (D9) via `reset --keep <prev>` — never `--hard`, since a pick is legal
	// with unrelated dirt already in the tree and `--keep` refuses rather than destroy it.
	// Withheld entirely for `--no-commit` (that pick moves no ref) and for a conflicting/empty
	// pick (RunOp's own `succeeded` gate drops it, no per-kind logic needed). Reclassify detects
	// F6's own EmptyCherryPick, which G17's seam could not: it needs CHERRY_PICK_HEAD, which lives
	// in the in-progress classification, never in status output.
	"cherryPick": {
		Undo:       gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare:    prepareCherryPick,
		Reclassify: reclassifyCherryPick,
	},
	// worktreeAdd: notUndoable (F8/D2) — a created worktree is a fresh directory plus a fresh
	// branch/detached checkout; "undo" would mean deleting a worktree, which is itself
	// worktreeRemove's own destructive, typed-confirmation path, never a one-click silent undo.
	"worktreeAdd": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Remove the worktree to undo this."},
		Prepare: prepareWorktreeAdd,
	},
	// worktreeRemove: notUndoable (F8) — a removed worktree's own modified/untracked files are not
	// recoverable by any git argv at all (F8's own doc comment); this is the one kind in the whole
	// opTable whose "undo" would require restoring deleted files from nowhere, so it is never
	// offered even the honest "no undo" framing a ref-only op gets — G22 D8's typed-confirmation
	// pattern (prepareWorktreeRemove) is what stands in for undo here instead.
	"worktreeRemove": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Removed worktree files cannot be recovered — there is no undo for this."},
		Prepare: prepareWorktreeRemove,
	},
	// stackSet: undoable (D10) — setting or clearing a branch's stack parent is two `git config
	// --local` writes (D2: always exactly two, always exit 0), and the undo replay is the same two
	// writes with the branch's own PRIOR values (captureStackSetUndo, gitsession/stack.go).
	"stackSet": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareStackSet,
	},
	// globalStashSave: notUndoable (D10) — it always COPIES, never drops its source, so its own
	// inverse is globalStashRemove, one click away and itself undoable; branchCreate/worktreeAdd's
	// exact precedent for "the inverse is a different, already-undoable op".
	"globalStashSave": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Remove it from the global stash to undo this."},
		Prepare: prepareGlobalStashSave,
	},
	// globalStashRemove: undoable (D11) — the cleanest undo in the whole table: the replay is an
	// EXACT single `update-ref <ref> <sha>` recreating the same ref at the same object, no
	// positional ambiguity at all (contrast stashDrop's own `stash store`, which is not guaranteed
	// to land back at the same stack index).
	"globalStashRemove": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.Undoable},
		Prepare: prepareGlobalStashRemove,
	},
}

// prepareCheckout is checkout's own Prepare, widened at G28 D3 by the auto-stash arm: when
// op.AutoStash is set, a whole-tree `stash push [-u]` argv is PREPENDED to the switch argv this
// function already built, so both run in order under RunOp's own single e.Repo.Write chain (F6) —
// there is no window in which the tree is stashed and the switch never happened. Never pops back
// (D1) — the entry stays in the stash list, tagged with the CURRENT branch via git's own reflog-
// subject convention, cross-branch apply (D5) is the deliberate, user-initiated recovery path.
func prepareCheckout(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	// D3 step 1: refuse both at once, no write at all. Guessing which the user meant would be
	// worse than asking again.
	if op.AutoStash && op.DiscardLocalChanges {
		return prepared{earlyError: &OpError{
			Kind:    "Unknown",
			Message: "Choose either discarding local changes or stashing them, not both.",
		}}, nil
	}

	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return prepared{}, err
	}
	resolved := resolveCheckoutTarget(snapshot, op.Target)
	discard := op.DiscardLocalChanges

	var switchArgv []string
	switch {
	case op.Mode == "detach" || resolved.Kind == "tag" || resolved.Kind == "sha":
		switchArgv = gitops.SwitchDetachArgs(resolved.Name, discard)
	case resolved.Kind == "remoteBranch":
		branch := localNameForRemoteBranch(resolved.Name)
		switchArgv = gitops.SwitchCreateTrackingArgs(branch, resolved.Name, discard)
	default:
		switchArgv = gitops.SwitchArgs(resolved.Name, discard)
	}

	if !op.AutoStash {
		return prepared{argvList: [][]string{switchArgv}}, nil
	}

	// D3 step 2 (F15/probe P17): a host-side in-progress re-check BEFORE any argv is built —
	// `stash push` during a conflicted merge exits non-zero with EMPTY stderr, which
	// ClassifyOpError would misclassify as Unknown. A pre-flight is advice, not a lock; a dialog
	// can sit open arbitrarily long between the pre-flight read and this write.
	statusResult, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return prepared{}, err
	}
	if inProgress != nil {
		return prepared{earlyError: &OpError{
			Kind:    "OperationInProgress",
			Message: gitpreflight.DescribeInProgress(inProgress) + " is in progress — finish or abort it before switching.",
		}}, nil
	}

	// D3 step 3: recompute dirtiness from THIS status read, never the client's claim — a stale
	// pre-flight could otherwise stash a tree that has since gone clean (probe P16: `stash push` on
	// a clean tree prints "No local changes to save" and creates no entry, which would be a
	// confusing no-op announcement). Nothing dirty -> omit the stash argv entirely.
	dirty := gitpreflight.DirtyPaths(statusResult)
	if len(dirty) == 0 {
		return prepared{argvList: [][]string{switchArgv}}, nil
	}

	// D3 step 4: derive -u server-side — the common case (tracked-only dirt) does not sweep
	// untracked build output; the untracked-blocked case cannot block without it (F5).
	includeUntracked := false
	for _, d := range dirty {
		if !d.Tracked {
			includeUntracked = true
			break
		}
	}

	// D3 step 5: the message is tagged with the CURRENT branch by git's own reflog-subject
	// convention ("On <currentBranch>: auto-stash: switching to <target>") — resolved.Name is the
	// TARGET this switch is headed to, which is what belongs in the message text itself.
	msg := gitops.AutoStashMessage(resolved.Name)
	stashArgv := gitops.StashPushArgs(&msg, includeUntracked, false, nil)
	return prepared{argvList: [][]string{stashArgv, switchArgv}}, nil
}

func prepareBranchCreate(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	if !op.Checkout {
		return prepared{argvList: [][]string{gitops.BranchCreateArgs(op.Name, op.StartPoint, op.Track)}}, nil
	}
	argvList := [][]string{gitops.BranchCreateAndSwitchArgs(op.Name, op.StartPoint)}
	if op.Track != nil {
		argvList = append(argvList, gitops.BranchSetUpstreamArgs(op.Name, *op.Track))
	}
	return prepared{argvList: argvList}, nil
}

// prepareBranchDelete is branchDelete's own Prepare, widened at G26 §10.9/D-3.12 to re-parent the
// deleted branch's own stack children onto ITS OWN parent (possibly "", if the deleted branch was
// itself not stacked) — "PR 1 merged, delete branch 1, branches 2..n now sit on main" is the single
// most common stack lifecycle event, and leaving the children pointing at a now-gone branch would
// make the feature feel broken at exactly the moment it should feel best (§10.9). The undo record
// is captured FIRST (before either the delete or the re-parent writes), widened by
// captureBranchDeleteUndo itself to also restore every child's own prior pointer.
func prepareBranchDelete(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	undo := e.captureBranchDeleteUndo(ctx, conn, connLabel, op.Name)

	argv := [][]string{gitops.BranchDeleteArgs(op.Name, op.Force)}

	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return prepared{}, err
	}
	children := stackChildrenOf(config, op.Name)
	if len(children) > 0 {
		newParent := config[op.Name].Parent
		snapshot, err := e.refsSnapshot(ctx)
		if err != nil {
			return prepared{}, err
		}
		newParentResolves := newParent != "" && resolvesAsRef(snapshot, newParent)
		for _, child := range children {
			newBase := ""
			if newParentResolves {
				res, merr := e.runAllowingExit(ctx, gitops.MergeBaseArgs(newParent, child), 0, 1)
				if merr != nil {
					return prepared{}, merr
				}
				if res.ExitCode == 0 {
					newBase = strings.TrimSpace(string(res.Stdout))
				}
			}
			argv = append(argv,
				gitops.StackConfigSetArgs(gitops.StackParentKey(child), newParent),
				gitops.StackConfigSetArgs(gitops.StackBaseKey(child), newBase),
			)
		}
	}

	return prepared{argvList: argv, undo: undo}, nil
}

// prepareBranchRename is branchRename's own Prepare, widened at G26 D1/D-3.12: `git branch -m`
// already moves the WHOLE branch.<name>.* config section for free (probe P1), which restores the
// RENAMED branch's own kirastack pointer with zero code here — but nothing in git rewrites another
// branch's OWN config that merely NAMES the old branch as ITS parent. This fix-up finds every such
// child (by the fresh stack config, never a cache) and rewrites its kirastackparent value to the
// new name, appended after the rename itself so a rename failure never leaves a half-applied fix-up.
func prepareBranchRename(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	config, err := e.rawStackConfig(ctx)
	if err != nil {
		return prepared{}, err
	}
	argv := [][]string{gitops.BranchRenameArgs(op.From, op.To)}
	for _, child := range stackChildrenOf(config, op.From) {
		argv = append(argv, gitops.StackConfigSetArgs(gitops.StackParentKey(child), op.To))
	}
	return prepared{argvList: argv}, nil
}

func prepareTagCreate(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	return prepared{argvList: [][]string{gitops.TagCreateArgs(op.Name, op.Target, op.Message, op.Force)}}, nil
}

func prepareTagDelete(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	undo := e.captureTagDeleteUndo(ctx, conn, connLabel, op.Name)
	return prepared{argvList: [][]string{gitops.TagDeleteArgs(op.Name)}, undo: undo}, nil
}

func prepareRevert(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	return prepared{argvList: [][]string{gitops.RevertArgs(op.Shas, op.Mainline, op.NoCommit)}}, nil
}

func prepareStashPush(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	return prepared{argvList: [][]string{gitops.StashPushArgs(op.Message, op.IncludeUntracked, op.KeepIndex, op.Paths)}}, nil
}

func prepareStashApply(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	return prepared{argvList: [][]string{gitops.StashApplyArgs(op.Sha, op.RestoreIndex)}}, nil
}

// stashPositionMismatch verifies `rev-parse stash@{index} == sha` immediately before a
// position-addressed write (pop/drop/branch — probe 8: none of the three can address by sha alone),
// per the contract's own "the service verifies... immediately before writing" convention
// (contract.ts:603-604). A non-nil *OpError is an early refusal — no write is ever spawned.
func stashPositionMismatch(ctx context.Context, e *RepoEntry, index int, sha string) (*OpError, error) {
	res, err := e.runAllowingExit(ctx, gitops.StashRevParseArgs(index), 0, 1)
	if err != nil {
		return nil, err
	}
	got := strings.TrimSpace(string(res.Stdout))
	if res.ExitCode != 0 || got != sha {
		return &OpError{
			Kind:    "NotFound",
			Message: fmt.Sprintf("stash@{%d} no longer matches the stash you selected — the list may have changed.", index),
		}, nil
	}
	return nil, nil
}

func prepareStashPop(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	mismatch, err := stashPositionMismatch(ctx, e, op.Index, op.Sha)
	if err != nil {
		return prepared{}, err
	}
	if mismatch != nil {
		return prepared{earlyError: mismatch}, nil
	}
	return prepared{argvList: [][]string{gitops.StashPopArgs(op.Index, op.RestoreIndex)}}, nil
}

func prepareStashDrop(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	mismatch, err := stashPositionMismatch(ctx, e, op.Index, op.Sha)
	if err != nil {
		return prepared{}, err
	}
	if mismatch != nil {
		return prepared{earlyError: mismatch}, nil
	}
	undo := e.captureStashDropUndo(ctx, conn, connLabel, op.Sha)
	return prepared{argvList: [][]string{gitops.StashDropArgs(op.Index)}, undo: undo}, nil
}

// prepareStashBranch gains its G28 D12 arm: for op.Scope == "global", there is no stack position
// to verify at all (a global entry is addressed purely by sha), so this skips
// stashPositionMismatch entirely and uses StashBranchByShaArgs — probe 8's own "given a raw sha,
// `stash branch` applies but silently never drops" finding is precisely the desired behaviour for
// a keep-forever bucket entry.
func prepareStashBranch(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	if op.Scope == porcelain.StashScopeGlobal {
		return prepared{argvList: [][]string{gitops.StashBranchByShaArgs(op.Branch, op.Sha)}}, nil
	}
	mismatch, err := stashPositionMismatch(ctx, e, op.Index, op.Sha)
	if err != nil {
		return prepared{}, err
	}
	if mismatch != nil {
		return prepared{earlyError: mismatch}, nil
	}
	return prepared{argvList: [][]string{gitops.StashBranchArgs(op.Branch, op.Index)}}, nil
}

// prepareGlobalStashSave is globalStashSave's own Prepare (D10), two sources, always COPYING and
// never dropping either one:
//
//  1. Validate label: non-empty after trim, no newline (a newline would corrupt the reflog-
//     subject-shaped line every reader of this bucket parses).
//  2. Source = the CURRENT working tree (op.Sha == ""): `git stash create <label>` through runOne
//     — a read-pool spawn that writes only loose objects and touches no ref, index or worktree
//     (probe P4), the same latitude stashPopPrediction's own `merge-tree --write-tree` already
//     takes. Empty output means a clean tree (probe P4) -> NothingToStash, no write.
//  3. Source = an EXISTING entry (op.Sha != ""): resolved fresh across BOTH buckets
//     (resolveStashEntryAnyScope) -> NotFound if absent. `commit-tree` over the source's own tree
//     and parent list under a NEW subject that PRESERVES the source's own origin-branch tag
//     (probe P23) — never re-stamped with whatever is checked out now.
//
// Either way, the one write this function ever prepares is `update-ref <ref> <newSha>` —
// idempotent (probe P10) — never a second argv, never anything that could drop the source.
func prepareGlobalStashSave(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	label := strings.TrimSpace(op.Label)
	if label == "" || strings.ContainsAny(op.Label, "\n\r") {
		return prepared{earlyError: &OpError{
			Kind:    "Unknown",
			Message: "Give the entry a label: one line, not empty.",
		}}, nil
	}

	var newSha string
	if op.Sha == "" {
		raw, err := e.runOne(ctx, gitops.StashCreateArgs(label))
		if err != nil {
			return prepared{}, err
		}
		sha := strings.TrimSpace(string(raw))
		if sha == "" {
			return prepared{earlyError: &OpError{
				Kind:    "NothingToStash",
				Message: "There are no local changes to save.",
			}}, nil
		}
		newSha = sha
	} else {
		source, err := e.resolveStashEntryAnyScope(ctx, op.Sha)
		if err != nil {
			if errors.Is(err, ErrStashNotFound) {
				return prepared{earlyError: &OpError{
					Kind:    "NotFound",
					Message: "That stash entry no longer exists — the list may have changed.",
				}}, nil
			}
			return prepared{}, err
		}
		originBranch := "(no branch)"
		if source.Branch != nil {
			originBranch = *source.Branch
		}
		parents := []string{source.BaseSha, source.IndexSha}
		if source.UntrackedSha != nil {
			parents = append(parents, *source.UntrackedSha)
		}
		message := "On " + originBranch + ": " + label
		raw, err := e.runOne(ctx, gitops.CommitTreeArgs(source.Sha+"^{tree}", parents, message))
		if err != nil {
			return prepared{}, err
		}
		sha := strings.TrimSpace(string(raw))
		if sha == "" {
			return prepared{}, fmt.Errorf("gitsession: globalStashSave: commit-tree produced no sha")
		}
		newSha = sha
	}

	return prepared{argvList: [][]string{gitops.GlobalStashSetArgs(newSha)}}, nil
}

// prepareGlobalStashRemove is globalStashRemove's own Prepare (D11) — the cleanest undo in the
// whole opTable:
//
//  1. A required existence check (GlobalStashRefExistsArgs) BEFORE the write — probe P10:
//     `update-ref -d` on an absent ref exits 0 SILENTLY, which would otherwise make "remove
//     nothing" look like a successful removal.
//  2. The undo record captured before the write: an EXACT `update-ref <ref> <sha>` replay
//     (GlobalStashSetArgs, the same builder globalStashSave's own write uses — re-creating an
//     identical ref at an identical object is idempotent, probe P10) — no positional ambiguity at
//     all, unlike stashDrop's own `stash store` replay.
//  3. The delete itself uses the expected-old-value form (GlobalStashDeleteArgs), so a concurrent
//     change to the same ref refuses rather than silently deleting whatever now sits there.
func prepareGlobalStashRemove(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	existsRaw, err := e.runOne(ctx, gitops.GlobalStashRefExistsArgs(op.Sha))
	if err != nil {
		return prepared{}, err
	}
	if strings.TrimSpace(string(existsRaw)) == "" {
		return prepared{earlyError: &OpError{
			Kind:    "NotFound",
			Message: "That global stash entry no longer exists.",
		}}, nil
	}

	// Best-effort label lookup for the undo record's own human-readable text — never fatal to the
	// removal itself; a race that drops the entry between the existence check above and this read
	// simply falls back to a short-sha label instead.
	label := shortSha7(op.Sha)
	if entries, lerr := e.GlobalStashList(ctx); lerr == nil {
		for _, entry := range entries {
			if entry.Sha == op.Sha {
				label = entry.Message
				break
			}
		}
	}

	undo := &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: "Removed global stash: " + label, RecoverySha: op.Sha,
		CreatedAt: time.Now().UnixMilli(), Replay: [][]string{gitops.GlobalStashSetArgs(op.Sha)},
		OriginConn: string(conn), OriginLabel: connLabel,
	}

	return prepared{argvList: [][]string{gitops.GlobalStashDeleteArgs(op.Sha)}, undo: undo}, nil
}

// prepareReset is reset's own Prepare (D8/D9). P10 probe 3: git itself only refuses a --soft
// reset mid-merge — --mixed/--hard succeed and silently delete MERGE_HEAD, abandoning the
// operation. This host-side gate is the ONLY thing standing between a user and that data loss,
// re-checked here immediately before the write — a pre-flight is advice, not a lock. The same
// status read doubles as the FRESH state destroys is recomputed from below (D8's second re-check)
// and the pre-write HEAD sha the undo record captures (F12).
func prepareReset(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	statusResult, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return prepared{}, err
	}
	if inProgress != nil {
		return prepared{earlyError: &OpError{
			Kind:    "OperationInProgress",
			Message: gitpreflight.DescribeInProgress(inProgress) + " is in progress — finish or abort it before resetting.",
		}}, nil
	}

	// Probe 3's bad-target guard, re-run host-side: a pre-flight's target may have since stopped
	// resolving (the ref was deleted, or never existed at all for a hand-typed sha).
	resolved, err := e.resolveCommit(ctx, op.Target)
	if err != nil {
		return prepared{}, err
	}
	if resolved == nil {
		return prepared{earlyError: &OpError{
			Kind:    "NotFound",
			Message: op.Target + " does not resolve to a commit.",
		}}, nil
	}

	// D8's second re-check: the typed confirmation is validated against destroys recomputed FRESH
	// from the status read above — never the pre-flight's possibly-stale value. A dialog can sit
	// open arbitrarily long, and the token must gate what would actually be destroyed NOW. Only
	// membership (any of the three sets non-empty) matters for this check, so no dedup is needed.
	if op.Mode == "hard" {
		dirty := gitpreflight.DirtySplit(statusResult)
		stagedNew := gitpreflight.StagedNewPaths(statusResult)
		anyDestroyed := len(dirty.Staged) > 0 || len(dirty.Unstaged) > 0 || len(stagedNew) > 0
		shortSha := resolved.Sha
		if len(shortSha) > 7 {
			shortSha = shortSha[:7]
		}
		if anyDestroyed && (op.ConfirmToken == nil || *op.ConfirmToken != shortSha) {
			return prepared{earlyError: &OpError{
				Kind:    "ConfirmationRequired",
				Message: "Type the target commit's short sha to confirm — this reset would discard uncommitted work.",
			}}, nil
		}
	}

	// D9/F9: captured BEFORE the write, so the undo's replay can match THIS reset's own mode — the
	// reflog cannot supply it (every reset logs `reset: moving to <sha>`, soft or hard alike), so
	// capture-before is the only mechanism, exactly as for branch/tag delete and stash drop.
	// F12: statusResult.Branch.OID is "" on an unborn HEAD — no undo record is captured then,
	// which is correct, since there is no commit to return to.
	var undo *gitpreflight.UndoRecord
	if statusResult.Branch.OID != "" {
		labelTarget := resolved.Subject
		if labelTarget == "" {
			labelTarget = shortSha7(resolved.Sha)
		}
		undo = &gitpreflight.UndoRecord{
			ID:          newUndoID(),
			Label:       fmt.Sprintf("Reset (%s) to %s", op.Mode, labelTarget), // F9: byte-identical, guarded by a test.
			RecoverySha: statusResult.Branch.OID,
			CreatedAt:   time.Now().UnixMilli(),
			Replay:      [][]string{gitops.ResetArgs(op.Mode, statusResult.Branch.OID)}, // MODE-MATCHED.
			OriginConn:  string(conn), OriginLabel: connLabel,
		}
	}

	// F14: op.Target passed to the write verbatim, never resolved.Sha — classifyReset's own
	// contract is that target is echoed unchanged, and the client always passes a full sha anyway.
	return prepared{argvList: [][]string{gitops.ResetArgs(op.Mode, op.Target)}, undo: undo}, nil
}

// shortSha7 truncates sha to its first 7 characters — the same convention captureTagDeleteUndo's
// neighbours and UndoRun already use, extracted here only because prepareReset needs it twice.
func shortSha7(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

// prepareCherryPick is cherryPick's own Prepare (D8/D9). Same rationale as prepareReset's own
// re-check just above — probe 3 is reset's own finding, but the gate is the same mechanism and a
// stale pre-flight is exactly as possible here (git DOES refuse a second cherry-pick mid-sequence,
// but not every in-progress kind — the host-side gate covers all of them uniformly).
func prepareCherryPick(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	statusResult, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return prepared{}, err
	}
	if inProgress != nil {
		return prepared{earlyError: &OpError{
			Kind:    "OperationInProgress",
			Message: gitpreflight.DescribeInProgress(inProgress) + " is in progress — finish or abort it before cherry-picking.",
		}}, nil
	}

	// D9: withheld entirely (nil) when op.NoCommit is true — that pick moves no ref, so there is
	// nothing a replay could restore. F12: also withheld on an unborn HEAD (OID == "").
	var undo *gitpreflight.UndoRecord
	if !op.NoCommit && statusResult.Branch.OID != "" {
		undo = &gitpreflight.UndoRecord{
			ID:          newUndoID(),
			Label:       "Undo cherry-pick of " + shortSha7(op.Sha),
			RecoverySha: statusResult.Branch.OID,
			CreatedAt:   time.Now().UnixMilli(),
			Replay:      [][]string{gitops.ResetKeepArgs(statusResult.Branch.OID)}, // --keep, never --hard (D9).
			OriginConn:  string(conn), OriginLabel: connLabel,
		}
	}

	return prepared{argvList: [][]string{gitops.CherryPickArgs(op.Sha, op.Mainline, op.NoCommit)}, undo: undo}, nil
}

// reclassifyCherryPick is cherryPick's own Reclassify (D6/F6). Probe 6: an empty pick exits
// non-zero, leaves CHERRY_PICK_HEAD set, a clean worktree and ZERO unmerged paths —
// indistinguishable from a fully-resolved pick by state files alone, and its whole message ("The
// previous cherry-pick is now empty…") goes to STDOUT, so the stderr-only table could only ever
// say Unknown. The banner offers both Continue and Skip and names which is which, rather than
// guessing.
func reclassifyCherryPick(opErr *OpError, status porcelain.StatusResult, inProgress *gitpreflight.InProgressOperation) *OpError {
	// Upstream's own guard, kept: a pick that failed for a NAMED reason (MainlineRequired,
	// Conflict, LockHeld) must never be re-labelled an empty pick just because the tree happens to
	// be clean.
	if opErr == nil || opErr.Kind != "Unknown" {
		return opErr
	}
	if inProgress == nil || inProgress.Kind != gitpreflight.InProgressCherryPick {
		return opErr
	}
	if len(gitpreflight.UnmergedPaths(status)) != 0 {
		return opErr // a genuinely conflicting pick — ClassifyOpError's "could not apply" row
		// already named it Conflict, or, if git said nothing matchable, Unknown is honest.
	}
	return &OpError{
		Kind:    "EmptyCherryPick",
		Message: "This change is already present on this branch — Skip it, or Continue to commit it anyway.",
	}
}

// reclassifyStashPop is stashPop's/stashApply's own Reclassify (D6/D7). Probe 5: a conflicting
// pop/apply writes to stdout and leaves stderr EMPTY — ClassifyOpError's stderr-only path already
// misclassified this as "Unknown"; the post-write status read-back RunOp already fetches is what
// tells a real conflict apart from every other non-zero exit here. D7: the "untracked working tree
// file" stderr pattern is shared with checkout's own blocker, so its generic
// UntrackedWouldBeOverwritten kind is remapped to the stash-specific StashUntrackedCollision here —
// the one place with the caller context (stash pop/apply) ClassifyOpError itself does not have.
// The third parameter (G22's own widening, D6) is unused here — an empty cherry-pick is the only
// kind that needs it.
func reclassifyStashPop(opErr *OpError, status porcelain.StatusResult, _ *gitpreflight.InProgressOperation) *OpError {
	if opErr == nil {
		return nil
	}
	if opErr.Kind == "UntrackedWouldBeOverwritten" {
		return &OpError{Kind: "StashUntrackedCollision", Message: opErr.Message}
	}
	if len(gitpreflight.UnmergedPaths(status)) > 0 {
		// Probe 5: the stash is ALWAYS kept on a conflicting pop/apply — never a second write, never
		// a drop. The contract's own OpErrorKind doc comment states the message says so.
		return &OpError{Kind: "StashConflict", Message: "The stash was applied with conflicts and has been kept."}
	}
	return opErr // an already-classified error (StashIndexConflict, or anything ClassifyOpError's
	// generic table caught that is not the untracked remap above) passes through unchanged.
}

// prepareSequencerVerb is opContinue/opAbort/opSkip's own shared shape: refuse (no write at all)
// when nothing is in progress, or when the in-progress kind offers no such verb; otherwise the
// one-argv write argsFor names. Shared because all three verbs' own early-refusal shape is
// identical, differing only in the argv table consulted.
func prepareSequencerVerb(
	ctx context.Context, e *RepoEntry, verb string, argsFor func(gitpreflight.InProgressKind) ([]string, bool),
) (prepared, error) {
	_, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return prepared{}, err
	}
	if inProgress == nil {
		return prepared{earlyError: &OpError{
			Kind: "Unknown", Message: fmt.Sprintf("No operation is currently in progress to %s.", strings.ToLower(verb)),
		}}, nil
	}
	argv, ok := argsFor(inProgress.Kind)
	if !ok {
		return prepared{earlyError: &OpError{
			Kind: "Unknown", Message: fmt.Sprintf("%s offers no %s.", gitpreflight.DescribeInProgress(inProgress), verb),
		}}, nil
	}
	return prepared{argvList: [][]string{argv}}, nil
}

func newUndoID() string { return uuid.NewString() }

// captureBranchDeleteUndo is undo-capture for a branch delete (probe P4), captured BEFORE the
// write: the branch's current tip sha plus every branch.<name>.* config line, replayed back in
// order on undo. Best-effort — any failure (a race with something else deleting the branch first)
// yields nil rather than aborting the delete itself.
func (e *RepoEntry) captureBranchDeleteUndo(ctx context.Context, conn ConnID, connLabel, name string) *gitpreflight.UndoRecord {
	res, err := e.runAllowingExit(ctx, gitops.BranchRevParseArgs(name), 0, 1)
	if err != nil || res.ExitCode != 0 {
		return nil
	}
	sha := strings.TrimSpace(string(res.Stdout))
	if sha == "" {
		return nil
	}

	var configLines []string
	if cfgRes, cfgErr := e.runAllowingExit(ctx, gitops.BranchConfigRegexpArgs(name), 0, 1); cfgErr == nil && cfgRes.ExitCode == 0 {
		for _, line := range strings.Split(strings.TrimSpace(string(cfgRes.Stdout)), "\n") {
			if trimmed := strings.TrimSpace(line); trimmed != "" {
				configLines = append(configLines, trimmed)
			}
		}
	}

	replay := [][]string{{"update-ref", "refs/heads/" + name, sha}}
	for _, line := range configLines {
		if idx := strings.IndexByte(line, ' '); idx != -1 {
			replay = append(replay, []string{"config", line[:idx], line[idx+1:]})
		}
	}

	// G26 §10.9/D-3.12: prepareBranchDelete re-parents this branch's own stack children onto ITS
	// parent as part of the SAME delete — so undoing the delete must also restore every child's
	// prior pointer, not just the deleted branch's own. Best-effort exactly like the read above: a
	// failure here must not abort capturing the undo for the branch's own restoration.
	if stackConfig, scErr := e.rawStackConfig(ctx); scErr == nil {
		for _, child := range stackChildrenOf(stackConfig, name) {
			oldEntry := stackConfig[child]
			replay = append(replay,
				gitops.StackConfigSetArgs(gitops.StackParentKey(child), oldEntry.Parent),
				gitops.StackConfigSetArgs(gitops.StackBaseKey(child), oldEntry.Base),
			)
		}
	}

	return &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: "Deleted branch " + name, RecoverySha: sha,
		CreatedAt: time.Now().UnixMilli(), Replay: replay,
		OriginConn: string(conn), OriginLabel: connLabel,
	}
}

// captureTagDeleteUndo is undo-capture for a tag delete (probe P3): reads the ref fresh (never the
// refs cache), immediately before the delete. The replay sha (row.ObjectID) is already the right
// value for either kind without branching on ObjectType: for an annotated tag it is the TAG
// OBJECT's own sha (still resolvable after `tag -d`, which only removes the ref); for a
// lightweight tag it already IS the commit sha, since %(objectname) on a non-annotated tag ref is
// the commit directly.
func (e *RepoEntry) captureTagDeleteUndo(ctx context.Context, conn ConnID, connLabel, name string) *gitpreflight.UndoRecord {
	raw, err := e.runOne(ctx, porcelain.SingleRefArgs("refs/tags/"+name))
	if err != nil {
		return nil
	}
	rows, err := porcelain.ParseRefRows(raw, false)
	if err != nil || len(rows) == 0 {
		return nil
	}
	row := rows[0]

	return &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: "Deleted tag " + name, RecoverySha: row.ObjectID,
		CreatedAt:  time.Now().UnixMilli(),
		Replay:     [][]string{gitops.UndoTagArgs(name, row.ObjectID)},
		OriginConn: string(conn), OriginLabel: connLabel,
	}
}

// captureStashDropUndo is undo-capture for a stash drop (undo/slot.ts's own UNDO_POLICY marks
// stashDrop undoable, unlike its four stash siblings): reads the current stash list fresh
// (never the cache — there is none here) immediately before the drop, to capture the entry's own
// message (the drop's own OpRequest carries only sha/index, not message). Best-effort — any
// failure (a race with something else already having dropped it) yields nil rather than aborting
// the drop itself, same convention captureBranchDeleteUndo/captureTagDeleteUndo already use. The
// replay is `stash store -m <message> <sha>` — re-inserts the entry at the top of the stack under
// the same message; it is not guaranteed to land back at the exact same index, the same honest
// limit branchDelete's/tagDelete's own replay carries (a ref recreated by name/tag, not by
// position).
func (e *RepoEntry) captureStashDropUndo(ctx context.Context, conn ConnID, connLabel, sha string) *gitpreflight.UndoRecord {
	entries, err := e.StashList(ctx)
	if err != nil {
		return nil
	}
	var message string
	found := false
	for _, entry := range entries {
		if entry.Sha == sha {
			message = entry.Message
			found = true
			break
		}
	}
	if !found {
		return nil
	}

	return &gitpreflight.UndoRecord{
		ID: newUndoID(), Label: "Dropped stash: " + message, RecoverySha: sha,
		CreatedAt: time.Now().UnixMilli(), Replay: [][]string{gitops.StashStoreArgs(message, sha)},
		OriginConn: string(conn), OriginLabel: connLabel,
	}
}

// runWriteArgv spawns one write argv through the repo's exclusive write gate. A cancelled ctx or a
// genuine spawn failure comes back as a real Go error (propagated by the caller, never folded into
// an OpResult); a non-zero exit that the process itself completed is classified through
// gitops.ClassifyOpError and returned as *OpError instead — op.run/undo.run's own "a git failure
// is an expected outcome with a rendering" rule (D14's own final paragraph).
func (e *RepoEntry) runWriteArgv(ctx context.Context, argv []string) (*OpError, error) {
	var opErr *OpError
	err := e.Repo.Write(ctx, func(ctx context.Context) error {
		res, rerr := gitclient.Run(ctx, e.Repo.Runner(), e.Repo.GitPath(), gitclient.Spec{
			Dir: repoWorkingDir(e.Summary), Args: argv, ReadOnly: false,
			// G8 D6: a write can invoke an interactive helper (a gpg pinentry for commit.gpgsign, a
			// custom merge driver writing to a tty) just as a remote op can — GIT_TERMINAL_PROMPT=0
			// governs git's own prompts, not theirs, so Setsid keeps this spawn off any controlling
			// terminal exactly as G7 D6 already does for remote ops.
			Setsid: true,
		})
		if ctx.Err() != nil || rerr != nil {
			return gitclient.Classify(ctx, argv, res, rerr)
		}
		if res.ExitCode != 0 {
			kind, message := gitops.ClassifyOpError(string(res.Stderr), res.ExitCode)
			opErr = &OpError{Kind: kind, Message: message}
		}
		return nil
	})
	return opErr, err
}

// RunOp is op.run's own executor (D6/D8), in this exact order:
//  0. ctx is already detached from the request by the caller (gitrpc, D8) — RunOp does not detach
//     it itself, it only ever sees the already-detached one.
//  1. spec, ok := opTable[op.Kind]; !ok -> ErrUnservedOpKind (D5).
//  2. prepared, err := spec.Prepare(...) — argv, and the undo record CAPTURED FIRST, before any
//     write. earlyError short-circuits with no write ever spawned.
//  3. Each argv is written in order through e.Repo.Write (F12: cross-connection serial) — the
//     first classified failure stops the remaining argv (there is at most one entry beyond the
//     first for any kind this phase serves, so this only matters for branchCreate+track).
//  4. Read back head + in-progress state, ALWAYS — success or failure (a conflicting revert fails
//     with Conflict and LEAVES REVERT_HEAD; this is what surfaces it here rather than a watcher
//     tick).
//  5. slot.Set(record) iff the write succeeded AND opTable[kind].Undo is undoable — consulting the
//     table, not merely whether Prepare happened to build a record, is what keeps the policy in one
//     place (D6).
//  6. Return OpResult{ok, error, undo (attributed for conn), head, inProgress}.
func (e *RepoEntry) RunOp(ctx context.Context, conn ConnID, connLabel string, op OpRequest) (OpResult, error) {
	spec, ok := opTable[op.Kind]
	if !ok {
		return OpResult{}, ErrUnservedOpKind{Kind: op.Kind}
	}

	prep, err := spec.Prepare(ctx, e, conn, connLabel, op)
	if err != nil {
		return OpResult{}, err
	}

	if prep.earlyError != nil {
		e.undo.Set(nil)
		_, inProgress, serr := e.statusAndInProgress(ctx)
		if serr != nil {
			return OpResult{}, serr
		}
		head, herr := e.Head(ctx)
		if herr != nil {
			return OpResult{}, herr
		}
		return OpResult{OK: false, Error: prep.earlyError, Undo: nil, Head: head, InProgress: inProgress}, nil
	}

	// D7: drops the shared caches synchronously once a write has actually been attempted, on EVERY
	// exit path below (success, a classified failure, a genuine spawn error) — a half-applied write
	// invalidates just as much as a whole one, and the watcher's own debounced signal must not be
	// the only thing that ever notices our own write.
	defer e.invalidateAfterWrite()

	var opErr *OpError
	for _, argv := range prep.argvList {
		oe, werr := e.runWriteArgv(ctx, argv)
		if werr != nil {
			return OpResult{}, werr
		}
		if oe != nil {
			opErr = oe
			break
		}
	}
	statusResult, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return OpResult{}, serr
	}
	// D6: reuses the status read RunOp already performs (the line above) — no second spawn — to let
	// a kind reclassify its own stderr-only result. A nil Reclassify (ten of fifteen kinds today) is
	// a no-op by construction.
	if spec.Reclassify != nil {
		opErr = spec.Reclassify(opErr, statusResult, inProgress)
	}
	succeeded := opErr == nil

	head, herr := e.Head(ctx)
	if herr != nil {
		return OpResult{}, herr
	}

	var record *gitpreflight.UndoRecord
	if succeeded && spec.Undo.Kind == gitpreflight.Undoable {
		record = prep.undo
	}
	e.undo.Set(record)

	var undoSnapshot *gitpreflight.UndoSlotSnapshot
	if record != nil {
		snap := record.SnapshotFor(string(conn))
		undoSnapshot = &snap
	}

	return OpResult{OK: succeeded, Error: opErr, Undo: undoSnapshot, Head: head, InProgress: inProgress}, nil
}

// UndoPeek is undo.peek's own query — the current slot, attributed for conn (D7's SnapshotFor), or
// nil. Never mutates the slot.
func (e *RepoEntry) UndoPeek(conn ConnID) *gitpreflight.UndoSlotSnapshot {
	record := e.undo.Peek()
	if record == nil {
		return nil
	}
	snap := record.SnapshotFor(string(conn))
	return &snap
}

// UndoRun is undo.run's own executor: Take(id) (so a replayed undo cannot be replayed twice, and a
// stale/already-superseded id answers NotFound), then a recovery-sha existence check through the
// entry's own cat-file batch session (§7.12's "so the user can recover manually even after the
// slot is cleared" only holds if a stale sha is refused rather than replayed against something
// else), then the replay argv list in order — the same read-back/error-mapping shape as RunOp.
func (e *RepoEntry) UndoRun(ctx context.Context, id string) (OpResult, error) {
	record := e.undo.Take(id)
	if record == nil {
		return e.undoRunFailure(ctx, "NotFound", "This undo is no longer available.")
	}

	session := e.CatFile()
	if session == nil {
		return OpResult{}, ErrRepoTornDown
	}
	if _, err := session.Check(record.RecoverySha + "^{commit}"); err != nil {
		if errors.Is(err, catfile.ErrMissing) {
			short := record.RecoverySha
			if len(short) > 7 {
				short = short[:7]
			}
			return e.undoRunFailure(ctx, "NotFound", fmt.Sprintf("The recovered commit %s no longer exists.", short))
		}
		return OpResult{}, err
	}

	var opErr *OpError
	for _, argv := range record.Replay {
		oe, werr := e.runWriteArgv(ctx, argv)
		if werr != nil {
			return OpResult{}, werr
		}
		if oe != nil {
			opErr = oe
			break
		}
	}

	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return OpResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return OpResult{}, herr
	}

	return OpResult{OK: opErr == nil, Error: opErr, Undo: nil, Head: head, InProgress: inProgress}, nil
}

func (e *RepoEntry) undoRunFailure(ctx context.Context, kind, message string) (OpResult, error) {
	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return OpResult{}, serr
	}
	head, herr := e.Head(ctx)
	if herr != nil {
		return OpResult{}, herr
	}
	return OpResult{OK: false, Error: &OpError{Kind: kind, Message: message}, Undo: nil, Head: head, InProgress: inProgress}, nil
}
