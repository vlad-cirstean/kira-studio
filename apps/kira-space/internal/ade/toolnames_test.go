package ade

import (
	"github.com/kirathecat/kira-studio/internal/agentmcp"
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
)

// toolName is the claude --allowedTools name of a Kira tool.
func toolName(t harness.MCPTool) string { return claude.New().MCPToolName(t) }

// spaceToolNames are the claude names of the Kira Space tools.
func spaceToolNames() []string {
	return harness.ToolNames(claude.New(), agentmcp.SpaceToolIDs...)
}
