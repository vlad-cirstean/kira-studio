package bridge

import (
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// TerminalService is Kira Space's own binding-name shim over internal/terminal.BoundService
// (P128 §2.1) — Wails' binding generator builds a call's FQN from the *registered* type's own
// package, promoted methods included (§1.7), so embedding here keeps this app's binding names
// app-local while every method body lives once in internal/terminal. P129: main.go sets this
// BoundService's ComposeAgent to the ade.Tracker's own Compose method, so a claude-code launch
// through this service is composed and tracked — Kira Studio's own TerminalService leaves
// ComposeAgent nil and is unaffected.
type TerminalService struct {
	*terminal.BoundService
}
