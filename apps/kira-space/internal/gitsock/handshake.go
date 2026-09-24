package gitsock

import (
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// maxLabelBytes is D7's clamp on a client-supplied label before it is ever written to git_clients
// or shown in the Connected editors pane.
const maxLabelBytes = 200

// helloFrame/helloClient are SPEC §3.3's C→S wire shape, verbatim.
type helloFrame struct {
	Kind            string      `json:"kind"`
	Protocol        int         `json:"protocol"`
	ContractVersion int         `json:"contractVersion"`
	Client          helloClient `json:"client"`
	Token           *string     `json:"token"`
}

type helloClient struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	PID        int    `json:"pid"`
	AppVersion string `json:"appVersion"`
}

// handshakeResponse is every S→C handshake frame folded into one struct, the same "one struct, a
// `kind` discriminant, omitempty for whatever a variant doesn't carry" convention rpcstream's own
// frame type uses (F2) — the union is small and every field a primitive, so this reads clearer
// than seven Go types behind an interface.
type handshakeResponse struct {
	Kind            string `json:"kind"`
	Expected        int    `json:"expected,omitempty"`
	Received        int    `json:"received,omitempty"`
	ServerVersion   string `json:"serverVersion,omitempty"`
	ContractVersion int    `json:"contractVersion,omitempty"`
	SessionID       string `json:"sessionId,omitempty"`
	RequestID       string `json:"requestId,omitempty"`
	ExpiresInMs     int    `json:"expiresInMs,omitempty"`
	Token           string `json:"token,omitempty"`
	Reason          string `json:"reason,omitempty"`
}

// handshakeDeps is what runHandshake needs — a subset of Server's own deps, passed explicitly
// rather than as *Server so this stays testable over a bare net.Pipe() with no listener.
type handshakeDeps struct {
	Clients       TrustStore
	Broker        *Broker
	ServerVersion string
	Now           func() time.Time
	// ClientsChanged notifies the Connected editors pane after a write to the trust store
	// (a fresh pairing). Optional so handshake_test.go's fakes needn't supply it.
	ClientsChanged func()
}

