package gitrpc

import (
	"context"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// remote.pullPreflight/remote.pushPreflight are reads and stay on the request ctx. remote.run
// detaches (D19/G5 D8, applied again): a write already in flight must never be killed by a client
// disconnect or a `cancel` frame — remote.cancel (below) is the one deliberate, in-band way to end
// a killable phase early. remote.cancel and credential.provide are both fast, synchronous state
// mutations and need no detaching of their own.

func (r *Router) handleRemotePullPreflight(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RemotePullPreflightParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: remote.pullPreflight: invalid params")
	}
	if p.RepoID == "" || p.Branch == "" {
		return nil, ipcerr.BadRequest("gitrpc: remote.pullPreflight: repoId and branch are required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	// G18 D6/F14: StrategySetting's own wire shape is unchanged (still optional) — what upgrades
	// is what "empty" resolves to. A raw socket client omitting it used to fall straight to
	// gitpreflight.ResolvePullStrategy's own "auto" ladder; it now gets this repo's own stored
	// kiraVersion.pull.strategy first (itself "auto" until a user changes it in the dialog), which
	// only changes behaviour for a repo whose setting has actually been edited.
	strategySetting := p.StrategySetting
	if strategySetting == "" {
		strategySetting = entry.RepoSettings().PullStrategy
	}
	result, err := entry.PullPreflight(ctx, p.Branch, strategySetting)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleRemotePushPreflight(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RemotePushPreflightParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: remote.pushPreflight: invalid params")
	}
	if p.RepoID == "" || p.Branch == "" || p.Remote == "" {
		return nil, ipcerr.BadRequest("gitrpc: remote.pushPreflight: repoId, branch and remote are required")
	}
	if err := validRefArg("branch", p.Branch); err != nil {
		return nil, err
	}
	if err := validRefArg("remote", p.Remote); err != nil {
		return nil, err
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PushPreflight(ctx, p.Remote, p.Branch)
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleRemoteRun(ctx context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RemoteRunParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: remote.run: invalid params")
	}
	if p.RepoID == "" || p.Kind == "" || p.Remote == "" {
		return nil, ipcerr.BadRequest("gitrpc: remote.run: repoId, kind and remote are required")
	}
	// D8 (see validRefArg, review.go): remote.run is the one write path that spawns `git
	// fetch`/`push` with a client-supplied remote name as its own argv token — unguarded, a remote
	// beginning with "-" is read as an option (e.g. `--upload-pack=<cmd>`) rather than a remote
	// name, letting a paired client run arbitrary commands via a local-path remote.
	if err := validRefArg("remote", p.Remote); err != nil {
		return nil, err
	}
	if p.Branch != "" {
		if err := validRefArg("branch", p.Branch); err != nil {
			return nil, err
		}
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.RunRemote(context.WithoutCancel(ctx), c, p.RemoteOpParams, gitsession.RemoteDeps{Askpass: r.deps.Askpass})
	if err != nil {
		return nil, mapGitError(err)
	}
	return result, nil
}

func (r *Router) handleRemoteCancel(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p RemoteCancelParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: remote.cancel: invalid params")
	}
	if p.RepoID == "" {
		return nil, ipcerr.BadRequest("gitrpc: remote.cancel: repoId is required")
	}
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	return RemoteCancelResult{Cancelled: entry.CancelRemote()}, nil
}

// handleCredentialProvide is D4's own three-liner: decode, resolve the waiter on THIS connection
// only (Conn.ProvideCredential is already scoped that way — a foreign or stale id simply finds
// nothing), answer {} either way. Never logs, never echoes the secret back, never returns it in an
// error message (D9).
func (r *Router) handleCredentialProvide(_ context.Context, c *gitsession.Conn, params json.RawMessage) (any, error) {
	var p CredentialProvideParams
	if err := json.Unmarshal(params, &p); err != nil {
		return nil, ipcerr.BadRequest("gitrpc: credential.provide: invalid params")
	}
	if p.RequestID == "" {
		return nil, ipcerr.BadRequest("gitrpc: credential.provide: requestId is required")
	}
	c.ProvideCredential(p.RequestID, p.Secret)
	return struct{}{}, nil
}
