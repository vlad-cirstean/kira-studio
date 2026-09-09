package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// stash.list, stash.show, preflight.stashPop and preflight.stashBranch — thin dispatch (D20,
// matching refs.go's own shape for this exact category of handler): decode params, resolve c's
// held RepoEntry, call one RepoEntry method, marshal. All four are reads, so none of them detach
// ctx (D8 — that's op.run/undo.run's own concern, ops.go).

func (r *Router) handleStashList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StashListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: stash.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: stash.list: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	entries, err := entry.StashList(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return StashListResult{Entries: entries}, nil
}

// mapStashError maps gitsession.ErrStashNotFound — a caller mistake or a genuine race (the stack
// changed between an earlier stash.list and this call) — to E_BAD_REQUEST, the same "the caller's
// own data is now stale" treatment mapDetailError already gives its own closed error vocabulary;
// anything else falls through to mapGitError.
func mapStashError(err error) error {
	if errors.Is(err, gitsession.ErrStashNotFound) {
		return ipcerr.BadRequest("gitrpc: no stash entry matches this sha")
	}
	return mapGitError(err)
}

func (r *Router) handleStashShow(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p StashShowParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: stash.show: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" {
		return nil, ipcerr.BadRequest("gitrpc: stash.show: repoId and sha are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.StashShow(ctx, p.SHA, "") // G28 step 11 wires p.Scope through
	if err != nil {
		return nil, mapStashError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightStashPop(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightStashPopParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashPop: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashPop: repoId and sha are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightStashPop(ctx, p.SHA, p.TargetSHA, "") // G28 step 11 wires p.Scope through
	if err != nil {
		return nil, mapStashError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightStashBranch(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightStashBranchParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashBranch: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" || p.Branch == "" {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashBranch: repoId, sha and branch are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightStashBranch(ctx, p.SHA, p.Branch, "") // G28 step 11 wires p.Scope through
	if err != nil {
		return nil, mapStashError(err)
	}
	return result, nil
}