// runHandshake implements §3.1.1's decision table, first match wins. ok=true means the connection
// reached "ready" and ownership passes to a rpcstream.Session; sessionID is the same id sent in
// that "ready" frame, minted once here rather than thrown away (G2 plan D19 — gitsession.Conn's ID
// is this, not a second, independent id). label is the handshake's own clamped client label
// (G5 F11) — computed here regardless of outcome, but only meaningful when ok is true; threaded
// into gitsession.NewConn so the undo slot can attribute a record to "this window" (D7). ok=false
// means a terminal frame (or nothing, for row 1) has already been sent and the caller closes the
// connection.
func runHandshake(c *conn, deps handshakeDeps) (clientID, sessionID, label string, ok bool) {
	raw, err := c.Receive()
	if err != nil {
		return "", "", "", false // row 1: undecodable/EOF — nothing to answer, just close.
	}
	var hello helloFrame
	if err := json.Unmarshal(raw, &hello); err != nil || hello.Kind != "hello" || hello.Client.ID == "" {
		return "", "", "", false // row 1
	}

	if hello.Protocol != gitrpc.Protocol {
		sendHandshake(c, handshakeResponse{
			Kind: "versionMismatch", Expected: gitrpc.Protocol, Received: hello.Protocol,
			ServerVersion: deps.ServerVersion,
		})
		return "", "", "", false // row 2
	}
	if hello.ContractVersion != gitrpc.ContractVersion {
		sendHandshake(c, handshakeResponse{
			Kind: "versionMismatch", Expected: gitrpc.ContractVersion, Received: hello.ContractVersion,
			ServerVersion: deps.ServerVersion,
		})
		return "", "", "", false // row 3
	}

	clientID = hello.Client.ID
	label = clampLabel(hello.Client.Label)
	sessionID = uuid.NewString()

	if hello.Token != nil {
		switch verifyClientToken(deps.Clients, clientID, *hello.Token) {
		case tokenVerified:
			now := deps.Now().UnixMilli()
			if err := deps.Clients.TouchLastSeen(clientID, now); err != nil {
				slog.Warn("gitsock: touch last seen", "scope", "gitsock", "client", clientID, "err", err)
			}
			sendHandshake(c, handshakeResponse{
				Kind: "ready", ContractVersion: gitrpc.ContractVersion,
				ServerVersion: deps.ServerVersion, SessionID: sessionID,
			})
			return clientID, sessionID, label, true // row 4
		case tokenLookupFailed:
			// F10: a transient trust-store error is not a rejection — answering it as one makes the
			// extension delete its still-valid token and re-pair. Close without a frame, the row-1
			// posture, so the extension's ordinary backoff-reconnect path runs instead and its stored
			// token survives.
			return "", "", "", false
		default: // tokenInvalid
			sendHandshake(c, handshakeResponse{Kind: "tokenRejected"})
			return "", "", "", false // row 5
		}
	}

	if deps.Broker.InCooldown(clientID) {
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return "", "", "", false // row 6
	}

	// Row 7: pairingRequired, then §3.1.2's own follow-up table. requestID is captured from
	// onEnqueued so an Approved outcome can claim this connection's own share of the token the
	// broker minted (F6) — TakeApprovedToken is keyed by it. F12: a watcher goroutine starts
	// watching this connection for a disconnect the moment the request is enqueued, so a requester
	// that goes away mid-wait (window closed, extension reload) has its entry cancelled instead of
	// sitting in the queue, presentable, until Approve mints a token nobody holds.
	var requestID string
	var watchDone chan struct{}
	outcome := deps.Broker.Request(clientID, label, func(req PairingRequest) {
		requestID = req.RequestID
		sendHandshake(c, handshakeResponse{
			Kind: "pairingRequired", RequestID: req.RequestID,
			ExpiresInMs: int(pairingTimeout / time.Millisecond),
		})
		watchDone = watchDisconnect(c, deps.Broker, req.RequestID)
	})
	if watchDone != nil {
		stopWatch(c, watchDone)
	}

	switch outcome {
	case PairingApproved:
		tok, tokenOK := deps.Broker.TakeApprovedToken(requestID)
		if !tokenOK {
			// Broker.answer always mints (or degrades to Denied) before resolving Approved — this
			// is unreachable in practice, but fail closed rather than pair with no token to hand.
			sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
			return "", "", "", false
		}
		ok = finishPairing(c, deps, clientID, sessionID, label, tok)
		if !ok {
			return "", "", "", false
		}
		return clientID, sessionID, label, true
	case PairingDenied:
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return "", "", "", false
	case PairingAborted:
		// F11: not a user decision (server shutdown, queue cap) — close without a frame, the row-1
		// posture, so the client backs off and redials instead of landing in its terminal "denied"
		// state.
		return "", "", "", false
	default: // PairingTimedOut
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "timeout"})
		return "", "", "", false
	}
}

// watchDisconnect starts the goroutine F12 needs: a blocking 1-byte Peek of c's own bufio.Reader,
// running for as long as requestID sits in the broker's queue awaiting a decision. Peek never
// consumes a byte — the handshake protocol expects nothing further from the client before a
// decision arrives, so this only ever unblocks on a real read error (EOF, reset) or on stopWatch's
// own forced deadline below. Either way it cancels the request; Broker.Cancel is a no-op if the
// request was already resolved by the time it runs, so a spurious cancel from stopWatch's forced
// deadline racing a real decision costs nothing. The returned channel closes once the Peek call
// has returned, so stopWatch can wait for this goroutine to be fully done with c before anything
// else reads from it.
func watchDisconnect(c *conn, broker *Broker, requestID string) chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		if _, err := c.r.Peek(1); err != nil {
			broker.Cancel(requestID)
		}
	}()
	return done
}

