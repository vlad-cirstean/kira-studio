package gitsock

import (
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
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
		if verifyClientToken(deps.Clients, clientID, *hello.Token) {
			now := deps.Now().UnixMilli()
			if err := deps.Clients.TouchLastSeen(clientID, now); err != nil {
				slog.Warn("gitsock: touch last seen", "scope", "gitsock", "client", clientID, "err", err)
			}
			sendHandshake(c, handshakeResponse{
				Kind: "ready", ContractVersion: gitrpc.ContractVersion,
				ServerVersion: deps.ServerVersion, SessionID: sessionID,
			})
			return clientID, sessionID, label, true // row 4
		}
		sendHandshake(c, handshakeResponse{Kind: "tokenRejected"})
		return "", "", "", false // row 5
	}

	if deps.Broker.InCooldown(clientID) {
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return "", "", "", false // row 6
	}

	// Row 7: pairingRequired, then §3.1.2's own follow-up table.
	outcome := deps.Broker.Request(clientID, label, func(req PairingRequest) {
		sendHandshake(c, handshakeResponse{
			Kind: "pairingRequired", RequestID: req.RequestID,
			ExpiresInMs: int(pairingTimeout / time.Millisecond),
		})
	})

	switch outcome {
	case PairingApproved:
		ok = finishPairing(c, deps, clientID, sessionID, label)
		if !ok {
			return "", "", "", false
		}
		return clientID, sessionID, label, true
	case PairingDenied:
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return "", "", "", false
	default: // PairingTimedOut
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "timeout"})
		return "", "", "", false
	}
}

// finishPairing mints a token and inserts the row *before* sending "paired" (§3.1.2: the reverse
// order can hand out a token no row backs, which reads as a silent pairing loop to the user).
func finishPairing(c *conn, deps handshakeDeps, clientID, sessionID, label string) bool {
	plain, hash, salt, err := mintToken()
	if err != nil {
		slog.Warn("gitsock: mint token", "scope", "gitsock", "client", clientID, "err", err)
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return false
	}
	now := deps.Now().UnixMilli()
	row := repos.GitClientRow{
		ID: clientID, Label: label, TokenHash: hash, TokenSalt: salt,
		CreatedAt: now, LastSeenAt: now,
	}
	if err := deps.Clients.Insert(row); err != nil {
		slog.Warn("gitsock: insert paired client", "scope", "gitsock", "client", clientID, "err", err)
		sendHandshake(c, handshakeResponse{Kind: "pairingDenied", Reason: "denied"})
		return false
	}
	if deps.ClientsChanged != nil {
		deps.ClientsChanged()
	}
	if err := sendHandshake(c, handshakeResponse{Kind: "paired", Token: plain}); err != nil {
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

// verifyClientToken implements D6's timing discipline: a missing row and a wrong/revoked token
// take an identical path doing an identical amount of work — the presented token is always run
// through verifyToken, against the real row's hash/salt when one exists and a fixed dummy pair
// when it does not.
func verifyClientToken(store TrustStore, clientID, presented string) bool {
	row, found, err := store.ByID(clientID)
	if err != nil {
		slog.Warn("gitsock: trust store lookup", "scope", "gitsock", "client", clientID, "err", err)
	}
	if !found {
		verifyToken(presented, dummyHash, dummySalt)
		return false
	}
	if !verifyToken(presented, row.TokenHash, row.TokenSalt) {
		return false
	}
	return row.RevokedAt == nil
}

// clampLabel is D7's 200-byte clamp, cut on a rune boundary so a truncated multi-byte character at
// the edge never leaves an invalid UTF-8 tail in a column the Connected editors pane renders.
func clampLabel(label string) string {
	if len(label) <= maxLabelBytes {
		return label
	}
	return strings.ToValidUTF8(label[:maxLabelBytes], "")
}
