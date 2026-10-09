// Package claudecfg is the one place Kira apps touch Claude Code configuration, and never by
// writing it: SessionConfig builds the per-launch --mcp-config document for sessions Kira Space
// starts, the endpoint file hands Kira Studio's DB MCP address to Kira Space, and the legacy
// helpers find and remove entries earlier versions registered in the user's own config, only on a
// user's request.
package claudecfg

import (
	"encoding/json"
	"errors"
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/mcpinstall"
)

const (
	// NameMemory is the stdio memory server's name, and NameDB the DB MCP server's. Session entries
	// keep the names earlier global registrations used, so tool names stay stable.
	NameMemory = "kira-memory"
	NameDB     = "kira-db"
	// NameRepoMap names a server removed in v1.9; only legacy cleanup knows it.
	NameRepoMap = "kira-repo-map"
)

type sessionServer struct {
	Type          string   `json:"type"`
	Command       string   `json:"command,omitempty"`
	Args          []string `json:"args,omitempty"`
	URL           string   `json:"url,omitempty"`
	HeadersHelper string   `json:"headersHelper,omitempty"`
}

// SessionConfig renders the --mcp-config document for one Kira Space session: kira-memory always,
// kira-db while db is non-nil. memoryCommand must be an absolute path.
func SessionConfig(memoryCommand string, db *DBEndpoint) ([]byte, error) {
	if !filepath.IsAbs(memoryCommand) {
		return nil, errors.New("claudecfg: memory server command is not absolute")
	}
	servers := map[string]sessionServer{
		NameMemory: {Type: "stdio", Command: memoryCommand, Args: []string{"memory-mcp"}},
	}
	if db != nil {
		servers[NameDB] = sessionServer{Type: "http", URL: db.URL, HeadersHelper: mcpinstall.ShellQuote(db.HeadersHelper)}
	}
	return json.Marshal(map[string]any{"mcpServers": servers})
}
