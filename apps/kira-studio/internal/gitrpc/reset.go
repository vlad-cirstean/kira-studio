package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// preflight.reset and preflight.cherryPick — thin dispatch (D20, matching refs.go's own shape for
// this exact category of handler): decode params, resolve c's held RepoEntry, call one RepoEntry
// method, marshal. Both are reads, so neither detaches ctx (D8 — that's op.run/undo.run's own
// concern, ops.go).

func (r *Router) handlePreflightReset(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightResetParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.reset: invalid params")
	}
	if p.RepoID == "" || p.Target == "" || (p.Mode != "soft" && p.Mode != "mixed" && p.Mode != "hard") {
		return nil, ipcerr.BadRequest("gitrpc: preflight.reset: repoId, target and a valid mode are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightReset(ctx, p.Target, p.Mode)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightCherryPick(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightCherryPickParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.cherryPick: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" {
		return nil, ipcerr.BadRequest("gitrpc: preflight.cherryPick: repoId and sha are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightCherryPick(ctx, p.SHA, p.Mainline)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}
