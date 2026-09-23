package bridge

import (
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// AgentHooksService is the Claude Code settings section's whole surface (P86 §7/§9.3): Status,
// SetEnabled. Copies DbMcpService's own shape exactly — it owns the embedded *agenthooks.Server's
// actual lifecycle, constructed and started when the setting turns on (or already is, at boot),
// stopped when it turns off or the app quits. TerminalService.Open reads LaunchFor on every
// Claude Code launch (§9.1: "the setting is read at every launch", never cached).
type AgentHooksService struct {
	Deps appcore.Deps

	embedded embeddedService[*agenthooks.Server, AgentHooksStatus]
}

// NewAgentHooksService wires the embedded lifecycle's own start/stop/status closures once, here,
// so every other method can assume s.embedded is ready — a plain struct literal (main.go's own
// shape before T2-13) would leave them nil.
func NewAgentHooksService(deps appcore.Deps) *AgentHooksService {
	s := &AgentHooksService{Deps: deps}
	s.embedded = embeddedService[*agenthooks.Server, AgentHooksStatus]{
		startFn: func(bool) (*agenthooks.Server, error) {
			return agenthooks.New(agenthooks.Options{OnEvent: s.onEvent})
		},
		stopFn: func(srv *agenthooks.Server) {
			if err := srv.Close(); err != nil {
				slog.Warn("agent hooks: close embedded server", "scope", "agenthooks", "err", err)
			}
		},
		statusFn: func(srv *agenthooks.Server) AgentHooksStatus {
			if srv == nil {
				return AgentHooksStatus{}
			}
			return AgentHooksStatus{Running: true, SettingsPath: srv.SettingsPath()}
		},
	}
	return s
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

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *AgentHooksService) Status() AgentHooksStatus {
	return s.embedded.Status()
}

// onEvent is agenthooks.Options.OnEvent's own callback — broadcasts every hook firing to every
// window (§8.4: Emit, not EmitTo, since this has no window to address). The receiving window
// filters by terminalId against tabs it owns; state/agentSessions.ts's reducer is the consumer.
func (s *AgentHooksService) onEvent(ev agenthooks.Event) {
	s.Deps.Events.Emit(ChannelAgentEvent, toWireAgentEvent(ev))
}

// AgentEventWire is agenthooks.Event's own wire projection — ChannelAgentEvent's payload, one hook
// firing for one tab. Field-for-field identical to the domain type today, kept as its own wire
// struct anyway (AgentSessionWire's own precedent, just above in terminal.go): the bridge layer's
// wire contract stays decoupled from internal/agenthooks's own struct even where they currently
// match.
type AgentEventWire struct {
	TerminalID       string `json:"terminalId"`
	Event            string `json:"event"`
	SessionID        string `json:"sessionId"`
	Cwd              string `json:"cwd"`
	ToolName         string `json:"toolName"`
	ToolUseID        string `json:"toolUseId"`
	NotificationType string `json:"notificationType"`
	Message          string `json:"message"`
	Source           string `json:"source"`
	Reason           string `json:"reason"`
}

func toWireAgentEvent(ev agenthooks.Event) AgentEventWire {
	return AgentEventWire{
		TerminalID:       ev.TerminalID,
		Event:            ev.Event,
		SessionID:        ev.SessionID,
		Cwd:              ev.Cwd,
		ToolName:         ev.ToolName,
		ToolUseID:        ev.ToolUseID,
		NotificationType: ev.NotificationType,
		Message:          ev.Message,
		Source:           ev.Source,
		Reason:           ev.Reason,
	}
}

// startIfEnabled is main.go's own boot-time call, mirroring StartDbMcpIfEnabled's own posture
// exactly: a failure (curl missing, a bind conflict) is logged, never fatal — the app boots
// regardless.
//
// Unexported, reached only through StartAgentHooksIfEnabled below: Wails binds every exported
// method of a registered service, and a wire-callable Start would let a stray call bypass the
// settings leaf.
func (s *AgentHooksService) startIfEnabled() {
	s.embedded.startIfEnabled("agenthooks", func() (bool, error) {
		settings, err := s.Deps.Repos.Settings.GetAll()
		if err != nil {
			return false, err
		}
		return settings.ClaudeCode.HooksEnabled, nil
	})
}

// stop is main.go's own shutdown call, beside bridge.StopDbMcp — see startIfEnabled's own note on
// why this is unexported and reached only through StopAgentHooks.
func (s *AgentHooksService) stop() {
	s.embedded.stop()
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

	st, err := s.embedded.setRunning(args.Enabled)
	if err != nil {
		slog.Warn("agent hooks: start on enable", "scope", "agenthooks", "err", err)
		st.Error = err.Error()
	}
	return st, nil
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
	s.embedded.mu.Lock()
	defer s.embedded.mu.Unlock()
	if s.embedded.server == nil {
		return "", nil, false
	}
	return s.embedded.server.SettingsPath(), s.embedded.server.Env(terminalID), true
}
