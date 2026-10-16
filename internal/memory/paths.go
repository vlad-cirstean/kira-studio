// Package memory is the long-term memory store shared by Kira Space's Memory module and the
// kira-memory stdio MCP server: SQLite + FTS5 storage, recall-first search, and the Claude Code
// gate/reconcile pipeline.
package memory

import (
	"path/filepath"

	"github.com/kirathecat/kira-studio/internal/kirapaths"
)

// Home resolves the memory data directory: $KIRA_MEMORY_HOME, else ~/.kira-memory.
func Home() string {
	return kirapaths.Home("KIRA_MEMORY_HOME", ".kira-memory")
}

// DefaultPath is memory.db under Home.
func DefaultPath() string {
	return filepath.Join(Home(), "memory.db")
}
