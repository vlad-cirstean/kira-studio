package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// handleCommitResolveChangeRequests is commit.resolveChangeRequests's own handler — a thin
// projection of (*gitsession.RepoEntry).ResolveCommitChangeRequests onto the wire's own
// ChangeRequestLookup. Never returns an RPC error for a GitHub-side failure (the "Client never
// returns an error", carried all the way to the wire): the only errors this can produce are the
// ordinary "bad request"/"repo not held" ones every other per-repo method already has.
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

// handleBranchChangeRequestIndex is branch.changeRequestIndex's own handler: the persisted index,
// served from SQLite whatever the host is doing.
func (r *Router) handleBranchChangeRequestIndex(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "branch.changeRequestIndex", params,
		func(p BranchChangeRequestIndexParams) (string, error) {
			if err := requireNonEmpty("branch.changeRequestIndex", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ BranchChangeRequestIndexParams) (BranchChangeRequestIndexResult, error) {
			idx := entry.ChangeRequestIndex(ctx)
			out := BranchChangeRequestIndexResult{Complete: idx.Complete, SyncedAt: idx.SyncedAt, Branches: make([]BranchChangeRequest, 0, len(idx.Branches))}
			for _, b := range idx.Branches {
				out.Branches = append(out.Branches, BranchChangeRequest{Name: b.Name, ChangeRequest: changeRequestRecordFrom(b.ChangeRequest)})
			}
			return out, nil
		},
	)
}

// handleBranchSyncChangeRequests is branch.syncChangeRequests's own handler: ask the entry's
// syncer for a run now. It answers {} whether or not a run started (a gate, the min gap).
func (r *Router) handleBranchSyncChangeRequests(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "branch.syncChangeRequests", params,
		func(p BranchSyncChangeRequestsParams) (string, error) {
			if err := requireNonEmpty("branch.syncChangeRequests", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p BranchSyncChangeRequestsParams) (struct{}, error) {
			entry.SyncChangeRequests(ctx, p.Focused, p.Wait)
			return struct{}{}, nil
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

// handleGitHostInfo is gitHost.info's own handler: which provider this repository's change-request
// calls go to, for naming it in the UI.
func (r *Router) handleGitHostInfo(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "gitHost.info", params,
		func(p GitHostInfoParams) (string, error) {
			if err := requireNonEmpty("gitHost.info", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ GitHostInfoParams) (GitHostInfoResult, error) {
			info, ok := entry.HostInfo(ctx)
			if !ok {
				return GitHostInfoResult{}, nil
			}
			return GitHostInfoResult{Host: &info}, nil
		},
	)
}

// handleGitHostProviders is gitHost.providers' own handler: every registered provider, for the
// repository settings choice.
func (r *Router) handleGitHostProviders(_ context.Context, _ *gitsession.Conn, _ json.RawMessage) (any, error) {
	return githost.Providers{Providers: r.deps.Registry.Hosts.Registry.Infos()}, nil
}
