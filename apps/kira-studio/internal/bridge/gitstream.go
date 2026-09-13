package bridge

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/rpcstream"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
)

// nativeClientID/nativeLabel identify the native graph's own gitsession.Conn in the same two
// slots an external gitsock client's handshake would fill (ClientID/ClientLabel) — used only for
// attribution (e.g. the undo slot's "made in this window" label), never for trust: there is no
// pairing here to trust (docs/v1.5/plans/C10-git-graph-native.md §3.2).
const (
	nativeClientID = "kira-native"
	nativeLabel    = "This window"
)

// maxGitStreamFrameBytes reuses gitsock's own 8 MiB cap (gitsock/frame.go) — the graph-chunk blobs
// crossing this stream are the same blobs, so there is no reason for a different limit.
const maxGitStreamFrameBytes = 8 << 20

// newStreamConnID mints a per-connection gitsession.ConnID. There is no handshake here to mint one
// for us (gitsock's own sessionId comes from runHandshake) — a fresh random id per ServeGitStream
// call is all gitsession.Conn needs it for: keying this connection's own repo holds and walk state,
// never anything cross-process.
func newStreamConnID() gitsession.ConnID {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf) // crypto/rand.Read never errors on a Reader that never fails to fill.
	return gitsession.ConnID(hex.EncodeToString(buf))
}

// readOnlyMethods is an ALLOWLIST, deliberately: a contract method added later is refused by this
// stream until someone adds it here on purpose. A denylist would admit every future write by
// default, which is the failure mode this file exists to prevent (docs/v1.5/plans/
// C10-git-graph-native.md §4.2).
//
// Every preflight.* method is deliberately ABSENT. A pre-flight is a read, but its only purpose is
// to stage a write; admitting it would let a UI bug render a confirm dialog whose confirm button
// then fails at this layer — a worse experience than the action simply not existing.
//
// review.* is deliberately absent too — C11's own surface, out of scope here (§9); undo.peek is
// admitted because UndoButton.vue reads it to render a label even when undo itself is hidden.
var readOnlyMethods = map[string]struct{}{
	"app.init": {}, "repo.open": {}, "repo.close": {},
	"graph.status": {}, "graph.loadMore": {}, "graph.refresh": {},
	"commit.detail": {}, "commit.fileDiff": {}, "file.read": {}, "file.goToTarget": {},
	"blame.line": {}, "working.detail": {}, "refs.list": {}, "status.get": {},
	"stash.list": {}, "stash.show": {}, "globalStash.list": {},
	"undo.peek": {}, "search.run": {},
	"commit.resolvePr": {}, "branch.resolvePr": {},
	"worktree.list": {}, "stack.list": {},
	"repoSettings.get": {}, "repoSettings.set": {}, // §4.4: writes only Kira's own SQLite.
}

// readOnlyStreamMethods is layer 1's own allowlist for the one streaming method — graph.stream is
// the only OpenStream call the graph makes; everything else streamed (SPEC's remote progress, for
// instance) is a write-triggered stream with no native caller.
var readOnlyStreamMethods = map[string]struct{}{
	"graph.stream": {},
}

type requestFn = func(ctx context.Context, method string, params json.RawMessage) (any, error)
type streamFn = func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error

// readOnlyRequest wraps next so every request this stream ever serves is checked against
// readOnlyMethods before next is even called — the load-bearing boundary (§4.2 layer 1). This
// cannot be bypassed by any frontend change: a method missing here is refused regardless of what
// hostHandlers.ts or any git-ui component believes is safe.
func readOnlyRequest(next requestFn) requestFn {
	return func(ctx context.Context, method string, params json.RawMessage) (any, error) {
		if _, ok := readOnlyMethods[method]; !ok {
			return nil, ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params)
	}
}

// readOnlyStream is readOnlyRequest's counterpart for OpenStream calls.
func readOnlyStream(next streamFn) streamFn {
	return func(ctx context.Context, method string, params json.RawMessage, emit func(payload any, blob []byte) error) error {
		if _, ok := readOnlyStreamMethods[method]; !ok {
			return ipcerr.New("E_READ_ONLY",
				"gitstream: "+method+" is not available from the native graph surface")
		}
		return next(ctx, method, params, emit)
	}
}

// ServeGitStream runs for the life of one renderer connection, mirroring ServeEngineStream
// (stream.go). Unlike gitsock.handleConn there is no handshake: the peer is this process's own
// webview, not an external client the trust store exists to gate (docs/v1.5/plans/
// C10-git-graph-native.md §3.2). gconn still does its real job — per-connection repo holds, so
// repo.close only ever releases this connection's own hold (gitrpc/handlers.go), and Emit for
// repo.changed.
func ServeGitStream(router *gitrpc.Router, conn StreamSession) {
	gconn := gitsession.NewConn(newStreamConnID(), nativeClientID, nativeLabel, nil)
	defer gconn.Close()

	handlers := router.ForConn(gconn)
	sess := rpcstream.NewSession(conn, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         readOnlyRequest(handlers.Request),
		Stream:          readOnlyStream(handlers.Stream),
		MaxFrameBytes:   maxGitStreamFrameBytes,
	})
	gconn.Emit = sess.Emit
	sess.Serve()
}
