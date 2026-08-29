package preconnect

import (
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

func waitUntil(t *testing.T, timeout time.Duration, cond func() bool) {
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

func entryPID(t *testing.T, s *Supervisor, connectionID string) int {
	t.Helper()
	s.mu.Lock()
	e, ok := s.entries[connectionID]
	s.mu.Unlock()
	if !ok {
		t.Fatalf("no tracked entry for %q", connectionID)
	}
	return e.pid
}

func entryDead(s *Supervisor, connectionID string) *Exit {
	s.mu.Lock()
	e, ok := s.entries[connectionID]
	s.mu.Unlock()
	if !ok {
		return nil
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.dead
}

// exitCollector is a small OnExit sink safe for concurrent use across the tests below.
type exitCollector struct {
	mu   sync.Mutex
	exit []Exit
}

func (c *exitCollector) handle(e Exit) {
	c.mu.Lock()
	c.exit = append(c.exit, e)
	c.mu.Unlock()
}

func (c *exitCollector) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.exit)
}

func (c *exitCollector) last() Exit {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.exit[len(c.exit)-1]
}

func TestOneShotExitZero(t *testing.T) {
	s := New()
	start := time.Now()
	got, err := s.Start("c1", "true")
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got.Kind != KindOneShot {
		t.Errorf("Kind = %q, want %q", got.Kind, KindOneShot)
	}
	if elapsed >= settleWindow {
		t.Errorf("Start took %s, want well inside the settle window (%s)", elapsed, settleWindow)
	}
}

func TestSidecarSettles(t *testing.T) {
	s := New()
	got, err := s.Start("c1", "sleep 30")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got.Kind != KindSidecar {
		t.Errorf("Kind = %q, want %q", got.Kind, KindSidecar)
	}
	pid := entryPID(t, s, "c1")
	if !processAlive(pid) {
		t.Fatalf("pid %d is not alive after settling", pid)
	}
	s.Stop("c1")
	waitUntil(t, 2*time.Second, func() bool { return !processAlive(pid) })
}

func TestFailureBeforeSettleCarriesStderrTail(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    string
	}{
		{"exit code with stderr", "echo boom >&2; exit 3", "Pre-connect script failed (exit 3): boom"},
		{"self-signal", "kill -TERM $$", "Pre-connect script failed (signal SIGTERM)"},
		{"multi-line stderr keeps only the last non-blank line",
			"echo one >&2; echo two >&2; echo >&2; exit 1", "Pre-connect script failed (exit 1): two"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := New()
			_, err := s.Start("c1", tt.command)
			if err == nil {
				t.Fatalf("Start: want an error, got none")
			}
			if err.Error() != tt.want {
				t.Errorf("Start error = %q, want %q", err.Error(), tt.want)
			}
		})
	}
}

func TestDiedBetweenStartAndArm(t *testing.T) {
	s := New()
	var oe exitCollector
	s.OnExit(oe.handle)

	got, err := s.Start("c1", "sleep 0.2; echo dying >&2; exit 7")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got.Kind != KindSidecar {
		t.Fatalf("Kind = %q, want %q", got.Kind, KindSidecar)
	}

	waitUntil(t, 2*time.Second, func() bool { return entryDead(s, "c1") != nil })
	if oe.count() != 0 {
		t.Fatalf("OnExit fired before Arm: %+v", oe.exit)
	}

	s.Arm("c1")
	if oe.count() != 1 {
		t.Fatalf("OnExit did not fire synchronously from Arm, count=%d", oe.count())
	}
	exit := oe.last()
	if exit.Code == nil || *exit.Code != 7 {
		t.Errorf("Code = %v, want 7", exit.Code)
	}
	if exit.Signal != "" {
		t.Errorf("Signal = %q, want empty", exit.Signal)
	}
	if exit.LastStderr == nil || *exit.LastStderr != "dying" {
		t.Errorf("LastStderr = %v, want \"dying\"", exit.LastStderr)
	}
}

func TestArmedExitFiresOnExit(t *testing.T) {
	s := New()
	var oe exitCollector
	s.OnExit(oe.handle)

	got, err := s.Start("c1", "sleep 0.2; exit 5")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if got.Kind != KindSidecar {
		t.Fatalf("Kind = %q, want %q", got.Kind, KindSidecar)
	}
	s.Arm("c1")

	waitUntil(t, 2*time.Second, func() bool { return oe.count() > 0 })
	if oe.count() != 1 {
		t.Fatalf("OnExit fired %d times, want 1", oe.count())
	}
	if code := oe.last().Code; code == nil || *code != 5 {
		t.Errorf("Code = %v, want 5", code)
	}
}

