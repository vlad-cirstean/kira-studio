package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// op.run and undo.run are G5's two write methods — both run RunOp/UndoRun under
// context.WithoutCancel (D8): a write already in flight must never be killed by a client
// disconnect or a `cancel` frame, because head/undo/refs are SHARED state a second window might
// read, and the post-op read-back is part of that same detached unit, not just the write itself.
// undo.peek is a read and stays on the request ctx.

func (r *Router) handleOpRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "op.run", params,
		func(p OpRunParams) (string, error) {
			if p.RepoID == "" || p.Op.Kind == "" {
				return "", ipcerr.BadRequest("gitrpc: op.run: repoId and op.kind are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p OpRunParams) (gitsession.OpResult, error) {
			result, err := entry.RunOp(context.WithoutCancel(ctx), c.ID, c.ClientLabel, p.Op)
			if err != nil {
				var unserved gitsession.ErrUnservedOpKind
				if errors.As(err, &unserved) {
					// D5: an unserved kind names itself in the error, never a stub and never a
					// silent success — the same E_UNKNOWN_METHOD code the router already answers
					// with for a method it does not serve at all.
					return gitsession.OpResult{}, ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: op.run: "+unserved.Kind+" is not served yet")
				}
				if errors.Is(err, gitsession.ErrInvalidResetMode) {
					return gitsession.OpResult{}, ipcerr.BadRequest("gitrpc: op.run: " + err.Error())
				}
				// G32 round-3 architecture/security review, finding #4: validOpArg's own refusals
				// (ops.go) are client input errors, exactly like ErrInvalidResetMode just above —
				// never a git spawn failure for mapGitError's own table to classify.
				if errors.Is(err, gitsession.ErrInvalidOpArg) {
					return gitsession.OpResult{}, ipcerr.BadRequest("gitrpc: op.run: " + err.Error())
				}
				return gitsession.OpResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleUndoPeek(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "undo.peek", params,
		func(p UndoPeekParams) (string, error) {
			if err := requireNonEmpty("undo.peek", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(_ context.Context, entry *gitsession.RepoEntry, _ UndoPeekParams) (UndoPeekResult, error) {
			return UndoPeekResult{Slot: entry.UndoPeek(c.ID)}, nil
		},
	)
}

func (r *Router) handleUndoRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "undo.run", params,
		func(p UndoRunParams) (string, error) {
			if err := requireNonEmpty("undo.run", "repoId", p.RepoID, "id", p.ID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p UndoRunParams) (gitsession.OpResult, error) {
			result, err := entry.UndoRun(context.WithoutCancel(ctx), p.ID)
			if err != nil {
				return gitsession.OpResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}
