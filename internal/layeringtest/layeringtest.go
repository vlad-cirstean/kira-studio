// Package layeringtest is the shared "go list -deps" module-boundary check Kira Studio's and Kira
// Space's own internal/layering_test.go both run (P107 I2-28): every internal/* package under a
// module, except an exempt set, must not depend on internal/bridge, the IPC transport layer.
package layeringtest

import (
	"os/exec"
	"strings"
	"testing"
)

// Run enumerates every internal/* package under modulePrefix straight from `go list` and asserts
// none but exempt depends on internal/bridge. modulePrefix is the fully-qualified pattern's own
// prefix (e.g. "github.com/kirathecat/kira-studio/apps/kira-space/") — callers pass the
// fully-qualified form, not a relative "./internal/...", since `go test` runs from inside
// internal/ itself, where a relative pattern would resolve to a nonexistent internal/internal/.
// exempt holds the packages that sit at or above internal/bridge in the intended layering, keyed
// by their internal/-relative name (e.g. "internal/bridge").
func Run(t *testing.T, modulePrefix string, exempt map[string]bool) {
	t.Helper()
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
		short := strings.TrimPrefix(pkg, modulePrefix)
		if exempt[short] {
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
