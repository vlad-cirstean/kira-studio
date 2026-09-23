package gitrpc

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
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
	return handleRepoCall(ctx, c, "stash.list", params,
		func(p StashListParams) (string, error) {
			if err := requireNonEmpty("stash.list", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ StashListParams) (StashListResult, error) {
			entries, err := entry.StashList(ctx)
			if err != nil {
				return StashListResult{}, mapGitError(err)
			}
			return StashListResult{Entries: entries}, nil
		},
	)
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
	return handleRepoCall(ctx, c, "stash.show", params,
		func(p StashShowParams) (string, error) {
			if err := requireNonEmpty("stash.show", "repoId", p.RepoID, "sha", p.SHA); err != nil {
				return "", err
			}
			if !validStashScope(p.Scope) {
				return "", ipcerr.BadRequest("gitrpc: stash.show: invalid scope " + p.Scope)
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p StashShowParams) (gitsession.StashShowResult, error) {
			result, err := entry.StashShow(ctx, p.SHA, p.Scope)
			if err != nil {
				return gitsession.StashShowResult{}, mapStashError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightStashPop(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.stashPop", params,
		func(p PreflightStashPopParams) (string, error) {
			if err := requireNonEmpty("preflight.stashPop", "repoId", p.RepoID, "sha", p.SHA); err != nil {
				return "", err
			}
			if !validStashScope(p.Scope) {
				return "", ipcerr.BadRequest("gitrpc: preflight.stashPop: invalid scope " + p.Scope)
			}
			// F1 (P108 Part 16 review), defense in depth: targetSha reaches MergeTreeArgs as a
			// bare argv token (gitsession.PreflightStashPop already guards it — this is the second
			// layer at the boundary).
			if p.TargetSHA != nil {
				if err := validRefArg("targetSha", *p.TargetSHA); err != nil {
					return "", err
				}
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightStashPopParams) (gitpreflight.StashPopPreflight, error) {
			result, err := entry.PreflightStashPop(ctx, p.SHA, p.TargetSHA, p.Scope)
			if err != nil {
				return gitpreflight.StashPopPreflight{}, mapStashError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handlePreflightStashBranch(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "preflight.stashBranch", params,
		func(p PreflightStashBranchParams) (string, error) {
			if err := requireNonEmpty("preflight.stashBranch", "repoId", p.RepoID, "sha", p.SHA, "branch", p.Branch); err != nil {
				return "", err
			}
			if !validStashScope(p.Scope) {
				return "", ipcerr.BadRequest("gitrpc: preflight.stashBranch: invalid scope " + p.Scope)
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p PreflightStashBranchParams) (gitpreflight.StashBranchPreflight, error) {
			result, err := entry.PreflightStashBranch(ctx, p.SHA, p.Branch, p.Scope)
			if err != nil {
				return gitpreflight.StashBranchPreflight{}, mapStashError(err)
			}
			return result, nil
		},
	)
}

// handleGlobalStashList is globalStash.list's own dispatch (G28 D9/D17) — the bucket's own
// listing, reusing StashListResult verbatim (D17: zero new wire interfaces — the shape `{entries:
// StashEntry[]}` is already exactly what stash.list answers).
func (r *Router) handleGlobalStashList(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "globalStash.list", params,
		func(p GlobalStashListParams) (string, error) {
			if err := requireNonEmpty("globalStash.list", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, _ GlobalStashListParams) (StashListResult, error) {
			entries, err := entry.GlobalStashList(ctx)
			if err != nil {
				return StashListResult{}, mapGitError(err)
			}
			return StashListResult{Entries: entries}, nil
		},
	)
}
