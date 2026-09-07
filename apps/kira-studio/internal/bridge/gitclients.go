package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// GitSock and GitBroker are the two one-method-ish seams this service needs from
// internal/gitsock — the same "declare the interface where it's consumed" precedent
// events.go's Sources uses — so this file stays the only thing in bridge that names gitsock
// types, and only the ones it actually renders.
type GitSock interface {
	Revoke(clientID string) error
}

type GitBroker interface {
	Pending() gitsock.PairingSnapshot
	Approve(requestID string) gitsock.PairingActionResult
	Deny(requestID string) gitsock.PairingActionResult
}

// GitClientsService is the *Connected editors* pane's whole surface (SPEC §3.3, D19): list/revoke
// paired clients, and answer/observe the pairing prompt. Approve/Deny never return a Go error —
// connections.Service.Reveal's own precedent (F7): a pairing decision is a value, not a failure.
type GitClientsService struct {
	Deps   appcore.Deps
	Sock   GitSock
	Broker GitBroker
}

func (s *GitClientsService) List() ([]model.GitClient, error) {
	clients, err := s.Deps.Repos.GitClients.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return clients, nil
}

// GitClientsIDArgs is shared by every method below that needs nothing but a client or request id.
type GitClientsIDArgs struct {
	ID string `json:"id"`
}

func (s *GitClientsService) Revoke(args GitClientsIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Sock.Revoke(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// GitPairingRequest is gitsock.PairingRequest's wire projection — an absolute deadline (epoch
// ms) instead of a time.Time, so the renderer's own countdown (§4.2) needs no clock-skew handling
// beyond what Date.now() already gives it.
type GitPairingRequest struct {
	RequestID   string `json:"requestId"`
	ClientID    string `json:"clientId"`
	Label       string `json:"label"`
	ExpiresAtMs int64  `json:"expiresAtMs"`
}

// GitPairingSnapshot is gitsock.PairingSnapshot's wire projection.
type GitPairingSnapshot struct {
	Pending *GitPairingRequest `json:"pending"`
	Queued  int                `json:"queued"`
}

func toWireSnapshot(snap gitsock.PairingSnapshot) GitPairingSnapshot {
	out := GitPairingSnapshot{Queued: snap.Queued}
	if snap.Pending != nil {
		out.Pending = &GitPairingRequest{
			RequestID: snap.Pending.RequestID, ClientID: snap.Pending.ClientID,
			Label: snap.Pending.Label, ExpiresAtMs: snap.Pending.ExpiresAt.UnixMilli(),
		}
	}
	return out
}

func (s *GitClientsService) PendingPairing() GitPairingSnapshot {
	return toWireSnapshot(s.Broker.Pending())
}

// GitPairingActionResult is gitsock.PairingActionResult's wire projection — a string enum reads
// clearer on the renderer side than the bare int the Go type is.
type GitPairingActionResult struct {
	Result string `json:"result"` // "resolved" | "alreadyResolved" | "expired"
}

func toWireActionResult(r gitsock.PairingActionResult) GitPairingActionResult {
	switch r {
	case gitsock.PairingActionResolved:
		return GitPairingActionResult{Result: "resolved"}
	case gitsock.PairingActionExpired:
		return GitPairingActionResult{Result: "expired"}
	default:
		return GitPairingActionResult{Result: "alreadyResolved"}
	}
}

func (s *GitClientsService) Approve(args GitClientsIDArgs) (GitPairingActionResult, error) {
	if args.ID == "" {
		return GitPairingActionResult{}, ipcerr.BadRequest("id is required")
	}
	return toWireActionResult(s.Broker.Approve(args.ID)), nil
}

func (s *GitClientsService) Deny(args GitClientsIDArgs) (GitPairingActionResult, error) {
	if args.ID == "" {
		return GitPairingActionResult{}, ipcerr.BadRequest("id is required")
	}
	return toWireActionResult(s.Broker.Deny(args.ID)), nil
}
