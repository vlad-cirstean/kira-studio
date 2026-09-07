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

// OpRequest is op.run's own request — the Go decode of @kira/git-ipc's own nineteen-member
// OpRequest union, flattened into one struct (a field absent from the wire JSON for a given kind
// simply decodes to its zero value, which no served kind's Prepare function ever reads). Only
// fields the ten kinds G5 serves actually need are declared — the nine unserved kinds' own fields
// (stash/reset/cherryPick) are never decoded at all, since opTable rejects those kinds before any
// field is read (D5).
type OpRequest struct {
	Kind string `json:"kind"`

	Target              string `json:"target,omitempty"` // checkout, tagCreate
	Mode                string `json:"mode,omitempty"`   // checkout: "switch" | "detach"
	DiscardLocalChanges bool   `json:"discardLocalChanges,omitempty"`

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

// ErrUnservedOpKind is RunOp's answer for an OpRequest.Kind not present in opTable (D5) — nine of
// OpRequest's nineteen kinds, each owned by a later phase (G7's tagPush/tagDeleteRemote, G12's
// five stash kinds, G13's reset/cherryPick). gitrpc maps this to E_UNKNOWN_METHOD naming the kind
// — never a stub, never a silent success.
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
}

// opTable serves exactly ten of OpRequest's nineteen kinds (D5) — the other nine answer
// ErrUnservedOpKind, never a stub. Labels are ported verbatim from undo/slot.ts's own UNDO_POLICY
// for the ten kinds here; G7/G12/G13 each add one entry beside these with no rework.
var opTable = map[string]opSpec{
	"checkout": {
		Undo:    gitpreflight.UndoPolicy{Kind: gitpreflight.NotUndoable, Reason: "Switch back to the previous ref to undo this."},
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
}

func prepareCheckout(ctx context.Context, e *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	snapshot, err := e.refsSnapshot(ctx)
	if err != nil {
		return prepared{}, err
	}
	resolved := resolveCheckoutTarget(snapshot, op.Target)
	discard := op.DiscardLocalChanges

	willDetach := op.Mode == "detach" || resolved.Kind == "tag" || resolved.Kind == "sha"
	if willDetach {
		return prepared{argvList: [][]string{gitops.SwitchDetachArgs(resolved.Name, discard)}}, nil
	}
	if resolved.Kind == "remoteBranch" {
		branch := localNameForRemoteBranch(resolved.Name)
		return prepared{argvList: [][]string{gitops.SwitchCreateTrackingArgs(branch, resolved.Name, discard)}}, nil
	}
	return prepared{argvList: [][]string{gitops.SwitchArgs(resolved.Name, discard)}}, nil
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

func prepareBranchDelete(ctx context.Context, e *RepoEntry, conn ConnID, connLabel string, op OpRequest) (prepared, error) {
	undo := e.captureBranchDeleteUndo(ctx, conn, connLabel, op.Name)
	return prepared{argvList: [][]string{gitops.BranchDeleteArgs(op.Name, op.Force)}, undo: undo}, nil
}

func prepareBranchRename(_ context.Context, _ *RepoEntry, _ ConnID, _ string, op OpRequest) (prepared, error) {
	return prepared{argvList: [][]string{gitops.BranchRenameArgs(op.From, op.To)}}, nil
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
	succeeded := opErr == nil

	_, inProgress, serr := e.statusAndInProgress(ctx)
	if serr != nil {
		return OpResult{}, serr
	}
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

	if _, err := e.CatFile().Check(record.RecoverySha + "^{commit}"); err != nil {
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
