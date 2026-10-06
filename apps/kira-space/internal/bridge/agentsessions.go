package bridge

import (
	"sync"

	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// AgentSessionWire is terminal.AgentSession's own wire projection — AgentSessionsEvent's own list
// element. Byte-identical shape to Kira Studio's own deleted precedent (P127, d20bc970^).
type AgentSessionWire struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
}

// AgentSessionsEvent is ChannelAgentSessions' own payload, and TerminalService.AgentSessions' own
// return shape (the boot-time hydrate: a window opened after every currently-live session already
// started needs a snapshot, since the channel only fires on change).
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

// AgentSessions is the boot-time hydrate for the P127 agent-activity store (§1.1) — a window
// opened after every currently-live session already started needs a snapshot, since
// ChannelAgentSessions only fires on change.
func (s *TerminalService) AgentSessions() AgentSessionsEvent {
	return AgentSessionsEvent{Sessions: toWireAgentSessions(s.Registry.AgentSessions())}
}

// AgentSessionsChanged is Registry.OnChange's own target (main.go) — a package-level function
// rather than an exported method, since Wails binds every exported method of a registered service:
// emit itself must never become renderer-triggerable.
// agentSessionsMu orders snapshot and emit together so an older snapshot never lands last.
var agentSessionsMu sync.Mutex

func AgentSessionsChanged(e appevent.Emitter, reg *terminal.Registry) {
	agentSessionsMu.Lock()
	defer agentSessionsMu.Unlock()
	e.Emit(ChannelAgentSessions, AgentSessionsEvent{Sessions: toWireAgentSessions(reg.AgentSessions())})
}

// EmitAgentEvent is agenthooks.Options.OnEvent's own broadcast half (main.go wires it alongside
// Tracker.HandleEvent) — emitted verbatim: agenthooks.Event's JSON tags already match
// ChannelAgentEvent's own payload shape field for field (packages/shared/domain/agent.ts's
// AgentEvent), so no separate wire-projection type is needed, matching Kira Studio's own deleted
// precedent (P127, d20bc970^).
func EmitAgentEvent(e appevent.Emitter, ev agenthooks.Event) {
	e.Emit(ChannelAgentEvent, ev)
}
