package bridge

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

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
	home, err := os.UserHomeDir()
	if err != nil {
		return TerminalDefaultCwdResult{Path: ""}
	}
	return TerminalDefaultCwdResult{Path: home}
}

type TerminalOpenArgs struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
	Cols       int    `json:"cols"`
	Rows       int    `json:"rows"`
	WindowKey  string `json:"windowKey"`
	// Command, when non-empty, runs as `$SHELL -l -i -c Command` instead of a plain login shell.
	Command string `json:"command"`
	// LaunchKind is Kira Studio's own discriminator (one of launchKindShell/ClaudeCode/Script),
	// never inferred from Command. "" is accepted and treated as launchKindShell.
	LaunchKind string `json:"launchKind"`
}

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

const maxTerminalDim = 1000
const maxTerminalCommandBytes = 64 * 1024

func validTerminalDim(n int) bool { return n >= 1 && n <= maxTerminalDim }

// Open validates args, spawns a new session and returns its resolved shell path — Kira Studio's
// own Open, minus the AgentHooks command/env composition.
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

	coalescer := newTerminalCoalescer(s.Emit, args.WindowKey, args.TerminalID)
	sess, err := s.Registry.Open(terminal.OpenParams{
		ID:        args.TerminalID,
		WindowKey: args.WindowKey,
		Cwd:       args.Cwd,
		Cols:      uint16(args.Cols),
		Rows:      uint16(args.Rows),
		Command:   args.Command,
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

// Write decodes args.Data and forwards it to the pty. A no-op for an id with no live session.
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

// Resize applies cols/rows to the real winsize. A no-op for an id with no live session.
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

// Close kills args.TerminalID's own session — idempotent.
func (s *TerminalService) Close(args TerminalCloseArgs) error {
	if args.TerminalID == "" {
		return ipcerr.New("E_INVALID", "terminalId is required")
	}
	s.Registry.Close(args.TerminalID)
	return nil
}

// ---- the coalescing terminal-output push channel — Kira Studio's own terminalCoalescer, unchanged ----

const (
	terminalCoalesceInterval = 16 * time.Millisecond
	terminalCoalesceMaxBytes = 16 * 1024
)

// TerminalEvent is ChannelTerminal's own payload — one coalesced chunk of a session's output, or
// its exit.
type TerminalEvent struct {
	TerminalID string `json:"terminalId"`
	Data       string `json:"data,omitempty"`
	Exited     bool   `json:"exited"`
	ExitCode   *int   `json:"exitCode,omitempty"`
	Error      string `json:"error,omitempty"`
}

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
