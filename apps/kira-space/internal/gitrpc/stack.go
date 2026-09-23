package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// G26 — stack.list/preflight.restack are reads and stay on the request ctx, matching refs.go/
// worktree.go's own shape for this category of handler. stack.restack detaches (D6/G5 D8's
// precedent, applied again exactly as remote.run/worktree.prepare already do): a restack already
// running must never be killed by a client disconnect or a bare `cancel` frame —
// stack.cancelRestack is the one deliberate, in-band way to end it early. stack.cancelRestack is a
// fast, synchronous state mutation and needs no detaching of its own. stackSet itself needs no
// handler here at all — it is an ordinary opTable kind (D10), already served by op.run/undo.run.

func (r *Router) handleStackList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "stack.list", params,
		func(p StackListParams) (string, error) {
			if p.RepoID == "" {
				return "", ipcerr.BadRequest("gitrpc: stack.list: repoId is required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ StackListParams) (gitpreflight.StackListResult, error) {
			result, err := entry.Stacks(ctx)
			if err != nil {
				return gitpreflight.StackListResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightRestack(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.restack", params,
		func(p PreflightRestackParams) (string, error) {
			if p.RepoID == "" || p.Branch == "" {
				return "", ipcerr.BadRequest("gitrpc: preflight.restack: repoId and branch are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightRestackParams) (gitpreflight.RestackPreflight, error) {
			result, err := entry.RestackPreflight(ctx, p.Branch)
			if err != nil {
				return gitpreflight.RestackPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

// handleStackRestack detaches ctx (D6/G5 D8's precedent) — the per-branch rebase spawns themselves
// are bound to RunRestack's OWN internally-derived, killable-between-branches context (opCtx), never
// to this request's; stack.cancelRestack is what ends that one early. RunRestack also needs c
// itself (not just the entry it resolves through), so the call closure captures it directly rather
// than handleRepoCall threading it through — the one handler here that isn't pure entry+params.
func (r *Router) handleStackRestack(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "stack.restack", params,
		func(p StackRestackParams) (string, error) {
			if p.RepoID == "" || p.Branch == "" {
				return "", ipcerr.BadRequest("gitrpc: stack.restack: repoId and branch are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p StackRestackParams) (gitsession.RestackResult, error) {
			result, err := entry.RunRestack(context.WithoutCancel(ctx), c, p.Branch)
			if err != nil {
				return gitsession.RestackResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
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
