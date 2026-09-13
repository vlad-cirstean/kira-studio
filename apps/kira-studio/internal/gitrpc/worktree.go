package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// G25 — worktree support (D1-D14). worktree.list/preflight.worktreeAdd/preflight.worktreeRemove
// are reads and stay on the request ctx, matching refs.go/reset.go's own shape for this category of
// handler. worktree.prepare detaches (D13, the SAME reasoning remote.run's own doc comment states,
// G7 D19 applied again): a script already running must never be killed by a client disconnect or a
// bare `cancel` frame — worktree.cancelPrepare is the one deliberate, in-band way to end it early,
// exactly like remote.cancel. worktree.cancelPrepare is a fast, synchronous state mutation and
// needs no detaching of its own. worktree.openWindow is NOT handled here at all — it is answered
// entirely inside the extension (D6), the same "editor.*-shaped" precedent editor.openDiff/
// editor.openRangeDiff already set: the Go server has no handler for it, and never sees it in
// practice (proxyHandlers.ts intercepts and answers it before the request ever reaches this
// server).

func (r *Router) handleWorktreeList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p WorktreeListParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: worktree.list: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: worktree.list: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	list, err := entry.Worktrees(ctx)
	if err != nil {
		return nil, mapGitError(err)
	}
	return WorktreeListResult{Worktrees: list}, nil
}

func (r *Router) handlePreflightWorktreeAdd(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightWorktreeAddParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.worktreeAdd: invalid params")
	}
	if p.RepoID == "" || p.Path == "" || (p.Mode != "existingBranch" && p.Mode != "newBranch" && p.Mode != "detach") {
		return nil, ipcerr.BadRequest("gitrpc: preflight.worktreeAdd: repoId, path and a valid mode are required")
	}
	p.Path = gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.WorktreeAddPreflight(ctx, gitsession.WorktreeAddParams{
		Path: p.Path, Mode: p.Mode, Branch: p.Branch, StartPoint: p.StartPoint,
	})
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handlePreflightWorktreeRemove(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p PreflightWorktreeRemoveParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: preflight.worktreeRemove: invalid params")
	}
	if p.RepoID == "" || p.Path == "" {
		return nil, ipcerr.BadRequest("gitrpc: preflight.worktreeRemove: repoId and path are required")
	}
	p.Path = gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.WorktreeRemovePreflight(ctx, p.Path)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

// handleWorktreePrepare detaches ctx (D13/G7 D19's precedent) — the spawn itself is bound to its
// OWN internally-derived, killable context (gitsession.RunPrepare's own opCtx), never to this
// request's. Runner is left nil in WorktreePrepareDeps: RunPrepare's own default
// (gitprepare.NewOSRunner()) is exactly what production wants, and this file stays free of an
// internal/gitprepare import it would otherwise need only for that one default.
func (r *Router) handleWorktreePrepare(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p WorktreePrepareParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: worktree.prepare: invalid params")
	}
	if p.RepoID == "" || p.Path == "" || p.ScriptSha256 == "" {
		return nil, ipcerr.BadRequest("gitrpc: worktree.prepare: repoId, path and scriptSha256 are required")
	}
	p.Path = gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.RunPrepare(context.WithoutCancel(ctx), c, p.Path, p.ScriptSha256, gitsession.WorktreePrepareDeps{})
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleWorktreeCancelPrepare(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p WorktreeCancelPrepareParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: worktree.cancelPrepare: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: worktree.cancelPrepare: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return WorktreeCancelPrepareResult{Cancelled: entry.CancelPrepare()}, nil
}
