// layering_test.go guards a Go-side module-boundary rule the frontend already enforces with
// biome.json's noRestrictedImports (P21 round 1 architecture/security finding 6): internal/bridge
// is the IPC transport layer — its ipcerr subpackage exists to shape errors for bridge/rpc.ts's
// own unwrap() — and no domain package below it (connections, secrets, tree, and any future one)
// may import anything under internal/bridge. ipcerr itself moved out of internal/bridge/ipcerr to
// internal/ipcerr for exactly this reason; this test is what keeps it from drifting back.
package internal_test

import (
	"os/exec"
	"strings"
	"testing"
)

// domainPackagesThatMustNotImportBridge lists this module's own domain packages that sit below
// internal/bridge in the intended layering — extend this list as new domain packages appear.
var domainPackagesThatMustNotImportBridge = []string{
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections",
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets",
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree",
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost",
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage",
}

func TestDomainPackagesDoNotImportBridge(t *testing.T) {
	for _, pkg := range domainPackagesThatMustNotImportBridge {
		t.Run(pkg, func(t *testing.T) {
			out, err := exec.Command("go", "list", "-deps", pkg).CombinedOutput()
			if err != nil {
				t.Fatalf("go list -deps %s: %v\n%s", pkg, err, out)
			}
			for _, dep := range strings.Fields(string(out)) {
				if strings.Contains(dep, "/internal/bridge") {
					t.Fatalf("%s depends on %s — a domain package must not import the IPC transport layer (internal/bridge)", pkg, dep)
				}
			}
		})
	}
}
