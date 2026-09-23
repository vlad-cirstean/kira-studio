// Package testx holds the small Go test helpers several packages across both apps each used to
// redeclare on their own (P107 I2-28): a condition-poll, a liveness check, an *ipcerr.Error
// unwrap, a *string-to-any projection, and a "skip unless git is on PATH" guard.
package testx

import (
	"errors"
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// WaitUntil polls cond every 5ms until it reports true or timeout elapses, failing the test if it
// never does. keepawake's, oplog's and preconnect's own waitUntil, byte-identical.
func WaitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

// ProcessAlive reports whether pid is still running, via a signal-0 probe. keepawake's and
// preconnect's own processAlive, byte-identical.
func ProcessAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

// AsIpcErr asserts err is an *ipcerr.Error and returns it, failing the test otherwise.
// connections's and secrets's own asIpcErr, byte-identical.
func AsIpcErr(t *testing.T, err error) *ipcerr.Error {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("error %v (%T) is not an *ipcerr.Error", err, err)
	}
	return ie
}

// DerefOrNil projects a *string to any: nil stays nil, a non-nil pointer becomes its pointee.
// connections's and gitreview's own derefOrNil, byte-identical.
func DerefOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// SkipWithoutGit skips the test unless git is on PATH. The shared body behind six per-package
// names (gitsession's own walk/stack/queries variants keep their own suffix — same package, so
// they cannot all share this bare name — logsession's, catfile's and gitsearch's own call this
// directly).
func SkipWithoutGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}
