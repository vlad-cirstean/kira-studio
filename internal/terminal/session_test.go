// §17.1's own earned unit test: concurrency (a reader goroutine, an ordered signal-then-wait-then
// -kill Close racing an exiting process) plus cleanup with interacting rules (idempotent Close,
// write-after-close, exactly-once exit). Every case drives a real PTY — on a host with no
// /dev/ptmx these fail loudly rather than skip (a skipped test that silently never runs is worse
// than a red one).
package terminal

import (
	"bytes"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// collector is a small, race-safe sink for a session's onData/onExit callbacks, shared by every
// test below.
type collector struct {
	mu       sync.Mutex
	data     bytes.Buffer
	exits    int
	exitCode int
	exitErr  error
}

func (c *collector) onData(b []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data.Write(b)
}

func (c *collector) onExit(code int, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.exits++
	c.exitCode = code
	c.exitErr = err
}

func (c *collector) text() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.data.String()
}

func (c *collector) exitCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.exits
}

// waitFor polls cond every 10ms until it is true or timeout elapses, failing the test otherwise —
// used throughout instead of a fixed sleep, since a shell's own output timing is not deterministic.
func waitFor(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

func openTestSession(t *testing.T, id, cwd string, cols, rows uint16) (*Registry, *Session, *collector) {
	t.Helper()
	reg := NewRegistry()
	col := &collector{}
	sess, err := reg.Open(OpenParams{
		ID: id, WindowKey: "w1", Cwd: cwd, Cols: cols, Rows: rows,
		OnData: col.onData, OnExit: col.onExit,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(sess.Close)
	return reg, sess, col
}

func TestSessionSpawnsAtCwd(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "spawn-at-cwd", dir, 80, 24)

	if err := sess.Write([]byte("pwd\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	waitFor(t, 5*time.Second, func() bool { return strings.Contains(col.text(), dir) })
}

// TestSessionRunsInitialCommand guards P85 §2's one non-obvious property: the command's own exit
// status reaches onExit rather than the wrapper shell's — the signal P86 will count sessions with.
func TestSessionRunsInitialCommand(t *testing.T) {
	dir := t.TempDir()
	reg := NewRegistry()
	col := &collector{}
	sess, err := reg.Open(OpenParams{
		ID: "initial-command", WindowKey: "w1", Cwd: dir, Cols: 80, Rows: 24,
		Command: "printf ready; exit 7",
		OnData:  col.onData, OnExit: col.onExit,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(sess.Close)

	waitFor(t, 5*time.Second, func() bool { return col.exitCount() > 0 })
	if !strings.Contains(col.text(), "ready") {
		t.Fatalf("output = %q, want it to contain %q", col.text(), "ready")
	}
	col.mu.Lock()
	code := col.exitCode
	col.mu.Unlock()
	if code != 7 {
		t.Fatalf("exit code = %d, want 7", code)
	}
}

func TestSessionResizeAppliesWinsize(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "resize-winsize", dir, 80, 24)

	if err := sess.Resize(100, 30); err != nil {
		t.Fatalf("Resize: %v", err)
	}
	if err := sess.Write([]byte("stty size\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	// stty size prints "rows cols" — the real ioctl's answer, not the value Resize stored.
	waitFor(t, 5*time.Second, func() bool { return strings.Contains(col.text(), "30 100") })
}

func TestSessionCloseKillsProcessGroup(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "close-kills-group", dir, 80, 24)

	if err := sess.Write([]byte("sleep 300 &\necho started-$!\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	var childPID int
	waitFor(t, 5*time.Second, func() bool {
		text := col.text()
		// LastIndex, not Index: the pty echoes the typed command itself first ("echo
		// started-$!"), which also contains the literal substring "started-" — the real
		// answer is the occurrence after that.
		idx := strings.LastIndex(text, "started-")
		if idx < 0 {
			return false
		}
		rest := text[idx+len("started-"):]
		end := strings.IndexAny(rest, "\r\n")
		if end < 0 {
			return false
		}
		pid, err := strconv.Atoi(strings.TrimSpace(rest[:end]))
		if err != nil || pid == 0 {
			return false
		}
		childPID = pid
		return true
	})

	shellPID := sess.cmd.Process.Pid
	sess.Close()

	waitFor(t, closeGracePeriod+2*time.Second, func() bool {
		return syscall.Kill(shellPID, 0) != nil && syscall.Kill(childPID, 0) != nil
	})
}

func TestSessionCloseIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "close-idempotent", dir, 80, 24)

	sess.Close()
	sess.Close() // must not panic, must not double-report the exit

	if got := col.exitCount(); got != 1 {
		t.Fatalf("exitCount = %d, want 1", got)
	}
}

func TestSessionWriteAfterCloseIsNoop(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "write-after-close", dir, 80, 24)

	sess.Close()
	before := col.text()

	if err := sess.Write([]byte("echo should-not-appear\n")); err != nil {
		t.Fatalf("Write after Close returned an error, want nil: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	if got := col.text(); got != before {
		t.Fatalf("Write after Close produced output: %q", got)
	}
}

func TestSessionExitEmitsOnce(t *testing.T) {
	dir := t.TempDir()
	_, sess, col := openTestSession(t, "exit-emits-once", dir, 80, 24)

	if err := sess.Write([]byte("exit\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	waitFor(t, 5*time.Second, func() bool { return col.exitCount() == 1 })

	// onData never runs after onExit (§4 rule 4): give the reader goroutine a moment to (wrongly)
	// call onData again if it were going to, then confirm the exit code and that nothing further
	// arrived.
	time.Sleep(100 * time.Millisecond)
	col.mu.Lock()
	exits, code := col.exits, col.exitCode
	col.mu.Unlock()
	if exits != 1 {
		t.Fatalf("exitCount = %d, want 1", exits)
	}
	if code != 0 {
		t.Fatalf("exitCode = %d, want 0", code)
	}
}

func TestRegistryCloseWindowClosesOnlyThatWindow(t *testing.T) {
	dir := t.TempDir()
	reg := NewRegistry()
	colA := &collector{}
	colB := &collector{}

	sessA, err := reg.Open(OpenParams{ID: "a", WindowKey: "window-a", Cwd: dir, Cols: 80, Rows: 24, OnData: colA.onData, OnExit: colA.onExit})
	if err != nil {
		t.Fatalf("Open a: %v", err)
	}
	t.Cleanup(sessA.Close)
	sessB, err := reg.Open(OpenParams{ID: "b", WindowKey: "window-b", Cwd: dir, Cols: 80, Rows: 24, OnData: colB.onData, OnExit: colB.onExit})
	if err != nil {
		t.Fatalf("Open b: %v", err)
	}
	t.Cleanup(sessB.Close)

	reg.CloseWindow("window-a")

	waitFor(t, closeGracePeriod+2*time.Second, func() bool { return colA.exitCount() == 1 })
	if got := colB.exitCount(); got != 0 {
		t.Fatalf("window-b session exited (%d times) after CloseWindow(window-a)", got)
	}

	// b is still alive — writing to it must still work.
	if err := sessB.Write([]byte("echo still-alive\n")); err != nil {
		t.Fatalf("Write to b: %v", err)
	}
	waitFor(t, 5*time.Second, func() bool { return strings.Contains(colB.text(), "still-alive") })
}

func TestRegistryRejectsDuplicateID(t *testing.T) {
	dir := t.TempDir()
	reg := NewRegistry()
	col := &collector{}
	sess, err := reg.Open(OpenParams{ID: "dup", WindowKey: "w1", Cwd: dir, Cols: 80, Rows: 24, OnData: col.onData, OnExit: col.onExit})
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	t.Cleanup(sess.Close)

	var spawned atomic.Bool
	col2 := &collector{}
	_, err = reg.Open(OpenParams{ID: "dup", WindowKey: "w1", Cwd: dir, Cols: 80, Rows: 24, OnData: func(b []byte) {
		spawned.Store(true)
		col2.onData(b)
	}, OnExit: col2.onExit})

	if err == nil {
		t.Fatal("second Open with a live id returned no error")
	}
	if err != ErrDuplicateSession {
		t.Fatalf("second Open error = %v, want ErrDuplicateSession", err)
	}
	if spawned.Load() {
		t.Fatal("second Open spawned a process for a duplicate id")
	}
}
