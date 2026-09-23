package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// preflight.reset and preflight.cherryPick — thin dispatch (D20, matching refs.go's own shape for
// this exact category of handler): decode params, resolve c's held RepoEntry, call one RepoEntry
// method, marshal. Both are reads, so neither detaches ctx (D8 — that's op.run/undo.run's own
// concern, ops.go).

func (r *Router) handlePreflightReset(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.reset", params,
		func(p PreflightResetParams) (string, error) {
			if p.RepoID == "" || p.Target == "" || (p.Mode != "soft" && p.Mode != "mixed" && p.Mode != "hard") {
				return "", ipcerr.BadRequest("gitrpc: preflight.reset: repoId, target and a valid mode are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightResetParams) (gitpreflight.ResetPreflight, error) {
			result, err := entry.PreflightReset(ctx, p.Target, p.Mode)
			if err != nil {
				return gitpreflight.ResetPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightCherryPick(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.cherryPick", params,
		func(p PreflightCherryPickParams) (string, error) {
			if err := requireNonEmpty("preflight.cherryPick", "repoId", p.RepoID, "sha", p.SHA); err != nil {
				return "", err
			}
			// F1 (P108 Part 16 review), defense in depth: sha reaches isAncestorOrNot/
			// MergeTreeArgs/CommitDetail as a bare argv token (gitsession.PreflightCherryPick
			// already guards it — this is the second layer at the boundary).
			if err := validRefArg("sha", p.SHA); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightCherryPickParams) (gitpreflight.CherryPickPreflight, error) {
			result, err := entry.PreflightCherryPick(ctx, p.SHA, p.Mainline)
			if err != nil {
				return gitpreflight.CherryPickPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}
