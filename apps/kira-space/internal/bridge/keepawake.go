package bridge

import (
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/keepawake"
)

// KeepAwakeService composes two keep-awake reasons on one internal/keepawake.Controller: the title
// bar's manual toggle (Status/SetManual delegate entirely to internal/keepawake.Toggle, the shared
// manual-reason half both apps' own bound service wraps, P116 H3) and, since P188, the
// claudeCode.keepAwakeWithAgents setting applied against the live Claude Code session count. The
// agent half is the package-level KeepAwakeRecompute, since Wails binds every exported method.
type KeepAwakeService struct {
	Emit   appcore.Emitter
	Toggle *keepawake.Toggle
	// AgentCount reports the live Claude Code sessions: terminal agent tabs plus running headless
	// ade sessions. Settings reads the stored setting fresh on every recompute.
	AgentCount func() int
	Settings   func() (model.Settings, error)

	mu      sync.Mutex
	agentOn bool
}

// KeepAwakeStatus is the wire projection every method below returns, and ChannelKeepAwake's
// payload — Kira Studio's own KeepAwakeStatus (internal/bridge/keepawake.go), byte-identical shape.
type KeepAwakeStatus struct {
	Manual    bool   `json:"manual"`
	Supported bool   `json:"supported"`
	Error     string `json:"error"`
}

func toKeepAwakeStatus(st keepawake.State) KeepAwakeStatus {
	return KeepAwakeStatus{Manual: st.Manual, Supported: st.Supported, Error: st.Error}
}

// Status reads the service's current state — never starts or stops anything.
func (s *KeepAwakeService) Status() KeepAwakeStatus {
	return toKeepAwakeStatus(s.Toggle.State())
}

// KeepAwakeSetManualArgs is SetManual's own argument shape.
type KeepAwakeSetManualArgs struct {
	Enabled bool `json:"enabled"`
}

// SetManual flips the titlebar toggle and broadcasts the result to every window — Emit, not
// EmitTo, since the assertion is app-wide by definition (Kira Studio's own §3.2).
func (s *KeepAwakeService) SetManual(args KeepAwakeSetManualArgs) KeepAwakeStatus {
	st := toKeepAwakeStatus(s.Toggle.SetManual(args.Enabled))
	s.Emit.Emit(ChannelKeepAwake, st)
	return st
}

// KeepAwakeSystemDidWake is shell.AttachSystemWake's own trigger — release-then-reacquire while
// held, a no-op while idle (Controller.Rearm's own guard). Kira Studio's own function of the same
// name (internal/bridge/keepawake.go).
func KeepAwakeSystemDidWake(s *KeepAwakeService) {
	s.Toggle.Ctl.Rearm()
}

// KeepAwakeRecompute applies claudeCode.keepAwakeWithAgents against the live session count and
// broadcasts the status when the agent reason flips. The setting is read fresh each call: it can
// change independently of a session starting or ending. A read failure leaves the reason as is.
// mu spans the reads and Ctl.Set, so interleaved callers cannot apply results out of order.
func KeepAwakeRecompute(s *KeepAwakeService) {
	s.mu.Lock()
	settings, err := s.Settings()
	if err != nil {
		s.mu.Unlock()
		return
	}
	on := settings.ClaudeCode.KeepAwakeWithAgents && s.AgentCount() > 0
	changed := on != s.agentOn
	s.agentOn = on
	s.Toggle.Ctl.Set(keepawake.ReasonAgent, on)
	s.mu.Unlock()
	if changed {
		s.Emit.Emit(ChannelKeepAwake, toKeepAwakeStatus(s.Toggle.State()))
	}
}
