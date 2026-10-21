package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// handleCommitResolveChangeRequests is commit.resolveChangeRequests's own handler (D9 step 2-3) — a thin projection of
// (*gitsession.RepoEntry).ResolveCommitChangeRequests onto the wire's own ChangeRequestLookup. Never returns an RPC
// error for a GitHub-side failure (D1's own "Client never returns an error", carried all the way
// to the wire): the only errors this can produce are the ordinary "bad request"/"repo not held"
// ones every other per-repo method already has.
func (r *Router) handleCommitResolveChangeRequests(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "commit.resolveChangeRequests", params,
		func(p CommitResolveChangeRequestsParams) (string, error) {
			if err := requireNonEmpty("commit.resolveChangeRequests", "repoId", p.RepoID, "sha", p.SHA); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p CommitResolveChangeRequestsParams) (ChangeRequestLookup, error) {
			return changeRequestLookupFrom(entry.ResolveCommitChangeRequests(ctx, p.SHA)), nil
		},
	)
}

// handleBranchResolveChangeRequest is branch.resolveChangeRequest's own handler (D8) — same shape as
// handleCommitResolveChangeRequests above, over (*gitsession.RepoEntry).ResolveBranchChangeRequest.
func (r *Router) handleBranchResolveChangeRequest(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "branch.resolveChangeRequest", params,
		func(p BranchResolveChangeRequestParams) (string, error) {
			if err := requireNonEmpty("branch.resolveChangeRequest", "repoId", p.RepoID, "branch", p.Branch); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p BranchResolveChangeRequestParams) (ChangeRequestLookup, error) {
			return changeRequestLookupFrom(entry.ResolveBranchChangeRequest(ctx, p.Branch)), nil
		},
	)
}

// handleChangeRequestBrowserUrl is changeRequest.browserUrl's own handler (P74 §3.3) — a thin projection of
// (*gitsession.RepoEntry).ChangeRequestURL onto the wire's own {url: string|null} shape.
func (r *Router) handleChangeRequestBrowserUrl(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "changeRequest.browserUrl", params,
		func(p ChangeRequestBrowserUrlParams) (string, error) {
			if p.RepoID == "" || p.Number <= 0 {
				return "", ipcerr.Contract("gitrpc: changeRequest.browserUrl: repoId and a positive number are required")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p ChangeRequestBrowserUrlParams) (ChangeRequestBrowserUrlResult, error) {
			urlStr, ok := entry.ChangeRequestURL(ctx, p.Number)
			if !ok {
				return ChangeRequestBrowserUrlResult{URL: nil}, nil
			}
			return ChangeRequestBrowserUrlResult{URL: &urlStr}, nil
		},
	)
}
