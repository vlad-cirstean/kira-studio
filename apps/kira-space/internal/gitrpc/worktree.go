package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpath"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
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
	return handleRepoCall(ctx, c, "worktree.list", params,
		func(p WorktreeListParams) (string, error) {
			if err := requireNonEmpty("worktree.list", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ WorktreeListParams) (WorktreeListResult, error) {
			list, err := entry.Worktrees(ctx)
			if err != nil {
				return WorktreeListResult{}, mapGitError(err)
			}
			return WorktreeListResult{Worktrees: list}, nil
		},
	)
}

func (r *Router) handlePreflightWorktreeAdd(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.worktreeAdd", params,
		func(p PreflightWorktreeAddParams) (string, error) {
			if p.RepoID == "" || p.Path == "" || (p.Mode != "existingBranch" && p.Mode != "newBranch" && p.Mode != "detach") {
				return "", ipcerr.BadRequest("gitrpc: preflight.worktreeAdd: repoId, path and a valid mode are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightWorktreeAddParams) (gitpreflight.WorktreeAddPreflight, error) {
			path := gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
			result, err := entry.WorktreeAddPreflight(ctx, gitsession.WorktreeAddParams{
				Path: path, Mode: p.Mode, Branch: p.Branch, StartPoint: p.StartPoint,
			})
			if err != nil {
				return gitpreflight.WorktreeAddPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightWorktreeRemove(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.worktreeRemove", params,
		func(p PreflightWorktreeRemoveParams) (string, error) {
			if err := requireNonEmpty("preflight.worktreeRemove", "repoId", p.RepoID, "path", p.Path); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightWorktreeRemoveParams) (gitpreflight.WorktreeRemovePreflight, error) {
			path := gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
			result, err := entry.WorktreeRemovePreflight(ctx, path)
			if err != nil {
				return gitpreflight.WorktreeRemovePreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

// handleWorktreePrepare detaches ctx (D13/G7 D19's precedent) — the spawn itself is bound to its
// OWN internally-derived, killable context (gitsession.RunPrepare's own opCtx), never to this
// request's. Runner is left nil in WorktreePrepareDeps: RunPrepare's own default
// (gitprepare.NewOSRunner()) is exactly what production wants, and this file stays free of an
// internal/gitprepare import it would otherwise need only for that one default.
func (r *Router) handleWorktreePrepare(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "worktree.prepare", params,
		func(p WorktreePrepareParams) (string, error) {
			if err := requireNonEmpty("worktree.prepare", "repoId", p.RepoID, "path", p.Path, "scriptSha256", p.ScriptSha256); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p WorktreePrepareParams) (gitsession.WorktreePrepareResult, error) {
			path := gitpath.CleanNFC(p.Path) // G27 D5d: a client-supplied directory param (D2 tier 1).
			result, err := entry.RunPrepare(context.WithoutCancel(ctx), c, path, p.ScriptSha256, gitsession.WorktreePrepareDeps{})
			if err != nil {
				return gitsession.WorktreePrepareResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleWorktreeCancelPrepare(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "worktree.cancelPrepare", params,
		func(p WorktreeCancelPrepareParams) (string, error) {
			if err := requireNonEmpty("worktree.cancelPrepare", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(_ context.Context, entry *gitsession.RepoEntry, _ WorktreeCancelPrepareParams) (WorktreeCancelPrepareResult, error) {
			return WorktreeCancelPrepareResult{Cancelled: entry.CancelPrepare()}, nil
		},
	)
}
