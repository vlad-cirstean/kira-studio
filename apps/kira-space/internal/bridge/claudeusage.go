package bridge

import (
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/claudeusage"
)

// ChannelClaudeUsage is P239's push: a Kira-started session or run reported new limits. Payload
// is the Snapshot. Space only, not on the phone allowlist.
const ChannelClaudeUsage = "kira:claude:usage"

// ClaudeUsageService is the renderer's read of the Claude Code usage limits (P239).
type ClaudeUsageService struct{ U *claudeusage.Service }

// Get returns the current snapshot; state "off" while claudeCode.usageEnabled is false.
func (s *ClaudeUsageService) Get() (claudeusage.Snapshot, error) {
	return s.U.Get(), nil
}

// ClaudeUsageChanged is the usage Service's OnChange target.
func ClaudeUsageChanged(e appevent.Emitter, snap claudeusage.Snapshot) {
	e.Emit(ChannelClaudeUsage, snap)
}
