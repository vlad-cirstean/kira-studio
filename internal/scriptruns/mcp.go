package scriptruns

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/harness"
)

// McpServers lists the MCP servers of the user's agent config.
func (s *Service) McpServers() ([]harness.UserServer, error) {
	servers, err := s.Agent.Active().UserMCPServers(s.getenv)
	if servers == nil {
		servers = []harness.UserServer{}
	}
	return servers, err
}

// McpTools lists the tools one of those servers offers.
func (s *Service) McpTools(ctx context.Context, server string) ([]harness.UserTool, error) {
	return s.Agent.Active().UserMCPTools(ctx, s.getenv, server, s.Home)
}
