package prompts

import (
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// Bound is the bound-service surface shared by both apps; each embeds it.
type Bound struct{ R *Router }

// IDArgs names one prompt.
type IDArgs struct {
	ID string `json:"id"`
}

// ClaimArgs moves a prompt to a window.
type ClaimArgs struct {
	ID        string `json:"id"`
	WindowKey string `json:"windowKey"`
}

// RaiseArgs raises a renderer-detected popup; only the update kind is accepted.
type RaiseArgs struct {
	Kind Kind   `json:"kind"`
	Ref  string `json:"ref"`
}

const maxRefBytes = 64

// List returns every open prompt with its target window.
func (b *Bound) List() ([]Routed, error) { return b.R.List(), nil }

// MainWindow is the lowest-order real window's key, "" when none is open.
func (b *Bound) MainWindow() (string, error) {
	k, _ := b.R.d.Windows.MainKey()
	return k, nil
}

// Claim moves a prompt to one window.
func (b *Bound) Claim(args ClaimArgs) error { return ipcerr.Wrap(b.R.Claim(args.ID, args.WindowKey)) }

// Raise opens an update popup; idempotent per ref.
func (b *Bound) Raise(args RaiseArgs) error {
	if args.Kind != KindUpdate {
		return ipcerr.New("E_INVALID", "only the update prompt is raised from the window")
	}
	if args.Ref == "" || len(args.Ref) > maxRefBytes || !utf8.ValidString(args.Ref) {
		return ipcerr.BadRequest("ref is required and at most 64 bytes")
	}
	b.R.Open(Prompt{
		ID: ID(KindUpdate, args.Ref), Kind: KindUpdate, Ref: args.Ref,
		Title: "Kira " + b.R.App() + " " + args.Ref + " is available",
	})
	return nil
}

// Dismiss closes an update popup.
func (b *Bound) Dismiss(args IDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if !strings.HasPrefix(args.ID, string(KindUpdate)+":") {
		return ipcerr.New("E_INVALID", "only the update prompt is dismissed from the window")
	}
	b.R.Close(args.ID)
	return nil
}

// SendTest posts a test notification.
func (b *Bound) SendTest() error {
	b.R.SendTest()
	return nil
}
