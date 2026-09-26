// layering_test.go guards a Go-side module-boundary rule the frontend already enforces with
// biome.json's noRestrictedImports (P21 round 1 architecture/security finding 6): internal/bridge
// is the IPC transport layer — its ipcerr subpackage exists to shape errors for bridge/rpc.ts's
// own unwrap() — and no domain package below it (connections, secrets, tree, and any future one)
// may import anything under internal/bridge. ipcerr itself moved out of internal/bridge/ipcerr to
// internal/ipcerr for exactly this reason; this test is what keeps it from drifting back.
package internal_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/layeringtest"
)

// modulePrefix strips down a fully-qualified package path (as `go list` prints it) to its
// internal/-relative form, e.g. ".../apps/kira-studio/internal/adapters/kafka" ->
// "internal/adapters/kafka".
const modulePrefix = "github.com/kirathecat/kira-studio/apps/kira-studio/"

// packagesExemptFromBridgeCheck are the packages that sit *at or above* internal/bridge in the
// intended layering, so a bridge import from them is not a boundary violation: internal/bridge
// itself, internal/ipcfixture (a test fixture that wires the bound services together — the same
// composition internal/appshell does for the real binary), internal/appshell (the app's own
// composition-root residue — P103 Part 3 moved the generic half to repo-root internal/shell, which
// this go list scope no longer even sees), and the bare "internal" package (this file's own
// directory; it holds no non-test code). rpcstream (SPEC §7's one deliberate module-agnostic-RPC
// exception) moved out from under internal/bridge to the repo-root internal/rpcstream in P100
// Part 1, so it no longer needs an entry here — go list -deps no longer reports it as depending on
// anything under .../internal/bridge.
var packagesExemptFromBridgeCheck = map[string]bool{
	"internal":            true,
	"internal/bridge":     true,
	"internal/ipcfixture": true,
	"internal/appshell":   true,
}

// TestDomainPackagesDoNotImportBridge used to walk a hand-maintained slice of "the domain
// packages that must not import bridge" — five packages, with a comment reading "extend this list
// as new domain packages appear" that named no mechanism for actually noticing when one did (P21
// round 2 architecture/security finding 6). A brand-new domain package under internal/ was simply
// unchecked until someone remembered to add it here. This now enumerates every internal/*
// package straight from `go list` and checks all of them except the small, named set of
// transport/composition packages above, so a new domain package is covered automatically rather
// than silently exempt by omission. The runner itself is shared with Kira Space's own copy of
// this test (P107 I2-28, internal/layeringtest.Run) — only modulePrefix and the exemption set
// differ per app.
func TestDomainPackagesDoNotImportBridge(t *testing.T) {
	layeringtest.Run(t, modulePrefix, packagesExemptFromBridgeCheck)
}
