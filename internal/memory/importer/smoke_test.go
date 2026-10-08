//go:build claudesmoke

package importer

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory"
)

// Real Claude Code CLI, not in CI:
//
//	go test -tags claudesmoke ./internal/memory/importer/ -run Smoke -v
//
// The finalize agent's MCP server is this test binary re-executed as `memory-mcp` (see TestMain).
func TestSmokeImport(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ms := memory.OpenDefault()
	defer ms.Close()
	svc := memory.NewService(ms, memory.NewCLIRunner(), memory.ServiceOptions{})
	defer svc.Close()
	agent := ClaudeAgent{Runner: memory.NewCLIRunner(), Executable: exe, Home: memory.Home(),
		Env: map[string]string{"KIRA_TEST_MEMORY_MCP": "1"}}
	// A small budget forces billing.md's second section into its own chunk, so "It restarts..."
	// reaches step 1 without the service name.
	e, err := Open(ms, Options{Agent: agent, Budget: Budget{Target: 150, Max: 250, MinFill: 40, MinTail: 1, Context: 60}})
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()

	begin := time.Now()
	job, err := e.Create([]string{"testdata/smoke"})
	if err != nil {
		t.Fatal(err)
	}
	waitFor := func(want string) JobDetail {
		t.Helper()
		deadline := time.Now().Add(20 * time.Minute)
		for time.Now().Before(deadline) {
			d, err := e.Job(job.ID)
			if err != nil {
				t.Fatal(err)
			}
			if d.Job.State == want {
				return d
			}
			if d.Job.State == JobFailed || d.Job.State == JobPaused {
				t.Fatalf("job %s: %s", d.Job.State, d.Job.Reason)
			}
			time.Sleep(500 * time.Millisecond)
		}
		t.Fatalf("job never reached %s", want)
		return JobDetail{}
	}
	d := waitFor(JobAwaiting)
	t.Logf("estimate: %+v", d.Job.Estimate)
	if err := e.Start(job.ID); err != nil {
		t.Fatal(err)
	}
	d = waitFor(JobDone)
	t.Logf("done in %s: calls=%d cost=$%.3f totals=%+v", time.Since(begin).Round(time.Second), d.Job.Calls, d.Job.CostUSD, d.Job.Totals)
	for _, f := range d.Files {
		t.Logf("file %s: %s chunks=%d facts=%d added=%d updated=%d noop=%d cost=$%.3f unresolved=%+v dropped=%+v reason=%q",
			f.RelPath, f.State, f.ChunkCount, f.FactCount, f.Added, f.Updated, f.Noop, f.CostUSD, f.Unresolved, f.Dropped, f.Reason)
		if f.State != FileDone {
			t.Errorf("%s is %s", f.RelPath, f.State)
		}
	}
	mems, err := svc.Recent(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	imported := 0
	for _, m := range mems {
		h, err := svc.History(context.Background(), m.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, ev := range h.Events {
			if ev.Source == memory.SourceImport && ev.Action == memory.ActionAdd {
				imported++
			}
		}
		t.Logf("memory: %s\n    reason: %s", m.Fact, m.Reason)
	}
	if imported == 0 {
		t.Error("no add event with source import")
	}
}
