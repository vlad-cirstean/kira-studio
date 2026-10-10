package bridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/rpcstream"
)

// GitStreamName is the second named stream (docs/v1.5/plans/C10-git-graph-native.md §3.2) —
// StreamName's peer, carrying gitrpc's own wire protocol instead of adapterhost's.
const GitStreamName = "git"

// nativeClientID/nativeLabel identify the native graph's own gitsession.Conn (ClientID/
// ClientLabel) — used only for attribution (e.g. the undo slot's "made in this window" label),
// never for trust: there is no pairing here to trust (docs/v1.5/plans/C10-git-graph-native.md
// §3.2).
const (
	nativeClientID = "kira-native"
	nativeLabel    = "Kira Space"
)

// maxGitStreamFrameBytes caps one frame (32 MiB) — a graph-chunk blob must fit in one.
const maxGitStreamFrameBytes = 32 << 20

// newStreamConnID mints a per-connection gitsession.ConnID. There is no handshake here to mint one
// for us — a fresh random id per ServeGitStream call is all gitsession.Conn needs it for: keying this connection's own repo holds and walk state,
// never anything cross-process.
func newStreamConnID() gitsession.ConnID {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf) // crypto/rand.Read never errors on a Reader that never fails to fill.
	return gitsession.ConnID(hex.EncodeToString(buf))
}

type requestFn = func(ctx context.Context, method string, params json.RawMessage) (any, error)

// repoSettingsSetTouchesRestrictedField are the RepoSettingsPatchWire leaves repoSettings.set must
// refuse on this stream: the worktree prepare script and base path are written only in-process by
// Kira Space (the ADE repo config), never by a renderer. Follows this package's existing json.RawMessage-decode-and-inspect precedent
// (gitrpc's own handlers all decode params into a typed struct before acting on it; this does the
// same, just to inspect instead of dispatch).
func repoSettingsSetTouchesRestrictedField(params json.RawMessage) bool {
	var p gitrpc.RepoSettingsSetParams
	if err := json.Unmarshal(params, &p); err != nil {
		// Malformed params: let it through to the real handler, which rejects it properly. This
		// wrapper only ever narrows what the allowlist admits — it is never a substitute for the
		// inner handler's own request validation.
		return false
	}
	patch := p.Patch
	return patch.WorktreePrepareScript != nil || patch.WorktreeBasePath != nil
}

// guardRepoSettingsSet adds the one FIELD-level restriction this stream needs: repoSettings.set is
// served, but only for a patch that leaves every restricted field (above) absent.
func guardRepoSettingsSet(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if method == "repoSettings.set" && repoSettingsSetTouchesRestrictedField(params) {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: repoSettings.set: this field is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// ServeGitStream runs for the life of one renderer connection, mirroring ServeEngineStream
// (stream.go). There is no handshake: the peer is this process's own
// webview, not an external client the trust store exists to gate (docs/v1.5/plans/
// C10-git-graph-native.md §3.2). gconn still does its real job — per-connection repo holds, so
// repo.close only ever releases this connection's own hold (gitrpc/handlers.go), and Emit for
// repo.changed and, since P67e, credential.request.
func ServeGitStream(router *gitrpc.Router, conn StreamSession) {
	gconn := gitsession.NewConn(newStreamConnID(), nativeClientID, nativeLabel, nil)
	// P67e/D5: still opted out, but no longer because writes were refused here — a periodic
	// background `git fetch --prune` is a network write the user never pressed a button for, and
	// every fetch this phase admits is one they did (P67e's own plan doc §9 OQ-2, docs/v1.6/plans/).
	// One deleted line whenever someone actually wants automatic background fetching for this Conn.
	gconn.DisableAutoFetch()
	defer gconn.Close()

	handlers := router.ForConn(gconn)
	sess := rpcstream.NewSession(conn, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         guardRepoSettingsSet(handlers.Request),
		Stream:          handlers.Stream,
		MaxFrameBytes:   maxGitStreamFrameBytes,
	})
	gconn.SetEmit(sess.Emit)
	sess.Serve()
}
