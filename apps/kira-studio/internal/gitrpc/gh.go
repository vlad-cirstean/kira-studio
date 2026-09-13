package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// handleCommitResolvePr is commit.resolvePr's own handler (D9 step 2-3) — a thin projection of
// (*gitsession.RepoEntry).ResolveCommitPr onto the wire's own PrLookupResult. Never returns an RPC
// error for a GitHub-side failure (D1's own "Client never returns an error", carried all the way
// to the wire): the only errors this can produce are the ordinary "bad request"/"repo not held"
// ones every other per-repo method already has.
func (r *Router) handleCommitResolvePr(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p CommitResolvePrParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: commit.resolvePr: invalid params")
	}
	if p.RepoID == "" || p.SHA == "" {
		return nil, ipcerr.BadRequest("gitrpc: commit.resolvePr: repoId and sha are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return prLookupResultFrom(entry.ResolveCommitPr(ctx, p.SHA)), nil
}

// handleBranchResolvePr is branch.resolvePr's own handler (D8) — same shape as
// handleCommitResolvePr above, over (*gitsession.RepoEntry).ResolveBranchPr.
func (r *Router) handleBranchResolvePr(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p BranchResolvePrParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: branch.resolvePr: invalid params")
	}
	if p.RepoID == "" || p.Branch == "" {
		return nil, ipcerr.BadRequest("gitrpc: branch.resolvePr: repoId and branch are required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return prLookupResultFrom(entry.ResolveBranchPr(ctx, p.Branch)), nil
}
