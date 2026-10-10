package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// validPullStrategy is remote.run's own strategy vocabulary: @kira/git-ipc's PullStrategy union,
// plus "" (every non-pull kind sends none).
func validPullStrategy(s string) bool {
	switch gitpreflight.PullStrategy(s) {
	case "", gitpreflight.PullFFOnly, gitpreflight.PullMerge, gitpreflight.PullRebase:
		return true
	default:
		return false
	}
}

// remote.pullPreflight/remote.pushPreflight are reads and stay on the request ctx. remote.run
// detaches (D19/G5 D8, applied again): a write already in flight must never be killed by a client
// disconnect or a `cancel` frame — remote.cancel (below) is the one deliberate, in-band way to end
// a killable phase early. remote.cancel is a fast, synchronous state mutation and needs no detaching of its own.

func (r *Router) handleRemotePullPreflight(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "remote.pullPreflight", params,
		func(p RemotePullPreflightParams) (string, error) {
			if err := requireNonEmpty("remote.pullPreflight", "repoId", p.RepoID, "branch", p.Branch); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p RemotePullPreflightParams) (gitpreflight.PullPreflight, error) {
			// The strategy is this repo's own stored kiraSpace.pull.strategy (G18 D6/F14), "auto"
			// until a user changes it in the dialog.
			result, err := entry.PullPreflight(ctx, p.Branch, entry.RepoSettings().PullStrategy)
			if err != nil {
				return gitpreflight.PullPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleRemotePushPreflight(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "remote.pushPreflight", params,
		func(p RemotePushPreflightParams) (string, error) {
			if err := requireNonEmpty("remote.pushPreflight", "repoId", p.RepoID, "branch", p.Branch, "remote", p.Remote); err != nil {
				return "", err
			}
			if err := validRefArg("branch", p.Branch); err != nil {
				return "", err
			}
			if err := validRefArg("remote", p.Remote); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p RemotePushPreflightParams) (gitpreflight.PushPreflight, error) {
			result, err := entry.PushPreflight(ctx, p.Remote, p.Branch)
			if err != nil {
				return gitpreflight.PushPreflight{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleRemoteRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "remote.run", params,
		func(p RemoteRunParams) (string, error) {
			if err := requireNonEmpty("remote.run", "repoId", p.RepoID, "kind", p.Kind, "remote", p.Remote); err != nil {
				return "", err
			}
			// D8 (see validRefArg, review.go): remote.run is the one write path that spawns `git
			// fetch`/`push` with a client-supplied remote name as its own argv token — unguarded, a
			// remote beginning with "-" is read as an option (e.g. `--upload-pack=<cmd>`) rather
			// than a remote name, letting a client run arbitrary commands via a local-path
			// remote.
			if err := validRefArg("remote", p.Remote); err != nil {
				return "", err
			}
			if p.Branch != "" {
				if err := validRefArg("branch", p.Branch); err != nil {
					return "", err
				}
			}
			if !validPullStrategy(p.Strategy) {
				return "", ipcerr.BadRequest("gitrpc: remote.run: invalid strategy " + p.Strategy)
			}
			if p.RebaseMerges && (p.Kind != "pull" || p.Strategy != string(gitpreflight.PullRebase)) {
				return "", ipcerr.BadRequest("gitrpc: remote.run: rebaseMerges requires kind pull and strategy rebase")
			}
			return p.RepoID, nil
		},
		func(ctx context.Context, entry *gitsession.RepoEntry, p RemoteRunParams) (gitsession.RemoteOpResult, error) {
			result, err := entry.RunRemote(context.WithoutCancel(ctx), c, p.RemoteOpParams, gitsession.RemoteDeps{Askpass: r.deps.Askpass})
			if err != nil {
				return gitsession.RemoteOpResult{}, mapGitError(err)
			}
			return result, nil
		},
	)
}

func (r *Router) handleRemoteCancel(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	return handleRepoCall(ctx, c, "remote.cancel", params,
		func(p RemoteCancelParams) (string, error) {
			if err := requireNonEmpty("remote.cancel", "repoId", p.RepoID); err != nil {
				return "", err
			}
			return p.RepoID, nil
		},
		func(_ context.Context, entry *gitsession.RepoEntry, _ RemoteCancelParams) (RemoteCancelResult, error) {
			return RemoteCancelResult{Cancelled: entry.CancelRemote()}, nil
		},
	)
}
