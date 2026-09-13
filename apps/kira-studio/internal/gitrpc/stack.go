package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// G26 — stack.list/preflight.restack are reads and stay on the request ctx, matching refs.go/
// worktree.go's own shape for this category of handler. stack.restack detaches (D6/G5 D8's
// precedent, applied again exactly as remote.run/worktree.prepare already do): a restack already
// running must never be killed by a client disconnect or a bare `cancel` frame —
// stack.cancelRestack is the one deliberate, in-band way to end it early. stack.cancelRestack is a
// fast, synchronous state mutation and needs no detaching of its own. stackSet itself needs no
// handler here at all — it is an ordinary opTable kind (D10), already served by op.run/undo.run.

func (r *Router) handleStackList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StackListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: stack.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: stack.list: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.Stacks(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightRestack(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightRestackParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.restack: invalid params")
	}
	if p.RepoID == "" || p.Branch == "" {
		return nil, ipcerr.BadRequest("gitrpc: preflight.restack: repoId and branch are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.RestackPreflight(ctx, p.Branch)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

// handleStackRestack detaches ctx (D6/G5 D8's precedent) — the per-branch rebase spawns themselves
// are bound to RunRestack's OWN internally-derived, killable-between-branches context (opCtx), never
// to this request's; stack.cancelRestack is what ends that one early.
func (r *Router) handleStackRestack(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StackRestackParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: stack.restack: invalid params")
	}
	if p.RepoID == "" || p.Branch == "" {
		return nil, ipcerr.BadRequest("gitrpc: stack.restack: repoId and branch are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.RunRestack(context.WithoutCancel(ctx), c, p.Branch)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleStackCancelRestack(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StackCancelRestackParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: stack.cancelRestack: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: stack.cancelRestack: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return StackCancelRestackResult{Cancelled: entry.CancelRestack()}, nil
}
