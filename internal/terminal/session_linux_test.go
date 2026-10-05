//go:build linux

package terminal

import (
	"syscall"
	"testing"
	"time"
)

// killJobOnCleanup reaps a job the test deliberately leaves alive.
func killJobOnCleanup(t *testing.T, pid int) {
	t.Helper()
	t.Cleanup(func() { _ = syscall.Kill(pid, syscall.SIGKILL) })
}

// Jobs the shell does not hang up (dash never forwards; disown; nohup) outlive the tab by design,
// but must not stall Close: the session ends once the shell exits, not when the slave closes.
func TestSessionCloseLeavesUnhungJobs(t *testing.T) {
	for _, tc := range []struct{ name, shell, line string }{
		{"dash background", "dash", "sleep 300 &"},
		{"bash disown", "bash", "sleep 300 & disown"},
		{"bash nohup", "bash", "nohup sleep 300 >/dev/null 2>&1 &"},
		{"zsh disown", "zsh", "sleep 300 & disown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sess, col := openShellSession(t, tc.shell, "unhung-"+tc.shell)
			job := startJob(t, sess, col, tc.line)
			killJobOnCleanup(t, job)

			start := time.Now()
			sess.Close()
			elapsed := time.Since(start)

			select {
			case <-sess.done:
			default:
				t.Fatal("Close returned before the session exited")
			}
			if elapsed >= closeGracePeriod {
				t.Fatalf("Close took %s, want < %s", elapsed, closeGracePeriod)
			}
			time.Sleep(300 * time.Millisecond)
			if !processAlive(job) {
				t.Fatalf("job %d died; the shell does not hang it up", job)
			}
		})
	}
}

func TestSessionExitsWhenShellExitsLeavingJob(t *testing.T) {
	sess, col := openShellSession(t, "bash", "exit-leaving-job")
	job := startJob(t, sess, col, "sleep 300 & disown")
	killJobOnCleanup(t, job)

	if err := sess.Write([]byte("exit\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	select {
	case <-sess.done:
	case <-time.After(closeGracePeriod):
		t.Fatal("session did not end after its shell exited")
	}
	col.mu.Lock()
	exits, code := col.exits, col.exitCode
	col.mu.Unlock()
	if exits != 1 || code != 0 {
		t.Fatalf("exits = %d, code = %d, want 1 and 0", exits, code)
	}
	if !processAlive(job) {
		t.Fatalf("job %d died; the shell does not hang it up", job)
	}
}
