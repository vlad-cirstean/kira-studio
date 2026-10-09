package agenthooks

import (
	"log/slog"
	"sync"
)

// Manager is the host's entry point for the listener's lifecycle and the launch composer. It
// holds at most one running Server, guarded by mu — a host's own settings-gated toggle (read the
// setting, persist it, decide when to Start/Stop) stays entirely on the host side; Manager knows
// nothing about settings or which app is hosting it.
type Manager struct {
	mu   sync.Mutex
	srv  *Server
	opts Options
}

// Status is Manager.Status's own snapshot — a host's wire projection layers in whatever else it
// needs (an Error field, say) on top of this.
type Status struct {
	Running bool
	// SettingsPath is "" while stopped.
	SettingsPath string
}

// NewManager builds a Manager around opts — no Server is started yet.
func NewManager(opts Options) *Manager {
	return &Manager{opts: opts}
}

// Start starts a new Server if none is running — a no-op while one already is. New's error is
// returned as-is; a host logs it and continues (curl missing, a bind conflict are never fatal to
// the app, §5.2's own posture).
func (m *Manager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.srv != nil {
		return nil
	}
	srv, err := New(m.opts)
	if err != nil {
		return err
	}
	m.srv = srv
	return nil
}

// Stop closes the running Server, if any — a no-op while stopped. Close's error is returned as-is;
// a host logs it.
func (m *Manager) Stop() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.srv == nil {
		return nil
	}
	err := m.srv.Close()
	m.srv = nil
	return err
}

// Status reads the current state — never starts or stops anything.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.srv == nil {
		return Status{}
	}
	return Status{Running: true, SettingsPath: m.srv.SettingsPath()}
}

// ComposeLaunch returns command unchanged, with a nil env, while stopped. While running, it
// returns command with " --settings '<hooks.json>'" and, when the host supplies one, " --mcp-config
// '<file>'" appended, plus the three hook env vars a launch's shell needs (Server.Env's own doc).
// Both flags apply to this launch only; no Claude Code config file is written. The returned env
// carries KIRA_AGENT_HOOK_TOKEN in plain text — a host must never return it from a bound method;
// deciding which launches get composed at all (a claude-code launch, never a plain shell or
// script) is the host's own call, made before this is reached.
func (m *Manager) ComposeLaunch(terminalID, command string) (string, []string) {
	m.mu.Lock()
	srv := m.srv
	m.mu.Unlock()
	if srv == nil {
		return command, nil
	}
	composed := command + " --settings " + srv.quotedHooksPath
	arg, err := srv.mcpConfigArg()
	if err != nil {
		slog.Warn("agent hooks: session mcp config", "scope", "ade", "err", err)
	} else if arg != "" {
		composed += " --mcp-config " + arg
	}
	return composed, srv.Env(terminalID)
}
