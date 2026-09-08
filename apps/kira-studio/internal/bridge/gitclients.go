package bridge

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitvsix"
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

// GitVsix is G10 D14's own seam over internal/gitvsix — the same "declare the interface where
// it's consumed" precedent as GitSock/GitBroker above.
type GitVsix interface {
	Status() gitvsix.Status
	Install(ctx context.Context) gitvsix.Result
}

// GitClientsService is the *Connected editors* pane's whole surface (SPEC §3.3, D19): list/revoke
// paired clients, and answer/observe the pairing prompt. Approve/Deny never return a Go error —
// connections.Service.Reveal's own precedent (F7): a pairing decision is a value, not a failure.
// G10 D14 adds VsixStatus/InstallVsCodeIntegration, the same never-erroring shape.
type GitClientsService struct {
	Deps   appcore.Deps
	Sock   GitSock
	Broker GitBroker
	Vsix   GitVsix
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

// GitVsixStatus is gitvsix.Status's wire projection (G10 D14) — codeAvailable collapses
// gitvsix.Status.CodePath's "" convention into a bool, since the pane only ever branches on
// whether one was found, never on the path itself before a real Install call resolves it fresh.
type GitVsixStatus struct {
	Bundled       bool     `json:"bundled"`
	VsixPath      string   `json:"vsixPath"`
	CodeAvailable bool     `json:"codeAvailable"`
	Probed        []string `json:"probed"`
}

func toWireVsixStatus(s gitvsix.Status) GitVsixStatus {
	return GitVsixStatus{
		Bundled:       s.Bundled,
		VsixPath:      s.VsixPath,
		CodeAvailable: s.CodePath != "",
		Probed:        s.Probed,
	}
}

// VsixStatus is advisory only (D14): it lets the pane render honestly before a click, but
// InstallVsCodeIntegration re-resolves everything itself and is the sole authority — a `code`
// installed after this renders must still work on the next click.
func (s *GitClientsService) VsixStatus() GitVsixStatus {
	return toWireVsixStatus(s.Vsix.Status())
}

// GitVsixInstallResult is gitvsix.Result's wire projection.
type GitVsixInstallResult struct {
	Outcome  string   `json:"outcome"`
	VsixPath string   `json:"vsixPath"`
	Detail   string   `json:"detail"`
	Probed   []string `json:"probed"`
}

func toWireVsixResult(r gitvsix.Result) GitVsixInstallResult {
	return GitVsixInstallResult{Outcome: r.Outcome, VsixPath: r.VsixPath, Detail: r.Detail, Probed: r.Probed}
}

// InstallVsCodeIntegration never returns a Go error — gitvsix.Install's own contract (D10),
// following connections.Service.Reveal/apivars.Reveal's precedent.
func (s *GitClientsService) InstallVsCodeIntegration(ctx context.Context) GitVsixInstallResult {
	return toWireVsixResult(s.Vsix.Install(ctx))
}
