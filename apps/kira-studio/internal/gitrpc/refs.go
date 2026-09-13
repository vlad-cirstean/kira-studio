package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// refs.list, status.get, preflight.checkout and preflight.revert — thin dispatch (D20): decode
// params, resolve c's held RepoEntry, call one RepoEntry method, marshal. All four are reads, so
// none of them detach ctx (D8 — that's op.run/undo.run's own concern, ops.go).

func (r *Router) handleRefsList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RefsListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: refs.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: refs.list: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.Refs(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleStatusGet(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StatusGetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: status.get: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: status.get: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.Status(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightCheckout(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightCheckoutParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.checkout: invalid params")
	}
	if p.RepoID == "" || p.Target == "" || (p.Mode != "switch" && p.Mode != "detach") {
		return nil, ipcerr.BadRequest("gitrpc: preflight.checkout: repoId, target and a valid mode are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightCheckout(ctx, p.Target, p.Mode)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightRevert(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightRevertParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.revert: invalid params")
	}
	if p.RepoID == "" || len(p.Shas) == 0 {
		return nil, ipcerr.BadRequest("gitrpc: preflight.revert: repoId and a non-empty shas are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightRevert(ctx, p.Shas, p.Mainline)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}
