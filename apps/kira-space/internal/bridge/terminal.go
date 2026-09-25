package bridge

import (
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// TerminalService is Kira Studio's own TerminalService (internal/bridge/terminal.go), trimmed: no
// AgentHooks field and no AgentSessions/ChannelAgentSessions machinery. P100 Part 2's own
// duplicated internal/terminal package (not hoisted — Go's internal/ rule, this file's own
// package doc comment) has no Claude Code hook integration in scope for this app, so `Open` never
// composes a `--settings` flag or extra env — LaunchKind is still accepted and validated (the
// wire vocabulary a ported RepoTerminalView.vue/terminals.ts tab still sends), it simply never
// changes what gets launched.
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

// Shutdown closes every live session — app teardown.
func (s *TerminalService) Shutdown() {
	s.Registry.CloseAll()
}

// TerminalDefaultCwdResult is DefaultCwd's own wire shape — Path is "" when $HOME can't be
// resolved.
type TerminalDefaultCwdResult struct {
	Path string `json:"path"`
}

// DefaultCwd is the user's home directory, for an unscoped terminal launch — a repo-scoped
// terminal keeps using internal/gitsession's own worktree-cwd resolution.
func (s *TerminalService) DefaultCwd() TerminalDefaultCwdResult {
	return TerminalDefaultCwdResult{Path: terminal.DefaultCwd()}
}

type TerminalOpenArgs struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
	WindowKey  string `json:"windowKey"`
	// Command, when non-empty, runs as `$SHELL -l -i -c Command` instead of a plain login shell.
	Command string `json:"command"`
	// LaunchKind is Kira Studio's own discriminator (one of internal/terminal's own
	// LaunchKindShell/ClaudeCode/Script), never inferred from Command. "" is accepted and treated
	// as terminal.LaunchKindShell.
	LaunchKind string `json:"launchKind"`
}

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

// Open validates args, spawns a new session and returns its resolved shell path — Kira Studio's
// own Open, minus the AgentHooks command/env composition.
func (s *TerminalService) Open(args TerminalOpenArgs) (TerminalOpenResult, error) {
	if err := terminal.ValidateOpen(terminal.OpenArgs{
		TerminalID: args.TerminalID, WindowKey: args.WindowKey, Cwd: args.Cwd,
		Cols: args.Cols, Rows: args.Rows, Command: args.Command, LaunchKind: args.LaunchKind,
	}); err != nil {
		return TerminalOpenResult{}, err
	}

	sess, err := s.svc().OpenWithCoalescedOutput(terminal.OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   args.Command,
	}, args.WindowKey, args.TerminalID)
	if err != nil {
		if errors.Is(err, terminal.ErrDuplicateSession) {
			return TerminalOpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
		}
		return TerminalOpenResult{}, ipcerr.InternalErr(err)
	}

	return TerminalOpenResult{Shell: sess.Shell()}, nil
}

// Write decodes args.Data and forwards it to the pty. A no-op for an id with no live session.
func (s *TerminalService) Write(args TerminalWriteArgs) error {
	return s.svc().Write(args.TerminalID, args.Data)
}

// Resize applies cols/rows to the real winsize. A no-op for an id with no live session.
func (s *TerminalService) Resize(args TerminalResizeArgs) error {
	return s.svc().Resize(args.TerminalID, args.Cols, args.Rows)
}

// Close kills args.TerminalID's own session — idempotent.
func (s *TerminalService) Close(args TerminalCloseArgs) error {
	return s.svc().Close(args.TerminalID)
}
