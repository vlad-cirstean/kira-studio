package preconnect

import (
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

// TestOneShotExitZero pins the settle-window race in Start: a script that exits 0 before the
// window elapses must win the race and be classified one-shot, never tracked as a sidecar.
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

// TestFailureBeforeSettleCarriesStderrTail guards the ordering the spawn goroutine depends on:
// stderr must be drained to EOF before cmd.Wait() is called, or the rejection message loses the
// tail it is composed from. It also covers signal-vs-exit-code classification.
func TestFailureBeforeSettleCarriesStderrTail(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    string
	}{
		{"exit code with stderr", "echo boom >&2; exit 3", "Pre-connect script failed (exit 3): boom"},
		{"self-signal", "kill -TERM $$", "Pre-connect script failed (signal SIGTERM)"},
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

// TestDiedBetweenStartAndArm covers the race the `dead` field exists for: a sidecar that exits
// after Start resolved but before Arm was called must have its exit buffered and replayed
// synchronously by Arm, not dropped and not fired early.
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

// TestSelfInflictedKillDoesNotFireOnExit covers the `killing` flag: an exit this supervisor
// itself caused (Stop, or a Start superseding a previous entry) must stay silent, or every
// disconnect would surface to the user as a dropped connection.
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

// TestSigtermEscalatesToSigkill covers killEntry's escalation: a script that ignores SIGTERM must
// still be dead by the time Stop returns, and Stop must block for the real exit.
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

// TestProcessGroupKillReachesGrandchild covers Setpgid + kill(-pgid): a pre-connect script that
// backgrounds its own child must not leave that grandchild running after Stop.
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
