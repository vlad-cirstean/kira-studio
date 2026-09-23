package bridge

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// TerminalService is P83 §3.2's own bound surface over internal/terminal — a Wails service plus
// ChannelTerminal's push channel, deliberately not on the git contract (§3.1: gitsock hands its
// router to an externally paired client with no allowlist wrapper, and a PTY handler is exactly
// the risk gitstream.go already refuses worktree.prepare for). Reachable only from this process's
// own webview.
type TerminalService struct {
	Emit     appcore.Emitter
	Registry *terminal.Registry
	// AgentHooks is P86 §8.3's own optional collaborator — nil in any test that constructs
	// TerminalService directly without it, in which case Open behaves exactly as P85 left it (no
	// `--settings` flag, no extra env, ever).
	AgentHooks *AgentHooksService
}

// svc is the internal/terminal.Service this bound type delegates its generic half to (P107 T2-7)
// — built fresh per call rather than stored, since it is a stateless pair of pointers already held
// as Emit/Registry.
func (s *TerminalService) svc() *terminal.Service {
	return &terminal.Service{Emit: s.Emit, Registry: s.Registry}
}

// Shutdown closes every live session — app teardown (main.go's teardown, beside
// codeWorkspaceSvc.Shutdown()).
func (s *TerminalService) Shutdown() {
	s.Registry.CloseAll()
}

// AgentSessionWire is terminal.AgentSession's own wire projection — AgentSessionsEvent's own
// per-session shape (P86 §11), field for field.
type AgentSessionWire struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
}

// AgentSessionsEvent is ChannelAgentSessions' own payload — a list, not a bare count (§11): a bare
// number would leave the widget's own tooltip unable to say *which* sessions are running.
type AgentSessionsEvent struct {
	Sessions []AgentSessionWire `json:"sessions"`
}

func toWireAgentSessions(sessions []terminal.AgentSession) []AgentSessionWire {
	out := make([]AgentSessionWire, len(sessions))
	for i, s := range sessions {
		out[i] = AgentSessionWire{TerminalID: s.ID, Cwd: s.Cwd}
	}
	return out
}

// AgentSessions is the boot-time hydrate (§12) — a window opened after every currently-live
// session already started needs a snapshot, since ChannelAgentSessions only fires on change.
func (s *TerminalService) AgentSessions() AgentSessionsEvent {
	return AgentSessionsEvent{Sessions: toWireAgentSessions(s.Registry.AgentSessions())}
}

// emitAgentSessions is terminal.Registry.OnChange's own callback body — Emit, not EmitTo: the
// count is app-wide by definition (§11), so every window's widget sees the same list.
func (s *TerminalService) emitAgentSessions() {
	s.Emit.Emit(ChannelAgentSessions, s.AgentSessions())
}

// TerminalAgentSessionsChanged is main.go's own Registry.OnChange target — a package-level
// function rather than a call to the exported method a Wails-bound Registry.OnChange closure
// would need, because every exported method of a registered service is bound to the wire:
// emitAgentSessions itself stays unexported so it can never become a renderer-triggerable
// broadcast, and this function is the one place outside this package allowed to reach it.
func TerminalAgentSessionsChanged(s *TerminalService) {
	s.emitAgentSessions()
}

// TerminalDefaultCwdResult is DefaultCwd's own wire shape — Path is "" when $HOME can't be
// resolved (P91 §7.1: a missing home directory must not fail boot).
type TerminalDefaultCwdResult struct {
	Path string `json:"path"`
}

// DefaultCwd is P91 §7's own read-only, argument-free call — the user's home directory, for the
// Terminal module's unscoped launches (a repo-scoped terminal keeps using internal/gitsession's
// own worktree-cwd resolution, untouched by this phase). Read-only, no arguments: nothing
// renderer-controlled reaches the OS here.
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
// LaunchKindShell/ClaudeCode/Script (P107 T2-7). Only LaunchKindClaudeCode ever gets hooks (§8.3)
// or counts toward the agent widget (§11); a custom script that happens to run `claude` counts as
// a script, deliberately (§4: "so the implementation does not 'fix' it into a heuristic").

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
	if args.TerminalID == "" {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "terminalId is required")
	}
	if args.WindowKey == "" {
		return TerminalOpenResult{}, ipcerr.BadRequest("windowKey is required")
	}
	if !terminal.ValidDim(args.Cols) || !terminal.ValidDim(args.Rows) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	if !filepath.IsAbs(args.Cwd) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cwd must be an absolute path")
	}
	info, err := os.Stat(args.Cwd)
	if err != nil || !info.IsDir() {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cwd does not exist or is not a directory")
	}
	if len(args.Command) > terminal.MaxCommandBytes {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "command is too long")
	}
	if !terminal.ValidLaunchKind(args.LaunchKind) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "launchKind must be shell, claude-code or script")
	}
	agent := args.LaunchKind == terminal.LaunchKindClaudeCode

	// P86 §8.3/§9.1: the setting is read at every launch — only a claude-code launch with the
	// listener actually running gets the `--settings` flag and the three hook env vars; a plain
	// terminal or a custom script gets neither, and hooks off leaves the command the literal
	// `claude`, byte for byte (§2.1).
	command, env := args.Command, []string(nil)
	if agent && s.AgentHooks != nil {
		if path, hookEnv, ok := s.AgentHooks.launchFor(args.TerminalID); ok {
			quoted, err := agenthooks.ShellSingleQuote(path)
			if err != nil {
				slog.Warn("terminal: quote agent hooks settings path", "scope", "terminal", "err", err)
			} else {
				command += " --settings " + quoted
				env = hookEnv
			}
		}
	}

	sess, err := s.svc().OpenWithCoalescedOutput(terminal.OpenParams{
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
		if errors.Is(err, terminal.ErrDuplicateSession) {
			return TerminalOpenResult{}, ipcerr.New("E_INVALID", "terminalId is already open")
		}
		return TerminalOpenResult{}, ipcerr.Internal(err.Error())
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
