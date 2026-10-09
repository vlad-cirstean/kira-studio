package flowtest

import (
	"os"
	"testing"
)

// EnvComplete turns on the complete flow suite.
const EnvComplete = "KIRA_FLOW_COMPLETE"

// Complete skips a test (or subtest) unless the complete suite is on: the permutation matrix,
// large histories and slow cases that stay out of the everyday loop.
func Complete(t testing.TB) {
	t.Helper()
	if os.Getenv(EnvComplete) != "1" {
		t.Skip("complete flow suite only: set " + EnvComplete + "=1")
	}
}
