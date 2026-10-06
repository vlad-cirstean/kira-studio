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
	// ComposeAgent, when set, rewrites a claude-code launch's command and supplies extra env before
	// spawn. Kira Space sets it (P129, its own session tracker's Compose method); Kira Studio leaves
	// it nil, so its own Open is byte-identical to before this field existed. A func field, not a
	// method: Wails' binding generator only ever sees exported *methods* on the registered type
	// (§1.7's FQN rule), so adding this never grows either app's own bound-call surface.
	ComposeAgent func(terminalID, command string) (string, []string, error)
	// AbortAgent undoes ComposeAgent's persisted side effects when Open fails after a successful
	// compose. Set together with ComposeAgent; a no-op for a terminalID it composed nothing for.
	AbortAgent func(terminalID string)
}

// svc is the internal/terminal.Service this bound type delegates its generic half to — built fresh
// per call rather than stored, since it is a stateless pair of pointers already held as Emit/Registry.
func (b *BoundService) svc() *Service {
	return &Service{Emit: b.Emit, Registry: b.Registry}
}

// ShutdownBound closes every live session — main.go's own teardown. A package function, not a
// method: Wails binds every exported method of the registered type, promoted ones included, and a
// bound Shutdown would let any window close every terminal.
func ShutdownBound(b *BoundService) {
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
	// session count, no dependency on the hooks. P129: Kira Space sets ComposeAgent below, so its
	// own claude-code launches are composed and tracked; Kira Studio leaves it nil, so its Open is
	// unchanged.
	agent := args.LaunchKind == LaunchKindClaudeCode

	command, env := args.Command, []string(nil)
	composedAgent := agent && b.ComposeAgent != nil
	if composedAgent {
		composed, composedEnv, err := b.ComposeAgent(args.TerminalID, command)
		if err != nil {
			return OpenResult{}, ipcerr.New("E_INVALID", err.Error())
		}
		// ValidateOpen already checked args.Command alone; composing can grow it (the `--settings`
		// flag, a quoted prompt), so the same bound is rechecked here with the same message.
		if len(composed) > MaxCommandBytes {
			b.abortAgent(args.TerminalID)
			return OpenResult{}, ipcerr.New("E_INVALID", "command is too long")
		}
		command, env = composed, composedEnv
	}

	sess, err := b.svc().OpenWithCoalescedOutput(OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   command,
		Env:       env,
		Agent:     agent,
	}, args.WindowKey, args.TerminalID)
	if err != nil {
		if composedAgent {
			b.abortAgent(args.TerminalID)
		}
		if errors.Is(err, ErrDuplicateSession) {
			return OpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
		}
		if errors.Is(err, ErrRegistryClosed) {
			return OpenResult{}, ipcerr.New("E_INVALID", "terminal window is closing")
		}
		return OpenResult{}, ipcerr.InternalErr(err)
	}

	return OpenResult{Shell: sess.Shell()}, nil
}

func (b *BoundService) abortAgent(terminalID string) {
	if b.AbortAgent != nil {
		b.AbortAgent(terminalID)
	}
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
