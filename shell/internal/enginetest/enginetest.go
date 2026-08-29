// Package enginetest is the shared, non-test harness (the httptest mould, P55 §2 D13) for every
// package in this phase that needs a real engine child: internal/connections, internal/tree and
// internal/oplog. A _test.go helper cannot be imported across packages, so this exists once here
// instead of being copied three times — P54's own internal/enginehost/helpers_test.go is left
// exactly as it is, since it is private to a package this phase does not otherwise touch.
package enginetest

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// NodeBin locates a real Node binary to spawn the fixture with. It fails rather than skips —
// P52 §13 rejects a runtime skip that silently passes, and a machine with no node cannot run
// this app at all.
func NodeBin(t testing.TB) string {
	t.Helper()
	if v := os.Getenv("KIRA_TEST_NODE"); v != "" {
		return v
	}
	_, thisFile, _, _ := runtime.Caller(0)
	candidate := filepath.Join(filepath.Dir(thisFile), "..", "..", "runtime", "node", "bin", "node")
	if fi, err := os.Stat(candidate); err == nil && !fi.IsDir() {
		return candidate
	}
	if p, err := exec.LookPath("node"); err == nil {
		return p
	}
	t.Fatalf("no Node runtime found for engine-backed tests — run scripts/vendor-node.sh, or set KIRA_TEST_NODE")
	return ""
}

// fixtureScript returns the absolute path to testdata/engine-fixture.mjs, resolved relative to
// this source file so it works regardless of the caller package's own working directory.
func fixtureScript(t testing.TB) string {
	t.Helper()
	_, thisFile, _, _ := runtime.Caller(0)
	script := filepath.Join(filepath.Dir(thisFile), "testdata", "engine-fixture.mjs")
	if fi, err := os.Stat(script); err != nil || fi.IsDir() {
		t.Fatalf("engine-fixture.mjs not found at %s: %v", script, err)
	}
	return script
}

// Host starts the shared engine-fixture.mjs under a real Node process and registers Stop() as a
// cleanup. Each call starts its own fresh child, so tests never share fixture state.
func Host(t testing.TB) *enginehost.Host {
	t.Helper()
	return HostWith(t, fixtureScript(t))
}

// HostWith starts script (an absolute or relative path) instead of the shared fixture — for a
// test that needs its own one-off engine behaviour.
func HostWith(t testing.TB, script string) *enginehost.Host {
	t.Helper()
	h, err := enginehost.Start(NodeBin(t), script)
	if err != nil {
		t.Fatalf("enginehost.Start: %v", err)
	}
	t.Cleanup(h.Stop)
	return h
}
