package importer

import (
	"testing"
	"time"
)

// TestCreateAlwaysFindsRunner: a Create racing a runner's idle exit, its lock probe or its start
// still ends with a runner working the job. The lock probe in ensureRunner briefly holds the lock,
// so a runner starting or relocking in that window sees ErrRunnerBusy and exits; the probe's own
// Launch must cover it.
func TestCreateAlwaysFindsRunner(t *testing.T) {
	h := newHarness(t, 1)
	_ = h.launcher.Close()
	opts := h.runnerOpts()
	opts.IdleExit = 5 * time.Millisecond
	h.launcher = newInProcessLauncher(t, h.ms, opts)
	e, err := Open(h.ms, Options{Launcher: h.launcher})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = e.Close() })
	for i := range 150 {
		j, err := e.Create(CreateArgs{Paths: []string{h.dir}})
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(5 * time.Second)
		for {
			d, err := e.Job(j.ID)
			if err != nil {
				t.Fatal(err)
			}
			if d.Job.State == JobAwaiting {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("job %d stuck in %s: no runner picked it up", i, d.Job.State)
			}
			time.Sleep(2 * time.Millisecond)
		}
		if err := e.Discard(j.ID); err != nil {
			t.Fatal(err)
		}
		time.Sleep(time.Duration(i%7) * time.Millisecond) // vary the gap against the idle exit
	}
}
