package scriptruns

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/harness"
)

// McpServers lists the MCP servers the agent's CLI reports from the app home.
func (s *Service) McpServers(ctx context.Context) ([]harness.UserServer, error) {
	servers, err := s.Agent.Active().UserMCPServers(ctx, s.Home)
	if servers == nil {
		servers = []harness.UserServer{}
	}
	return servers, err
}
