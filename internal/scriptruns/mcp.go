package scriptruns

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/claudeheadless"
)

// McpServers lists the MCP servers of the user's Claude config.
func (s *Service) McpServers() ([]claudeheadless.UserServer, error) {
	servers, err := claudeheadless.UserServers(s.getenv)
	if servers == nil {
		servers = []claudeheadless.UserServer{}
	}
	return servers, err
}

// McpTools lists the tools one of those servers offers.
func (s *Service) McpTools(ctx context.Context, server string) ([]claudeheadless.UserTool, error) {
	return claudeheadless.ListTools(ctx, s.getenv, server, s.Home)
}
