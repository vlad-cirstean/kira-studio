package flowharness

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/testx"
)

// Main is every flow package's TestMain body: os.Exit(flowharness.Main(m)). It captures the real
// Docker endpoint before any test swaps HOME, sweeps stale labelled resources, and points
// KIRA_HOME at a temp dir for the whole binary.
func Main(m *testing.M) int {
	dockerHost = resolveDockerHost()
	if dockerHost != "" {
		sweep(dockerHost)
	}
	return testx.RunWithTempHomes(m)
}
