package ade

import (
	"github.com/kirathecat/kira-studio/internal/harness"
	"github.com/kirathecat/kira-studio/internal/harness/claude"
)

// toolName is the claude --allowedTools name of a Kira tool.
func toolName(t harness.MCPTool) string { return claude.New().MCPToolName(t) }
