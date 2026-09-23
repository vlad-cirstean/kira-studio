package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// refs.list, status.get, preflight.checkout and preflight.revert — thin dispatch (D20): decode
// params, resolve c's held RepoEntry, call one RepoEntry method, marshal. All four are reads, so
// none of them detach ctx (D8 — that's op.run/undo.run's own concern, ops.go).

func (r *Router) handleRefsList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "refs.list", params,
		func(p RefsListParams) (string, error) {
			if p.RepoID == "" {
				return "", ipcerr.BadRequest("gitrpc: refs.list: repoId is required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ RefsListParams) (gitsession.RefsResult, error) {
			result, err := entry.Refs(ctx)
			if err != nil {
				return gitsession.RefsResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleStatusGet(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "status.get", params,
		func(p StatusGetParams) (string, error) {
			if p.RepoID == "" {
				return "", ipcerr.BadRequest("gitrpc: status.get: repoId is required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ StatusGetParams) (gitpreflight.StatusSummary, error) {
			result, err := entry.Status(ctx)
			if err != nil {
				return gitpreflight.StatusSummary{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightCheckout(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.checkout", params,
		func(p PreflightCheckoutParams) (string, error) {
			if p.RepoID == "" || p.Target == "" || (p.Mode != "switch" && p.Mode != "detach") {
				return "", ipcerr.BadRequest("gitrpc: preflight.checkout: repoId, target and a valid mode are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightCheckoutParams) (gitpreflight.CheckoutPreflight, error) {
			result, err := entry.PreflightCheckout(ctx, p.Target, p.Mode)
			if err != nil {
				return gitpreflight.CheckoutPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightRevert(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.revert", params,
		func(p PreflightRevertParams) (string, error) {
			if p.RepoID == "" || len(p.Shas) == 0 {
				return "", ipcerr.BadRequest("gitrpc: preflight.revert: repoId and a non-empty shas are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightRevertParams) (gitpreflight.RevertPreflight, error) {
			result, err := entry.PreflightRevert(ctx, p.Shas, p.Mainline)
			if err != nil {
				return gitpreflight.RevertPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}
