package bridge

import (
	"encoding/base64"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/terminal"
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

// Shutdown closes every live session — app teardown (main.go's teardown, beside
// codeWorkspaceSvc.Shutdown()).
func (s *TerminalService) Shutdown() {
	s.Registry.CloseAll()
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

// P86 §4: the three wire values TerminalOpenArgs.LaunchKind accepts — packages/shared/domain/
// tabs.ts's terminalLaunchKindSchema, field for field. Only launchKindClaudeCode ever gets hooks
// (§8.3) or counts toward the agent widget (§11); a custom script that happens to run `claude`
// counts as a script, deliberately (§4: "so the implementation does not 'fix' it into a heuristic").
const (
	launchKindShell      = "shell"
	launchKindClaudeCode = "claude-code"
	launchKindScript     = "script"
)

func validLaunchKind(v string) bool {
	switch v {
	case "", launchKindShell, launchKindClaudeCode, launchKindScript:
		return true
	default:
		return false
	}
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

// maxTerminalDim is §3.2's own [1, 1000] bound on cols/rows — generous for any real display, tight
// enough that a malformed arg cannot ask the pty for an absurd winsize.
const maxTerminalDim = 1000

// maxTerminalCommandBytes bounds args.Command well under macOS's ARG_MAX (1 MiB for argv plus
// environment together, P85 §4) — a clear E_INVALID instead of an opaque E2BIG out of exec.
const maxTerminalCommandBytes = 64 * 1024

func validTerminalDim(n int) bool { return n >= 1 && n <= maxTerminalDim }

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
	if !validTerminalDim(args.Cols) || !validTerminalDim(args.Rows) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	if !filepath.IsAbs(args.Cwd) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cwd must be an absolute path")
	}
	info, err := os.Stat(args.Cwd)
	if err != nil || !info.IsDir() {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "cwd does not exist or is not a directory")
	}
	if len(args.Command) > maxTerminalCommandBytes {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "command is too long")
	}
	if !validLaunchKind(args.LaunchKind) {
		return TerminalOpenResult{}, ipcerr.New("E_INVALID", "launchKind must be shell, claude-code or script")
	}
	agent := args.LaunchKind == launchKindClaudeCode

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

	coalescer := newTerminalCoalescer(s.Emit, args.WindowKey, args.TerminalID)
	sess, err := s.Registry.Open(terminal.OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   command,
		Env:       env,
		Agent:     agent,
		OnData:    coalescer.push,
		OnExit: func(code int, exitErr error) {
			msg := ""
			if exitErr != nil {
				msg = exitErr.Error()
			}
			coalescer.finish(code, msg)
		},
	})
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
	if args.TerminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	data, err := base64.StdEncoding.DecodeString(args.Data)
	if err != nil {
		return ipcerr.New("E_INVALID", "data must be base64")
	}
	if err := s.Registry.Write(args.TerminalID, data); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// Resize applies cols/rows to the real winsize (pty.Setsize) — a no-op for an id with no live
// session.
func (s *TerminalService) Resize(args TerminalResizeArgs) error {
	if args.TerminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	if !validTerminalDim(args.Cols) || !validTerminalDim(args.Rows) {
		return ipcerr.New("E_INVALID", "cols/rows must be within [1, 1000]")
	}
	if err := s.Registry.Resize(args.TerminalID, uint16(args.Cols), uint16(args.Rows)); err != nil {
		return ipcerr.Internal(err.Error())
	}
	return nil
}

// Close kills args.TerminalID's own session — idempotent, per internal/terminal.Session.Close.
func (s *TerminalService) Close(args TerminalCloseArgs) error {
	if args.TerminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	s.Registry.Close(args.TerminalID)
	return nil
}

// ---- §3.3: the coalescing terminal-output push channel ----

const (
	terminalCoalesceInterval = 16 * time.Millisecond
	terminalCoalesceMaxBytes = 16 * 1024
)

// TerminalEvent is ChannelTerminal's own payload (packages/shared/protocol/events.ts's
// terminalEventSchema, field for field) — one coalesced chunk of a session's output, or its exit.
type TerminalEvent struct {
	TerminalID string `json:"terminalId"`
	Data       string `json:"data,omitempty"` // base64, absent on the exit event
	Exited     bool   `json:"exited"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	Error      string `json:"error,omitempty"`
}

// terminalCoalescer is searchCoalescer's own rules (codeworkspace.go), restated for a byte
// payload rather than generified — the two payloads share no field, the same reasoning
// newSearchCoalescer itself was built on: flush on 16 KiB accumulated or a 16ms timer, whichever
// first; the exit event always flushes, even with nothing pending, so the renderer's "running"
// state can never strand.
type terminalCoalescer struct {
	emit       appcore.Emitter
	windowKey  string
	terminalID string

	mu      sync.Mutex
	pending []byte
	timer   *time.Timer
	done    bool
}

func newTerminalCoalescer(emit appcore.Emitter, windowKey, terminalID string) *terminalCoalescer {
	return &terminalCoalescer{emit: emit, windowKey: windowKey, terminalID: terminalID}
}

// push is the session's own reader goroutine calling in — one call at a time per session, but the
// mutex still guards against push and the coalesce timer's own onTimer racing each other.
func (c *terminalCoalescer) push(b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.pending = append(c.pending, b...)
	if len(c.pending) >= terminalCoalesceMaxBytes {
		c.flushLocked(false, nil, "")
		return
	}
	if c.timer == nil {
		c.timer = time.AfterFunc(terminalCoalesceInterval, c.onTimer)
	}
}

func (c *terminalCoalescer) onTimer() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done || len(c.pending) == 0 {
		return
	}
	c.flushLocked(false, nil, "")
}

// finish is the terminal flush — always sent, even with nothing pending, so the renderer's
// "running" state can never strand.
func (c *terminalCoalescer) finish(exitCode int, errMsg string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.flushLocked(true, &exitCode, errMsg)
	c.done = true
}

func (c *terminalCoalescer) flushLocked(exited bool, exitCode *int, errMsg string) {
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	var data string
	if len(c.pending) > 0 {
		data = base64.StdEncoding.EncodeToString(c.pending)
		c.pending = nil
	}
	c.emit.EmitTo(c.windowKey, ChannelTerminal, TerminalEvent{
		TerminalID: c.terminalID, Data: data, Exited: exited, ExitCode: exitCode, Error: errMsg,
	})
}
