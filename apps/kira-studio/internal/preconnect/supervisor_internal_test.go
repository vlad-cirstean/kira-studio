package preconnect

import "time"

// Lowers settleWindow/killGrace (D9) so the sidecar and kill-escalation tests in
// supervisor_test.go don't each cost 2s of wall clock. This file is internal (package
// preconnect, not preconnect_test) purely to reach these unexported vars — it registers no
// tests of its own.
func init() {
	settleWindow = 80 * time.Millisecond
	killGrace = 120 * time.Millisecond
}
