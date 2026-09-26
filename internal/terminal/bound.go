package terminal

import (
	"errors"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// BoundService is the one Wails-bound terminal surface both apps embed (P128 §2.1). Each app's own
// bridge.TerminalService is `struct{ *terminal.BoundService }` — Wails' binding generator builds a
// call's FQN from the *registered* type's own package, promoted methods included (§1.7), so each
// app keeps its own binding names while every method body here is shared. A separate type from
// Service (not new methods on it): Service also exports OpenWithCoalescedOutput and positional
// Write/Resize/Close, which embedding would bind too.
type BoundService struct {
	Emit     appevent.Emitter
	Registry *Registry
}

// svc is the internal/terminal.Service this bound type delegates its generic half to — built fresh
// per call rather than stored, since it is a stateless pair of pointers already held as Emit/Registry.
func (b *BoundService) svc() *Service {
	return &Service{Emit: b.Emit, Registry: b.Registry}
}

// Shutdown closes every live session — called from main.go's own teardown.
func (b *BoundService) Shutdown() {
	b.Registry.CloseAll()
}

// DefaultCwdResult is DefaultCwd's own wire shape — Path is "" when $HOME can't be resolved (P91
// §7.1: a missing home directory must not fail boot).
type DefaultCwdResult struct {
	Path string `json:"path"`
}

// DefaultCwd is the user's home directory, for an unscoped terminal launch — a repo-scoped terminal
// keeps using internal/gitsession's own worktree-cwd resolution.
func (b *BoundService) DefaultCwd() DefaultCwdResult {
	return DefaultCwdResult{Path: DefaultCwd()}
}

// OpenResult is Open's own wire shape.
type OpenResult struct {
	Shell string `json:"shell"`
}

// WriteArgs is Write's own wire shape.
type WriteArgs struct {
	TerminalID string `json:"terminalId"`
	// Data is base64 — keystrokes are not always valid UTF-8 (paste, Alt-meta, mouse reports).
	Data string `json:"data"`
}

// ResizeArgs is Resize's own wire shape.
type ResizeArgs struct {
	TerminalID string `json:"terminalId"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

// CloseArgs is Close's own wire shape.
type CloseArgs struct {
	TerminalID string `json:"terminalId"`
}

// Open validates args, spawns a new session and returns its resolved shell path. terminalId is
// client-supplied (the tab id) so the renderer subscribes to ChannelTerminal before this call
// returns — no output can race the subscription. The cwd check below is not a trust boundary and
// must not be read as one: the shell it starts is the user's own and can `cd` anywhere on its first
// line. It exists so a stale path fails with a clear E_INVALID instead of a confusing exec error.
func (b *BoundService) Open(args OpenArgs) (OpenResult, error) {
	if err := ValidateOpen(args); err != nil {
		return OpenResult{}, err
	}
	// P127: agent-activity monitoring (the `--settings` flag, the hook env vars) left Kira Studio;
	// Agent stays — it is P87's own keep-awake input (§2.5), read from this registry's own live-
	// session count, no dependency on the hooks. Space never sets Registry.OnChange, so Agent is
	// inert there (P128 §1.5) — no behaviour change in either app.
	agent := args.LaunchKind == LaunchKindClaudeCode

	sess, err := b.svc().OpenWithCoalescedOutput(OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   args.Command,
		Agent:     agent,
	}, args.WindowKey, args.TerminalID)
	if err != nil {
		if errors.Is(err, ErrDuplicateSession) {
			return OpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
		}
		return OpenResult{}, ipcerr.InternalErr(err)
	}

	return OpenResult{Shell: sess.Shell()}, nil
}

// Write decodes args.Data and forwards it to the pty. A no-op for an id with no live session
// (Registry.Write's own rule) — the renderer can have a keystroke in flight when a shell exits.
func (b *BoundService) Write(args WriteArgs) error {
	return b.svc().Write(args.TerminalID, args.Data)
}

// Resize applies cols/rows to the real winsize (pty.Setsize) — a no-op for an id with no live
// session.
func (b *BoundService) Resize(args ResizeArgs) error {
	return b.svc().Resize(args.TerminalID, args.Cols, args.Rows)
}

// Close kills args.TerminalID's own session — idempotent, per Session.Close.
func (b *BoundService) Close(args CloseArgs) error {
	return b.svc().Close(args.TerminalID)
}
