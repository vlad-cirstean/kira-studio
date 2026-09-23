// layering_test.go guards the same Go-side module-boundary rule Kira Studio's own copy does
// (apps/kira-studio/internal/layering_test.go): internal/bridge is the IPC transport layer, and
// no domain package below it may import anything under internal/bridge. Retargeted to this app's
// own module prefix (P100 Part 1).
package internal_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/layeringtest"
)

const modulePrefix = "github.com/kirathecat/kira-studio/apps/kira-space/"

// packagesExemptFromBridgeCheck are the packages that sit at or above internal/bridge in the
// intended layering. Kira Studio's own exemption set also carries internal/ipcfixture (a test
// fixture that wires the bound services together) — this app has no such fixture yet, so it is
// left out rather than exempting a package that does not exist. internal/appshell (P103 Part 3)
// replaces internal/shell here — the generic half of the app's own composition root moved to
// repo-root internal/shell, outside this go list scope; appshell is what's left importing bridge.
var packagesExemptFromBridgeCheck = map[string]bool{
	"internal":          true,
	"internal/bridge":   true,
	"internal/appshell": true,
}

// TestDomainPackagesDoNotImportBridge is Kira Studio's own test (see its own doc comment for the
// full rationale), enumerating every internal/* package under this app straight from `go list`.
// The runner itself is shared (P107 I2-28, internal/layeringtest.Run) — only modulePrefix and the
// exemption set differ per app.
func TestDomainPackagesDoNotImportBridge(t *testing.T) {
	layeringtest.Run(t, modulePrefix, packagesExemptFromBridgeCheck)
}
