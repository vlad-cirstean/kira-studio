package bridge

import (
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// TerminalService is P83 §3.2's own bound surface over internal/terminal — a Wails service plus
// ChannelTerminal's push channel. Reachable only from this process's own webview: a PTY handler is
// never exposed to an externally paired client.
type TerminalService struct {
	Emit     appcore.Emitter
	Registry *terminal.Registry
}

// svc is the internal/terminal.Service this bound type delegates its generic half to (P107 T2-7)
// — built fresh per call rather than stored, since it is a stateless pair of pointers already held
// as Emit/Registry.
func (s *TerminalService) svc() *terminal.Service {
	return &terminal.Service{Emit: s.Emit, Registry: s.Registry}
}

// Shutdown closes every live session — called from main.go's own teardown.
func (s *TerminalService) Shutdown() {
	s.Registry.CloseAll()
}

// TerminalDefaultCwdResult is DefaultCwd's own wire shape — Path is "" when $HOME can't be
// resolved (P91 §7.1: a missing home directory must not fail boot).
type TerminalDefaultCwdResult struct {
	Path string `json:"path"`
}

// DefaultCwd is P91 §7's own read-only, argument-free call — the user's home directory, every
// terminal's own launch cwd. Read-only, no arguments: nothing renderer-controlled reaches the OS
// here.
func (s *TerminalService) DefaultCwd() TerminalDefaultCwdResult {
	return TerminalDefaultCwdResult{Path: terminal.DefaultCwd()}
}

type TerminalOpenArgs struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
	WindowKey  string `json:"windowKey"`
	// Command, when non-empty, runs as `$SHELL -l -i -c Command` instead of a plain login shell
	// (P85 §2.1) — the initial command a Claude Code or custom-script launch seeds the tab with.
	Command string `json:"command"`
	// LaunchKind is P86 §4's own discriminator — one of launchKindShell/ClaudeCode/Script, never
	// inferred from Command (P85 OQ-3's "no heuristic" rule, carried forward). "" is accepted and
	// treated as launchKindShell, so an older caller keeps working.
	LaunchKind string `json:"launchKind"`
}

// P86 §4: TerminalOpenArgs.LaunchKind's three wire values are internal/terminal's own
// LaunchKindShell/ClaudeCode/Script (P107 T2-7). Only LaunchKindClaudeCode counts toward
// OpenParams.Agent (P87's own keep-awake input, §2.5); a custom script that happens to run `claude`
// counts as a script, deliberately (§4: "so the implementation does not 'fix' it into a
// heuristic").

type TerminalOpenResult struct {
	Shell string `json:"shell"`
}

type TerminalWriteArgs struct {
	TerminalID string `json:"terminalId"`
	// Data is base64 — keystrokes are not always valid UTF-8 (paste, Alt-meta, mouse reports).
	Data string `json:"data"`
}

type TerminalResizeArgs struct {
	TerminalID string `json:"terminalId"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
}

type TerminalCloseArgs struct {
	TerminalID string `json:"terminalId"`
}

// Open validates args, spawns a new session and returns its resolved shell path. terminalId is
// client-supplied (the tab id) so the renderer subscribes to ChannelTerminal before this call
// returns — no output can race the subscription. The cwd check below is not a trust boundary and
// must not be read as one: the shell it starts is the user's own and can `cd` anywhere on its
// first line. It exists so a stale path fails with a clear E_INVALID instead of a confusing exec
// error.
func (s *TerminalService) Open(args TerminalOpenArgs) (TerminalOpenResult, error) {
	if err := terminal.ValidateOpen(terminal.OpenArgs(args)); err != nil {
		return TerminalOpenResult{}, err
	}
	// P127: agent-activity monitoring (the `--settings` flag, the hook env vars) left Kira Studio;
	// agent stays — it is P87's own keep-awake input (§2.5), read from internal/terminal's registry
	// count, no dependency on the hooks.
	agent := args.LaunchKind == terminal.LaunchKindClaudeCode

	sess, err := s.svc().OpenWithCoalescedOutput(terminal.OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   args.Command,
		Agent:     agent,
	}, args.WindowKey, args.TerminalID)
	if err != nil {
		if errors.Is(err, terminal.ErrDuplicateSession) {
			return TerminalOpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
		}
		return TerminalOpenResult{}, ipcerr.InternalErr(err)
	}

	return TerminalOpenResult{Shell: sess.Shell()}, nil
}

// Write decodes args.Data and forwards it to the pty. A no-op for an id with no live session
// (Registry.Write's own rule) — the renderer can have a keystroke in flight when a shell exits.
func (s *TerminalService) Write(args TerminalWriteArgs) error {
	return s.svc().Write(args.TerminalID, args.Data)
}

// Resize applies cols/rows to the real winsize (pty.Setsize) — a no-op for an id with no live
// session.
func (s *TerminalService) Resize(args TerminalResizeArgs) error {
	return s.svc().Resize(args.TerminalID, args.Cols, args.Rows)
}

// Close kills args.TerminalID's own session — idempotent, per internal/terminal.Session.Close.
func (s *TerminalService) Close(args TerminalCloseArgs) error {
	return s.svc().Close(args.TerminalID)
}
