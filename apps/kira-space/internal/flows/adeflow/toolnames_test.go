package adeflow_test

import (
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/harness"
	agentclaude "github.com/kirathecat/kira-studio/internal/harness/claude"
)

// toolName is the claude --allowedTools name of a Kira tool.
func toolName(t harness.MCPTool) string { return agentclaude.New().MCPToolName(t) }

// spaceToolNames are the claude names of the Kira Space tools.
func spaceToolNames() []string {
	return harness.ToolNames(agentclaude.New(), claudeheadless.SpaceToolIDs...)
}
