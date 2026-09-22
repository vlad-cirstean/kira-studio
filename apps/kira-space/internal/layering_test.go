// layering_test.go guards the same Go-side module-boundary rule Kira Studio's own copy does
// (apps/kira-studio/internal/layering_test.go): internal/bridge is the IPC transport layer, and
// no domain package below it may import anything under internal/bridge. Retargeted to this app's
// own module prefix (P100 Part 1).
package internal_test

import (
	"os/exec"
	"strings"
	"testing"
)

const modulePrefix = "github.com/kirathecat/kira-studio/apps/kira-space/"

func shortPkgName(full string) string {
	return strings.TrimPrefix(full, modulePrefix)
}

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
func TestDomainPackagesDoNotImportBridge(t *testing.T) {
	listOut, err := exec.Command("go", "list", modulePrefix+"internal/...").CombinedOutput()
	if err != nil {
		t.Fatalf("go list %sinternal/...: %v\n%s", modulePrefix, err, listOut)
	}
	pkgs := strings.Fields(string(listOut))
	if len(pkgs) < 10 {
		t.Fatalf("go list ./internal/... returned only %d packages, expected far more: %v", len(pkgs), pkgs)
	}
	checked := 0
	for _, pkg := range pkgs {
		short := shortPkgName(pkg)
		if packagesExemptFromBridgeCheck[short] {
			continue
		}
		checked++
		t.Run(short, func(t *testing.T) {
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
	if checked == 0 {
		t.Fatal("no non-exempt internal/* packages were checked — the exemption set has likely grown to swallow everything")
	}
}
