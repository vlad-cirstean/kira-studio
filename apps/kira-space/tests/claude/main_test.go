// Package claude runs Kira Space's Claude Code integrations against the real `claude` CLI. Own Go
// module, so no default command (`go test ./...`, lint, CI) compiles or runs it. Every test spends
// real tokens (haiku, tiny prompts, a budget cap). See docs/DEV_ENVIRONMENT.md "Real `claude` tests"
// for the area-to-command table.
package claude

import (
	"fmt"
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/internal/memory/memorycli"
)

// TestMain serves two re-executions of the test binary: as the `memory-mcp` server of the import
// agent (KIRA_TEST_MEMORY_MCP), and through flowharness.Main as memory-mcp, askpass and the fake gh.
func TestMain(m *testing.M) {
	if os.Getenv("KIRA_TEST_MEMORY_MCP") == "1" {
		os.Exit(memorycli.Run(os.Args[2:]))
	}
	code := flowharness.Main(m)
	// Re-executed helper processes (memory-mcp, fake gh) spend nothing and must keep stdout clean.
	spendMu.Lock()
	if spent > 0 {
		fmt.Fprintf(os.Stderr, "real claude spend (claude -p results only, TUI sessions not counted): %.4f USD\n", spent)
	}
	spendMu.Unlock()
	os.Exit(code)
}
