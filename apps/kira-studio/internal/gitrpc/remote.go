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
	entry, err := entryFor(c, p.RepoID)
	if err != nil {
		return nil, err
	}
	result, err := entry.PullPreflight(ctx, p.Branch, p.StrategySetting)
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
