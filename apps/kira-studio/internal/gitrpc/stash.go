package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// stash.list, stash.show, preflight.stashPop, preflight.stashBranch and G28's own globalStash.list
// — thin dispatch (D20, matching refs.go's own shape for this exact category of handler): decode
// params, resolve c's held RepoEntry, call one RepoEntry method, marshal. All five are reads, so
// none of them detach ctx (D8 — that's op.run/undo.run's own concern, ops.go).

// validStashScope is G28 D17's own closed vocabulary for the three widened requests' Scope param:
// "" and "stack" both mean the ordinary stack (D12 — every pre-G28 caller keeps its exact
// meaning), "global" means the bucket. Anything else is a caller mistake, refused before any spawn.
func validStashScope(scope string) bool {
	return scope == "" || scope == "stack" || scope == "global"
}

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
	if !validStashScope(p.Scope) {
		return nil, ipcerr.BadRequest("gitrpc: stash.show: invalid scope " + p.Scope)
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.StashShow(ctx, p.SHA, p.Scope)
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
	if !validStashScope(p.Scope) {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashPop: invalid scope " + p.Scope)
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightStashPop(ctx, p.SHA, p.TargetSHA, p.Scope)
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
	if !validStashScope(p.Scope) {
		return nil, ipcerr.BadRequest("gitrpc: preflight.stashBranch: invalid scope " + p.Scope)
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PreflightStashBranch(ctx, p.SHA, p.Branch, p.Scope)
	if err != nil {
		return nil, mapStashError(err)
	}
	return result, nil
}

// handleGlobalStashList is globalStash.list's own dispatch (G28 D9/D17) — the bucket's own
// listing, reusing StashListResult verbatim (D17: zero new wire interfaces — the shape `{entries:
// StashEntry[]}` is already exactly what stash.list answers).
func (r *Router) handleGlobalStashList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p GlobalStashListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: globalStash.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: globalStash.list: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	entries, err := entry.GlobalStashList(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return StashListResult{Entries: entries}, nil
}
