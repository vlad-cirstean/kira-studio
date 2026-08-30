package enginehost_test

import (
	"os"
	"os/exec"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// nodeBin locates a real Node binary to spawn the fixture with. It fails rather than skips —
// P52 §13 rejects a runtime skip that silently passes, and a machine with no node cannot run
// this app at all.
func nodeBin(t *testing.T) string {
	t.Helper()
	if v := os.Getenv("KIRA_TEST_NODE"); v != "" {
		return v
	}
	for _, candidate := range []string{"../../runtime/node/bin/node"} {
		if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
			return candidate
		}
	}
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	t.Fatalf("no Node runtime found for enginehost tests — run scripts/vendor-node.sh, or set KIRA_TEST_NODE")
	return ""
}

// newHost starts the given fixture script under a real Node process and registers Stop() as a
// cleanup.
func newHost(t *testing.T, script string, args ...string) *enginehost.Host {
	t.Helper()
	h, err := enginehost.Start(nodeBin(t), script, args...)
	if err != nil {
		t.Fatalf("enginehost.Start: %v", err)
	}
	t.Cleanup(h.Stop)
	return h
}
