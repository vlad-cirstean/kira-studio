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

// modulePrefix strips down a fully-qualified package path (as `go list` prints it) to its
// internal/-relative form, e.g. ".../apps/kira-studio/internal/adapters/kafka" ->
// "internal/adapters/kafka".
const modulePrefix = "github.com/kirathecat/kira-studio/apps/kira-studio/"

func shortPkgName(full string) string {
	return strings.TrimPrefix(full, modulePrefix)
}

// packagesExemptFromBridgeCheck are the packages that sit *at or above* internal/bridge in the
// intended layering, so a bridge import from them is not a boundary violation: internal/bridge
// itself, internal/ipcfixture (a test fixture that wires the bound services together — the same
// composition internal/shell does for the real binary), internal/shell (the app's own composition
// root), and the bare "internal" package (this file's own directory; it holds no non-test code).
var packagesExemptFromBridgeCheck = map[string]bool{
	"internal":            true,
	"internal/bridge":     true,
	"internal/ipcfixture": true,
	"internal/shell":      true,
}

// TestDomainPackagesDoNotImportBridge used to walk a hand-maintained slice of "the domain
// packages that must not import bridge" — five packages, with a comment reading "extend this list
// as new domain packages appear" that named no mechanism for actually noticing when one did (P21
// round 2 architecture/security finding 6). A brand-new domain package under internal/ was simply
// unchecked until someone remembered to add it here. This now enumerates every internal/*
// package straight from `go list` and checks all of them except the small, named set of
// transport/composition packages above, so a new domain package is covered automatically rather
// than silently exempt by omission.
func TestDomainPackagesDoNotImportBridge(t *testing.T) {
	// The fully-qualified pattern, not a relative "./internal/...", because `go test` runs this
	// from this package's own directory (internal/) — a relative "./internal/..." from inside
	// internal/ itself resolves to a nonexistent internal/internal/.
	listOut, err := exec.Command("go", "list", modulePrefix+"internal/...").CombinedOutput()
	if err != nil {
		t.Fatalf("go list %sinternal/...: %v\n%s", modulePrefix, err, listOut)
	}
	pkgs := strings.Fields(string(listOut))
	if len(pkgs) < 10 {
		// A sanity floor: if `go list` ever returns a near-empty set (a broken working
		// directory, a build-tag misconfiguration), silently passing zero sub-tests would be
		// worse than the hand-maintained list this replaced.
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