func TestSelfInflictedKillDoesNotFireOnExit(t *testing.T) {
	t.Run("Stop on an armed sidecar", func(t *testing.T) {
		s := New()
		var oe exitCollector
		s.OnExit(oe.handle)

		if _, err := s.Start("c1", "sleep 30"); err != nil {
			t.Fatalf("Start: %v", err)
		}
		s.Arm("c1")
		s.Stop("c1")
		time.Sleep(1 * time.Second)
		if oe.count() != 0 {
			t.Fatalf("OnExit fired %d times after a self-inflicted Stop, want 0", oe.count())
		}
	})

	t.Run("Start superseding a previous entry", func(t *testing.T) {
		s := New()
		var oe exitCollector
		s.OnExit(oe.handle)

		if _, err := s.Start("c1", "sleep 30"); err != nil {
			t.Fatalf("Start (1): %v", err)
		}
		s.Arm("c1")
		if _, err := s.Start("c1", "sleep 30"); err != nil {
			t.Fatalf("Start (2): %v", err)
		}
		time.Sleep(1 * time.Second)
		if oe.count() != 0 {
			t.Fatalf("OnExit fired %d times after a superseding Start, want 0", oe.count())
		}
		s.StopAll()
	})
}

func TestSigtermEscalatesToSigkill(t *testing.T) {
	s := New()
	if _, err := s.Start("c1", `trap "" TERM; sleep 30`); err != nil {
		t.Fatalf("Start: %v", err)
	}
	pid := entryPID(t, s, "c1")

	start := time.Now()
	s.Stop("c1")
	elapsed := time.Since(start)

	if processAlive(pid) {
		t.Fatalf("pid %d is still alive after Stop", pid)
	}
	if elapsed < killGrace {
		t.Errorf("Stop returned after %s, want at least killGrace (%s) since SIGTERM was ignored", elapsed, killGrace)
	}
}

func TestProcessGroupKillReachesGrandchild(t *testing.T) {
	s := New()
	if _, err := s.Start("c1", "sleep 300 & sleep 300"); err != nil {
		t.Fatalf("Start: %v", err)
	}
	pgid := entryPID(t, s, "c1")

	s.Stop("c1")

	// This sandbox's minimal container init reparents and reaps orphaned grandchildren more
	// slowly than a real system init (launchd/systemd) does, so kill(-pgid, 0) can keep
	// answering for a zombie for a second or two after it has already received and acted on
	// the signal — poll rather than asserting ESRCH on the first check.
	waitUntil(t, 5*time.Second, func() bool { return syscall.Kill(-pgid, 0) == syscall.ESRCH })
}

func TestPathIsAugmented(t *testing.T) {
	// A short base PATH keeps the augmented value comfortably under stderrTailMax so the
	// assertion below exercises the augmentation itself, not the tail's 200-char truncation.
	t.Setenv("PATH", "/usr/bin:/bin")

	s := New()
	_, err := s.Start("c1", "echo $PATH >&2; exit 1")
	if err == nil {
		t.Fatalf("Start: want an error, got none")
	}
	const suffix = "/usr/local/bin:/opt/homebrew/bin"
	msg := err.Error()
	if !strings.HasSuffix(msg, suffix) {
		t.Errorf("error %q does not end with %q", msg, suffix)
	}
	if n := strings.Count(msg, suffix); n != 1 {
		t.Errorf("error %q contains %q %d times, want exactly 1", msg, suffix, n)
	}
}

func TestCwdIsHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	s := New()
	_, err := s.Start("c1", "pwd >&2; exit 1")
	if err == nil {
		t.Fatalf("Start: want an error, got none")
	}
	want := fmt.Sprintf("Pre-connect script failed (exit 1): %s", home)
	if err.Error() != want {
		t.Errorf("Start error = %q, want %q", err.Error(), want)
	}
}

func TestStopAll(t *testing.T) {
	s := New()
	var oe exitCollector
	s.OnExit(oe.handle)

	pids := make([]int, 0, 3)
	for _, id := range []string{"c1", "c2", "c3"} {
		if _, err := s.Start(id, "sleep 30"); err != nil {
			t.Fatalf("Start(%s): %v", id, err)
		}
		s.Arm(id)
		pids = append(pids, entryPID(t, s, id))
	}

	s.StopAll()

	for _, pid := range pids {
		if processAlive(pid) {
			t.Errorf("pid %d is still alive after StopAll", pid)
		}
	}
	if oe.count() != 0 {
		t.Errorf("OnExit fired %d times after StopAll, want 0", oe.count())
	}
}

func TestSpawnFailureMessage(t *testing.T) {
	t.Setenv("HOME", filepath.Join(t.TempDir(), "does-not-exist"))

	s := New()
	start := time.Now()
	_, err := s.Start("c1", "true")
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("Start: want an error, got none")
	}
	if !strings.HasPrefix(err.Error(), "Pre-connect script could not start:") {
		t.Errorf("error = %q, want the spawn-failure sentence", err.Error())
	}
	if elapsed >= settleWindow {
		t.Errorf("Start took %s, want well under the settle window (%s) — it must not hang waiting to settle", elapsed, settleWindow)
	}
}

func TestArmOnUnknownConnectionIsANoop(t *testing.T) {
	s := New()
	s.Arm("does-not-exist") // must not panic
}

func TestStopOnUnknownConnectionIsANoop(t *testing.T) {
	s := New()
	s.Stop("does-not-exist") // must not panic
}
