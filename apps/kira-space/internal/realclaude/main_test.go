//go:build realclaude

// Package realclaude runs Kira Space's Claude Code integrations against the real `claude` CLI.
// Opt-in only: both the realclaude build tag and KIRA_REAL_CLAUDE=1 are required, because every
// test spends real tokens (haiku, tiny prompts, a budget cap). See docs/DEV_ENVIRONMENT.md "Real
// `claude` tests (P237)" for the area-to-command table.
package realclaude

import (
	"fmt"
	"os"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
)

const gateMessage = "real claude tests: set KIRA_REAL_CLAUDE=1 (spends real tokens)"

// TestMain skips the package without the env lock. With it, flowharness.Main still serves the
// re-executed test binary as memory-mcp, askpass and the fake gh.
func TestMain(m *testing.M) {
	if os.Getenv("KIRA_REAL_CLAUDE") != "1" {
		fmt.Println(gateMessage)
		return
	}
	os.Exit(flowharness.Main(m))
}