// stopWatch retires watchDisconnect's goroutine once the pairing outcome is already known, in the
// exact order F12's review requires: set a deadline already in the past, so the goroutine's
// in-flight (or about-to-start) Peek returns immediately rather than blocking further; wait for
// that goroutine to actually exit, so nothing else touches c.r while it might still be mid-Peek;
// only then clear the deadline, before c is handed to Serve (or closed) — a deadline left in place
// would wrongly time out the connection's very first read once Serve takes over.
func stopWatch(c *conn, done chan struct{}) {
	_ = c.nc.SetReadDeadline(time.Unix(0, 0))
	<-done
	_ = c.nc.SetReadDeadline(time.Time{})
}

// finishPairing inserts the row *before* sending "paired" (§3.1.2: the reverse order can hand out
// a token no row backs, which reads as a silent pairing loop to the user). tok is the single token
// Broker.Approve already minted for this whole approval decision (F6) — shared verbatim by every
// sibling window of the same clientID, never minted again here.
func finishPairing(c *conn, deps handshakeDeps, clientID, sessionID, label string, tok approvedToken) bool {
	now := deps.Now().UnixMilli()
	row := repos.GitClientRow{
		ID: clientID, Label: label, TokenHash: tok.hash, TokenSalt: tok.salt,
		CreatedAt: now, LastSeenAt: now,
	}
	if err := deps.Clients.UpsertOnPair(row); err != nil {
		// A trust grant the user just approved failed to persist — an error, not a warning (F14).
		slog.Error("gitsock: upsert paired client", "scope", "gitsock", "client", clientID, "err", err)
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return false
	}
	if deps.ClientsChanged != nil {
		deps.ClientsChanged()
	}
	if err := sendHandshake(c, handshakeResponse{Kind: "paired", Token: tok.plain}); err != nil {
		return false
	}
	sendHandshake(c, handshakeResponse{
		Kind: "ready", ContractVersion: gitrpc.ContractVersion,
		ServerVersion: deps.ServerVersion, SessionID: sessionID,
	})
	return true
}

func sendHandshake(c *conn, resp handshakeResponse) error {
	b, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	return c.Send(b)
}

// tokenVerifyOutcome is verifyClientToken's tri-state result (F10): a lookup failure is neither an
// accept nor a real reject, and must be told apart from both so runHandshake can answer it
// differently.
type tokenVerifyOutcome int

const (
	tokenVerified tokenVerifyOutcome = iota
	tokenInvalid
	tokenLookupFailed
)

// verifyClientToken implements D6's timing discipline: a missing row and a wrong/revoked token
// take an identical path doing an identical amount of work — the presented token is always run
// through verifyToken, against the real row's hash/salt when one exists and a fixed dummy pair
// when it does not or a lookup error prevents knowing (F10). A lookup error itself is reported as
// tokenLookupFailed rather than folded into tokenInvalid — a transient store failure (busy/locked,
// closed DB during shutdown) is not a rejection of the presented token.
func verifyClientToken(store TrustStore, clientID, presented string) tokenVerifyOutcome {
	row, found, err := store.ByID(clientID)
	if err != nil {
		slog.Warn("gitsock: trust store lookup", "scope", "gitsock", "client", clientID, "err", err)
		verifyToken(presented, dummyHash, dummySalt) // D6: uniform timing even on a lookup failure.
		return tokenLookupFailed
	}
	if !found {
		verifyToken(presented, dummyHash, dummySalt)
		return tokenInvalid
	}
	if !verifyToken(presented, row.TokenHash, row.TokenSalt) {
		return tokenInvalid
	}
	if row.RevokedAt != nil {
		return tokenInvalid
	}
	return tokenVerified
}

// clampLabel is D7's 200-byte clamp, cut on a rune boundary so a truncated multi-byte character at
// the edge never leaves an invalid UTF-8 tail in a column the Connected editors pane renders.
func clampLabel(label string) string {
	if len(label) <= maxLabelBytes {
		return label
	}
	return strings.ToValidUTF8(label[:maxLabelBytes], "")
}
