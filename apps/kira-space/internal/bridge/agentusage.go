package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentusage"
	"github.com/kirathecat/kira-studio/internal/appevent"
)

// ChannelAgentUsage is P239's push: a Kira-started session or run reported new limits. Payload
// is the Snapshot. Space only, not on the phone allowlist.
const ChannelAgentUsage = "kira:agent:usage"

// AgentUsageService is the renderer's read of the agent usage limits (P239).
type AgentUsageService struct{ U *agentusage.Service }

// Get returns the current snapshot; state "off" while agent.usageEnabled is false.
func (s *AgentUsageService) Get() (agentusage.Snapshot, error) {
	return s.U.Get(), nil
}

// AgentUsageChanged is the usage Service's OnChange target.
func AgentUsageChanged(e appevent.Emitter, snap agentusage.Snapshot) {
	e.Emit(ChannelAgentUsage, snap)
}
