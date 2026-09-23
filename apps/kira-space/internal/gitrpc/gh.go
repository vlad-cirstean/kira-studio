package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// handleCommitResolvePr is commit.resolvePr's own handler (D9 step 2-3) — a thin projection of
// (*gitsession.RepoEntry).ResolveCommitPr onto the wire's own PrLookupResult. Never returns an RPC
// error for a GitHub-side failure (D1's own "Client never returns an error", carried all the way
// to the wire): the only errors this can produce are the ordinary "bad request"/"repo not held"
// ones every other per-repo method already has.
func (r *Router) handleCommitResolvePr(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "commit.resolvePr", params,
		func(p CommitResolvePrParams) (string, error) {
			if err := requireNonEmpty("commit.resolvePr", "repoId", p.RepoID, "sha", p.SHA); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p CommitResolvePrParams) (PrLookupResult, error) {
			return prLookupResultFrom(entry.ResolveCommitPr(ctx, p.SHA)), nil
		},
	)
}

// handleBranchResolvePr is branch.resolvePr's own handler (D8) — same shape as
// handleCommitResolvePr above, over (*gitsession.RepoEntry).ResolveBranchPr.
func (r *Router) handleBranchResolvePr(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "branch.resolvePr", params,
		func(p BranchResolvePrParams) (string, error) {
			if err := requireNonEmpty("branch.resolvePr", "repoId", p.RepoID, "branch", p.Branch); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p BranchResolvePrParams) (PrLookupResult, error) {
			return prLookupResultFrom(entry.ResolveBranchPr(ctx, p.Branch)), nil
		},
	)
}

// handlePrBrowserUrl is pr.browserUrl's own handler (P74 §3.3) — a thin projection of
// (*gitsession.RepoEntry).PrBrowserURL onto the wire's own {url: string|null} shape.
func (r *Router) handlePrBrowserUrl(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "pr.browserUrl", params,
		func(p PrBrowserUrlParams) (string, error) {
			if p.RepoID == "" || p.Number <= 0 {
				return "", ipcerr.BadRequest("gitrpc: pr.browserUrl: repoId and a positive number are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PrBrowserUrlParams) (PrBrowserUrlResult, error) {
			urlStr, ok := entry.PrBrowserURL(ctx, p.Number)
			if !ok {
				return PrBrowserUrlResult{URL: nil}, nil
			}
			return PrBrowserUrlResult{URL: &urlStr}, nil
		},
	)
}
