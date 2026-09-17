package bridge

import (
	"log/slog"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// AgentHooksService is the Claude Code settings section's whole surface (P86 §7/§9.3): Status,
// SetEnabled. Copies DbMcpService's own shape exactly — it owns the embedded *agenthooks.Server's
// actual lifecycle, constructed and started when the setting turns on (or already is, at boot),
// stopped when it turns off or the app quits. TerminalService.Open reads LaunchFor on every
// Claude Code launch (§9.1: "the setting is read at every launch", never cached).
type AgentHooksService struct {
	Deps appcore.Deps

	mu     sync.Mutex
	server *agenthooks.Server
}

// AgentHooksStatus is the wire projection every method below returns.
type AgentHooksStatus struct {
	Running bool `json:"running"`
	// SettingsPath is the generated hooks.json's own absolute path, shown only while running
	// (§9.3) — the "outside your project" claim is checkable, not just asserted.
	SettingsPath string `json:"settingsPath"`
	// Error names why Running is false despite the setting being on — a bind failure, or curl not
	// found (§5.2). "" whenever Running is true, or the setting is simply off.
	Error string `json:"error"`
}

func (s *AgentHooksService) statusLocked() AgentHooksStatus {
	if s.server == nil {
		return AgentHooksStatus{}
	}
	return AgentHooksStatus{Running: true, SettingsPath: s.server.SettingsPath()}
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *AgentHooksService) Status() AgentHooksStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// startLocked constructs and starts a new embedded instance if one is not already running. mu
// must be held by the caller.
func (s *AgentHooksService) startLocked() error {
	if s.server != nil {
		return nil
	}
	srv, err := agenthooks.New(agenthooks.Options{OnEvent: s.onEvent})
	if err != nil {
		return err
	}
	s.server = srv
	return nil
}

// onEvent is agenthooks.Options.OnEvent's own callback — a no-op until P86 commit 5 wires
// ChannelAgentEvent through it (this commit only starts/stops the listener; nothing consumes an
// event yet, exactly as §21's own commit ordering lays out: "3. opt in... 5. show what a session
// is doing").
func (s *AgentHooksService) onEvent(agenthooks.Event) {}

// stopLocked stops and drops the embedded instance, if any. mu must be held by the caller.
func (s *AgentHooksService) stopLocked() {
	if s.server == nil {
		return
	}
	if err := s.server.Close(); err != nil {
		slog.Warn("agent hooks: close embedded server", "scope", "agenthooks", "err", err)
	}
	s.server = nil
}

// startIfEnabled is main.go's own boot-time call, mirroring StartDbMcpIfEnabled's own posture
// exactly: a failure (curl missing, a bind conflict) is logged, never fatal — the app boots
// regardless.
//
// Unexported, reached only through StartAgentHooksIfEnabled below — repomap.go's own startIfEnabled
// doc comment explains why (Wails binds every exported method of a registered service, and a
// wire-callable Start would let a stray call bypass the settings leaf).
func (s *AgentHooksService) startIfEnabled() {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("agent hooks: read settings at boot", "scope", "agenthooks", "err", err)
		return
	}
	if !settings.ClaudeCode.HooksEnabled {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.startLocked(); err != nil {
		slog.Warn("agent hooks: start at boot", "scope", "agenthooks", "err", err)
	}
}

// stop is main.go's own shutdown call, beside bridge.StopDbMcp — see startIfEnabled's own note on
// why this is unexported and reached only through StopAgentHooks.
func (s *AgentHooksService) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

// StartAgentHooksIfEnabled and StopAgentHooks are main.go's own boot/shutdown hooks for the
// embedded instance, package-level functions rather than exported methods on AgentHooksService —
// StartDbMcpIfEnabled/StopDbMcp's own identical reasoning.
func StartAgentHooksIfEnabled(s *AgentHooksService) { s.startIfEnabled() }
func StopAgentHooks(s *AgentHooksService)           { s.stop() }

// AgentHooksSetEnabledArgs is SetEnabled's own argument shape.
type AgentHooksSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the embedded instance in the same call
// (the toggle bypasses the dialog's draft/Save flow entirely, an instant action, mirroring
// DbMcpService.SetEnabled).
func (s *AgentHooksService) SetEnabled(args AgentHooksSetEnabledArgs) (AgentHooksStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		ClaudeCode: &model.ClaudeCodePatch{HooksEnabled: &args.Enabled},
	})
	if err != nil {
		return AgentHooksStatus{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	s.mu.Lock()
	defer s.mu.Unlock()
	if args.Enabled {
		if err := s.startLocked(); err != nil {
			slog.Warn("agent hooks: start on enable", "scope", "agenthooks", "err", err)
			st := s.statusLocked()
			st.Error = err.Error()
			return st, nil
		}
	} else {
		s.stopLocked()
	}
	return s.statusLocked(), nil
}

// launchFor returns the generated hooks.json path and the three env vars a Claude Code launch's
// shell needs (§5.4), or ok=false when nothing is running (hooks disabled, or a start failure) —
// internal/bridge/terminal.go's own Open composes the `--settings` flag and env only when ok.
// Unexported, not because §9.1's "read at every launch" is a wire-callable action (it is only
// ever composed server-side, ahead of a real process spawn) but because it hands back
// KIRA_AGENT_HOOK_TOKEN in plain text (§5.4): Wails binds every exported method of a registered
// service, and a wire-callable version of this would leak that token to anything running in the
// webview. terminal.go reaches it directly — same package, no wire hop.
func (s *AgentHooksService) launchFor(terminalID string) (path string, env []string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return "", nil, false
	}
	return s.server.SettingsPath(), s.server.Env(terminalID), true
}
