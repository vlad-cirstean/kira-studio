package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/keepawake"
)

// KeepAwakeService is Kira Studio's own titlebar-toggle half (internal/bridge/keepawake.go),
// trimmed: no agent-aware Settings leaf (SetAgentAware), no agent-session-count tracking — this app
// has no Claude Code hook integration in scope. Status/SetManual delegate entirely to
// internal/keepawake.Toggle, the shared manual-reason half both apps' own bound service wraps
// (P116 H3).
type KeepAwakeService struct {
	Emit   appcore.Emitter
	Toggle *keepawake.Toggle
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
// name (internal/bridge/keepawake.go), trimmed of the agent-reason recompute this app has none of.
func KeepAwakeSystemDidWake(s *KeepAwakeService) {
	s.Toggle.Ctl.Rearm()
}
