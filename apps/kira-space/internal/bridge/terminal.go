package bridge

import (
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// TerminalService is Kira Space's own binding-name shim over internal/terminal.BoundService
// (P128 §2.1) — Wails' binding generator builds a call's FQN from the *registered* type's own
// package, promoted methods included (§1.7), so embedding here keeps this app's binding names
// app-local while every method body lives once in internal/terminal. Space never sets
// Registry.OnChange, so BoundService.Open's Agent flag is inert here (§1.5) — no behaviour change.
type TerminalService struct {
	*terminal.BoundService
}
