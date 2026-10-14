package importer

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/testx"
)

type noLauncher struct{}

func (noLauncher) Launch() error { return nil }

// TestOneRunnerPerStore: a second runner on the same store loses the lock and exits; once the winner
// is gone a new one takes over and pauses the job the winner left running.
func TestOneRunnerPerStore(t *testing.T) {
	h := newHarness(t, 1)
	opts := h.runnerOpts()
	opts.IdleExit = time.Second

	first, err := NewRunner(h.ms, opts)
	if err != nil {
		t.Fatal(err)
	}
	firstDone := make(chan error, 1)
	go func() { firstDone <- first.Run(context.Background()) }()
	select {
	case <-first.ready:
	case err := <-firstDone:
		t.Fatalf("first runner ended early: %v", err)
	}

	second, err := NewRunner(h.ms, opts)
	if err != nil {
		t.Fatal(err)
	}
	if err := second.Run(context.Background()); !errors.Is(err, ErrRunnerBusy) {
		t.Fatalf("second runner = %v, want ErrRunnerBusy", err)
	}

	select {
	case err := <-firstDone:
		if err != nil {
			t.Fatalf("idle runner = %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("idle runner did not exit")
	}

	j := h.create()
	_ = h.launcher.Close() // the engine's own runner; the test plays the dead predecessor
	for _, q := range []string{
		`UPDATE import_jobs SET state = 'running' WHERE id = '` + j.ID + `'`,
		`UPDATE import_files SET state = 'extracting' WHERE job_id = '` + j.ID + `'`,
		`INSERT INTO import_chunks (file_id, idx, text, tokens, state) SELECT id, 0, 'x', 1, 'running' FROM import_files WHERE job_id = '` + j.ID + `'`,
	} {
		if _, err := h.e.st.db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	third, err := NewRunner(h.ms, opts)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	thirdDone := make(chan error, 1)
	go func() { thirdDone <- third.Run(ctx) }()
	d := h.waitState(j.ID, JobPaused)
	if d.Job.Reason != interruptedReason {
		t.Errorf("reason = %q", d.Job.Reason)
	}
	if n := h.rows(`SELECT idx FROM import_chunks WHERE state = 'pending'`); len(n) != 1 {
		t.Errorf("chunk not back to pending: %v", n)
	}
	cancel()
	<-thirdDone
}

// TestPauseFromControlCancelsInFlight: a pause written by another Engine instance reaches the
// runner through the job row and kills the in-flight call.
func TestPauseFromControlCancelsInFlight(t *testing.T) {
	h := newHarness(t, 1)
	started := make(chan struct{}, 8)
	cancelled := make(chan time.Time, 8)
	h.agent.extractHook = func(ctx context.Context, _ DistillInput) error {
		started <- struct{}{}
		<-ctx.Done()
		cancelled <- time.Now()
		return ctx.Err()
	}
	j := h.create()
	h.mustStart(j.ID)
	<-started

	other, err := Open(h.ms, Options{Launcher: noLauncher{}})
	if err != nil {
		t.Fatal(err)
	}
	paused := time.Now()
	if err := other.Pause(j.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case at := <-cancelled:
		if lag := at.Sub(paused); lag > 10*h.runnerOpts().Tick {
			t.Errorf("call cancelled %v after the pause", lag)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("in-flight call survived the pause")
	}
	testx.WaitUntil(t, 5*time.Second, func() bool {
		return len(h.rows(`SELECT idx FROM import_chunks WHERE state = 'pending' AND attempts = 0`)) == 3
	})
}
