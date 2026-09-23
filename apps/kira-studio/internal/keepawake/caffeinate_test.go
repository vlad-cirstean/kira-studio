package keepawake

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/testx"
)

// TestCaffeinateArgvGolden asserts the spawn's exact argv, byte for byte — the same reasoning
// internal/startupfail's TestAlertArgvGolden states: the spawn is the whole security and
// correctness surface of this file.
func TestCaffeinateArgvGolden(t *testing.T) {
	got := caffeinateArgv(4242)
	want := []string{"-i", "-s", "-w", "4242"}
	if len(got) != len(want) {
		t.Fatalf("caffeinateArgv length = %d, want %d\ngot:  %#v\nwant: %#v", len(got), len(want), got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("caffeinateArgv[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// processAlive/waitUntil are testx.ProcessAlive/testx.WaitUntil (P107 I2-28).
var (
	processAlive = testx.ProcessAlive
	waitUntil    = testx.WaitUntil
)

// TestCaffeinateDriverLifecycle is the one test that catches "release does not actually kill it",
// the leak this whole package exists to prevent — runnable on Linux because the driver is pure Go.
// lookPath is redirected to a tiny injected helper script (ignores the -i -s -w argv caffeinate
// itself would parse) rather than the real caffeinate, which this sandbox does not have.
// docs/DEV_ENVIRONMENT.md's own note that this container's minimal init reaps slowly is why this
// polls for ESRCH instead of asserting it on the first check (internal/preconnect's own precedent).
func TestCaffeinateDriverLifecycle(t *testing.T) {
	helper := writeSleepHelper(t)

	d := newCaffeinateDriver()
	d.lookPath = func(string) (string, error) { return helper, nil }

	if err := d.Acquire(); err != nil {
		t.Fatalf("Acquire: %v", err)
	}

	d.mu.Lock()
	pid := d.cmd.Process.Pid
	d.mu.Unlock()

	if !processAlive(pid) {
		t.Fatalf("pid %d is not alive right after Acquire", pid)
	}

	d.Release()

	waitUntil(t, 5*time.Second, func() bool { return !processAlive(pid) })
}

// writeSleepHelper writes a tiny shell script that sleeps regardless of its own argv (so it
// tolerates caffeinateArgv's "-i -s -w <pid>", which a real `sleep` binary would reject as
// unrecognized flags) and returns its absolute path.
func writeSleepHelper(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-caffeinate.sh")
	script := "#!/bin/sh\nexec sleep 300\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write helper script: %v", err)
	}
	return path
}
