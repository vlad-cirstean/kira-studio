package bridge

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// KeepAwakeService composes P87's two keep-awake reasons — the titlebar toggle and the agent-aware
// Settings leaf — onto one internal/keepawake.Controller. Modelled on AgentHooksService line for
// line: the renderer-facing methods are exported, the app-internal triggers (agent-session-count
// changes, system wake, boot/teardown) are package-level functions, since Wails binds every
// exported method of a registered service and none of those may be renderer-callable.
type KeepAwakeService struct {
	Deps appcore.Deps
	// Ctl is exported so main.go can inject the platform driver — TerminalService.Registry's own
	// shape. Wails binds a registered service's exported *methods*, never its fields, so this
	// widens nothing on the wire.
	Ctl *keepawake.Controller

	mu         sync.Mutex
	manual     bool
	agentCount int
}

// KeepAwakeStatus is the wire projection every method below returns, and ChannelKeepAwake's
// payload. Held/agentCount are deliberately not on the wire: the button shows its own (manual)
// source only — SPEC's "exactly two states" — never an "auto-held by an agent" third appearance.
type KeepAwakeStatus struct {
	// Manual is the titlebar button's own state — app-wide, process-scoped (§3.2: never persisted
	// across relaunch).
	Manual bool `json:"manual"`
	// Supported is false on every non-darwin build — the titlebar hides the button outright rather
	// than offering a control that does nothing.
	Supported bool `json:"supported"`
	// Error names why an acquire failed (caffeinate missing, spawn refused). "" otherwise.
	Error string `json:"error"`
}

func (s *KeepAwakeService) statusLocked() KeepAwakeStatus {
	st := KeepAwakeStatus{Supported: s.Ctl.Supported()}
	s.mu.Lock()
	st.Manual = s.manual
	s.mu.Unlock()
	if err := s.Ctl.Err(); err != nil {
		st.Error = err.Error()
	}
	return st
}

// Status reads the service's current state — never starts or stops anything. The boot-time
// hydrate, AgentHooksService.Status's own role.
func (s *KeepAwakeService) Status() KeepAwakeStatus {
	return s.statusLocked()
}

// KeepAwakeSetManualArgs is SetManual's own argument shape.
type KeepAwakeSetManualArgs struct {
	Enabled bool `json:"enabled"`
}

// SetManual flips the titlebar toggle's own reason and broadcasts the result to every window —
// Emit, not EmitTo, since the assertion is app-wide by definition (§3.2).
func (s *KeepAwakeService) SetManual(args KeepAwakeSetManualArgs) KeepAwakeStatus {
	s.mu.Lock()
	s.manual = args.Enabled
	s.mu.Unlock()
	s.Ctl.Set(keepawake.ReasonManual, args.Enabled)
	st := s.statusLocked()
	s.Deps.Events.Emit(ChannelKeepAwake, st)
	return st
}

// KeepAwakeSetAgentAwareArgs is SetAgentAware's own argument shape.
type KeepAwakeSetAgentAwareArgs struct {
	Enabled bool `json:"enabled"`
}

// SetAgentAware patches claudeCode.keepAwakeWithAgents, broadcasts the merged settings
// (SettingsService.Set's own contract), recomputes the agent reason against the setting's new
// value and the currently-tracked session count, and broadcasts the resulting keep-awake status —
// AgentHooksService.SetEnabled's own instant-action shape, with a different side effect.
func (s *KeepAwakeService) SetAgentAware(args KeepAwakeSetAgentAwareArgs) (KeepAwakeStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		ClaudeCode: &model.ClaudeCodePatch{KeepAwakeWithAgents: &args.Enabled},
	})
	if err != nil {
		return KeepAwakeStatus{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	s.recomputeAgent()
	st := s.statusLocked()
	s.Deps.Events.Emit(ChannelKeepAwake, st)
	return st, nil
}

// recomputeAgent reads claudeCode.keepAwakeWithAgents fresh from settings on every call — P86's
// own stated convention for this section ("read fresh at every launch, never cached"). The read is
// local SQLite and happens at most once per PTY open/close, settings toggle, or boot. A read
// failure is silently skipped (StartAgentHooksIfEnabled's own posture: never fatal), leaving the
// agent reason at whatever it already was.
func (s *KeepAwakeService) recomputeAgent() {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		return
	}
	s.mu.Lock()
	count := s.agentCount
	s.mu.Unlock()
	s.Ctl.Set(keepawake.ReasonAgent, settings.ClaudeCode.KeepAwakeWithAgents && count > 0)
}

// KeepAwakeAgentSessionsChanged is main.go's own trigger, wired onto terminal.Registry.OnChange —
// session.go documents OnChange as fired outside the registry mutex, so calling back in here is
// safe.
func KeepAwakeAgentSessionsChanged(s *KeepAwakeService, count int) {
	s.mu.Lock()
	s.agentCount = count
	s.mu.Unlock()
	s.recomputeAgent()
}

// KeepAwakeSystemDidWake is shell.AttachSystemWake's own trigger (§5) — release-then-reacquire
// while held, a no-op while idle (Controller.Rearm's own guard).
func KeepAwakeSystemDidWake(s *KeepAwakeService) {
	s.Ctl.Rearm()
}

// StartKeepAwake is main.go's own boot-time call — AgentHooksService's own startIfEnabled posture,
// recomputing the agent reason against whatever the setting already is (the session count starts
// at zero, so this is a no-op unless a later AgentSessionsChanged call raises it).
func StartKeepAwake(s *KeepAwakeService) {
	s.recomputeAgent()
}

// StopKeepAwake is main.go's own shutdown call — releases the assertion unconditionally,
// regardless of which reasons are still set, so the window between "app is quitting" and
// "caffeinate is dead" stays as short as possible.
func StopKeepAwake(s *KeepAwakeService) {
	s.Ctl.Close()
}
