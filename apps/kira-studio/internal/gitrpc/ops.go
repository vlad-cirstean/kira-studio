package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// op.run and undo.run are G5's two write methods — both run RunOp/UndoRun under
// context.WithoutCancel (D8): a write already in flight must never be killed by a client
// disconnect or a `cancel` frame, because head/undo/refs are SHARED state a second window might
// read, and the post-op read-back is part of that same detached unit, not just the write itself.
// undo.peek is a read and stays on the request ctx.

func (r *Router) handleOpRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p OpRunParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: op.run: invalid params")
	}
	if p.RepoID == "" || p.Op.Kind == "" {
		return nil, ipcerr.BadRequest("gitrpc: op.run: repoId and op.kind are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}

	result, err := entry.RunOp(context.WithoutCancel(ctx), c.ID, c.ClientLabel, p.Op)
	if err != nil {
		var unserved gitsession.ErrUnservedOpKind
		if errors.As(err, &unserved) {
			// D5: an unserved kind names itself in the error, never a stub and never a silent
			// success — the same E_UNKNOWN_METHOD code the router already answers with for a
			// method it does not serve at all.
			return nil, ipcerr.New("E_UNKNOWN_METHOD", "gitrpc: op.run: "+unserved.Kind+" is not served yet")
		}
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleUndoPeek(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p UndoPeekParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: undo.peek: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: undo.peek: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return UndoPeekResult{Slot: entry.UndoPeek(c.ID)}, nil
}

func (r *Router) handleUndoRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p UndoRunParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: undo.run: invalid params")
	}
	if p.RepoID == "" || p.ID == "" {
		return nil, ipcerr.BadRequest("gitrpc: undo.run: repoId and id are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.UndoRun(context.WithoutCancel(ctx), p.ID)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}
