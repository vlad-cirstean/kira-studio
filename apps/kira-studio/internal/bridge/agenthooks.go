package bridge

import (
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// AgentHooksService is the Claude Code settings section's whole surface (P86 §7/§9.3): Status,
// SetEnabled. It owns an agenthooks.Manager's lifecycle, started when the setting turns on (or
// already is, at boot), stopped when it turns off or the app quits.
// TerminalService.Open reads composeLaunch on every Claude Code launch (§9.1: "the setting is
// read at every launch", never cached).
type AgentHooksService struct {
	Deps appcore.Deps

	mgr *agenthooks.Manager
}

// NewAgentHooksService wires the Manager once, here, so every other method can assume s.mgr is
// ready.
func NewAgentHooksService(deps appcore.Deps) *AgentHooksService {
	s := &AgentHooksService{Deps: deps}
	s.mgr = agenthooks.NewManager(agenthooks.Options{OnEvent: s.onEvent})
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

// Status reads the Manager's current state — never starts or stops anything.
func (s *AgentHooksService) Status() AgentHooksStatus {
	st := s.mgr.Status()
	return AgentHooksStatus{Running: st.Running, SettingsPath: st.SettingsPath}
}

// onEvent is agenthooks.Options.OnEvent's own callback — broadcasts every hook firing to every
// window (§8.4: Emit, not EmitTo, since this has no window to address). The receiving window
// filters by terminalId against tabs it owns; state/agentSessions.ts's reducer is the consumer.
// Emitted verbatim: agenthooks.Event's JSON tags already match ChannelAgentEvent's own payload
// shape field for field, so no separate wire-projection type is needed.
func (s *AgentHooksService) onEvent(ev agenthooks.Event) {
	s.Deps.Events.Emit(ChannelAgentEvent, ev)
}

// startIfEnabled is main.go's own boot-time call: a failure (curl missing, a bind conflict) is
// logged, never fatal — the app boots regardless.
//
// Unexported, reached only through StartAgentHooksIfEnabled below: Wails binds every exported
// method of a registered service, and a wire-callable Start would let a stray call bypass the
// settings leaf.
func (s *AgentHooksService) startIfEnabled() {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("agent hooks: read settings at boot", "scope", "agenthooks", "err", err)
		return
	}
	if !settings.ClaudeCode.HooksEnabled {
		return
	}
	if err := s.mgr.Start(); err != nil {
		slog.Warn("agent hooks: start at boot", "scope", "agenthooks", "err", err)
	}
}

// stop is main.go's own shutdown call, beside bridge.StopDbMcp — see startIfEnabled's own note on
// why this is unexported and reached only through StopAgentHooks.
func (s *AgentHooksService) stop() {
	if err := s.mgr.Stop(); err != nil {
		slog.Warn("agent hooks: stop", "scope", "agenthooks", "err", err)
	}
}

// StartAgentHooksIfEnabled and StopAgentHooks are main.go's own boot/shutdown hooks for the
// Manager, package-level functions rather than exported methods on AgentHooksService —
// StartDbMcpIfEnabled/StopDbMcp's own identical reasoning.
func StartAgentHooksIfEnabled(s *AgentHooksService) { s.startIfEnabled() }
func StopAgentHooks(s *AgentHooksService)           { s.stop() }

// AgentHooksSetEnabledArgs is SetEnabled's own argument shape.
type AgentHooksSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the Manager in the same call (the
// toggle bypasses the dialog's draft/Save flow entirely, an instant action, mirroring
// DbMcpService.SetEnabled).
func (s *AgentHooksService) SetEnabled(args AgentHooksSetEnabledArgs) (AgentHooksStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		ClaudeCode: &model.ClaudeCodePatch{HooksEnabled: &args.Enabled},
	})
	if err != nil {
		return AgentHooksStatus{}, ipcerr.InternalErr(err)
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	var lifecycleErr error
	if args.Enabled {
		lifecycleErr = s.mgr.Start()
	} else {
		lifecycleErr = s.mgr.Stop()
	}
	st := s.Status()
	if lifecycleErr != nil {
		slog.Warn("agent hooks: start on enable", "scope", "agenthooks", "err", lifecycleErr)
		st.Error = lifecycleErr.Error()
	}
	return st, nil
}

// composeLaunch is TerminalService.Open's own hook-launch composition (§9.1: the setting is read
// at every launch) — delegates to agenthooks.Manager.ComposeLaunch, which returns command
// unchanged and a nil env while stopped. Unexported: ComposeLaunch's env carries
// KIRA_AGENT_HOOK_TOKEN in plain text (§5.4), and Wails binds every exported method of a
// registered service — a wire-callable version of this would leak that token to the webview.
// terminal.go reaches it directly, same package, no wire hop.
func (s *AgentHooksService) composeLaunch(terminalID, command string) (string, []string) {
	return s.mgr.ComposeLaunch(terminalID, command)
}
