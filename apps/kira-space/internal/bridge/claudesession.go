package bridge

import (
	"context"

	"github.com/kirathecat/kira-studio/internal/claudecfg"
	"github.com/kirathecat/kira-studio/internal/kirapaths"
)

// SessionMCPConfig is the --mcp-config document for one Claude Code session Kira Space starts:
// the memory server always, Kira Studio's DB MCP while its server runs. Kira Space never writes
// Claude Code's own configuration; this file lives only as long as the launch composer's dir.
func SessionMCPConfig() ([]byte, error) {
	exe, err := memoryExecutable()
	if err != nil {
		return nil, err
	}
	var db *claudecfg.DBEndpoint
	if ep, ok := claudecfg.ReadDBEndpoint(context.Background(), kirapaths.Home("KIRA_HOME", ".kira-studio")); ok {
		db = &ep
	}
	return claudecfg.SessionConfig(exe, db)
}
