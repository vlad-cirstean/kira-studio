package gitprepare_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitprepare"
)

// These tests exercise the real osRunner against the system's own /bin/sh — this package's own
// production seam (unlike gitsession, which fakes gitprepare.Runner entirely and never spawns a
// real shell in its own test suite, D18).

func TestRun_ExitCodeAndStdout(t *testing.T) {
	dir := t.TempDir()
	res, err := gitprepare.NewOSRunner().Run(context.Background(), gitprepare.Spec{
		Shell: "/bin/sh", Script: "echo hello; exit 7", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.ExitCode != 7 {
		t.Fatalf("ExitCode = %d, want 7", res.ExitCode)
	}
	var out strings.Builder
	for _, l := range res.Output {
		out.WriteString(l.Text)
		out.WriteByte('\n')
	}
	if !strings.Contains(out.String(), "hello") {
		t.Fatalf("output = %q, want it to contain \"hello\"", out.String())
	}
}

func TestRun_RunsInSpecifiedDir(t *testing.T) {
	dir := t.TempDir()
	res, err := gitprepare.NewOSRunner().Run(context.Background(), gitprepare.Spec{
		Shell: "/bin/sh", Script: "pwd", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	found := false
	for _, l := range res.Output {
		if strings.TrimSpace(l.Text) == dir {
			found = true
		}
	}
	if !found {
		t.Fatalf("output %+v did not contain cwd %q", res.Output, dir)
	}
}

// TestRun_EnvIsExactlySpecEnv proves Env is used AS THE CHILD'S FULL ENVIRONMENT, not appended to
// this test process's own os.Environ() a second time — an unset variable in Env must be genuinely
// unset in the child, and a set one must reach it unmodified.
func TestRun_EnvIsExactlySpecEnv(t *testing.T) {
	dir := t.TempDir()
	res, err := gitprepare.NewOSRunner().Run(context.Background(), gitprepare.Spec{
		Shell: "/bin/sh", Dir: dir,
		Script: `echo "MARKER=[$KIRA_TEST_MARKER]"`,
		Env:    []string{"PATH=/usr/bin:/bin", "KIRA_TEST_MARKER=present"},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	var out strings.Builder
	for _, l := range res.Output {
		out.WriteString(l.Text)
	}
	if !strings.Contains(out.String(), "MARKER=[present]") {
		t.Fatalf("output = %q, want MARKER=[present]", out.String())
	}
}

// TestRun_StdinClosed proves D12's "stdin closed, never a pty" — a script that tries to read a
// line from stdin gets EOF immediately rather than hanging.
func TestRun_StdinClosed(t *testing.T) {
	dir := t.TempDir()
	done := make(chan struct{})
	go func() {
		_, _ = gitprepare.NewOSRunner().Run(context.Background(), gitprepare.Spec{
			Shell: "/bin/sh", Script: "read line; echo \"got:[$line]\"", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
		})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return within 5s — stdin appears not to be closed")
	}
}

// TestRun_CancelKillsProcess proves a cancelled ctx actually terminates the child rather than
// leaking it — a script that would otherwise sleep far longer than the test's own patience.
func TestRun_CancelKillsProcess(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	resultCh := make(chan gitprepare.Result, 1)
	go func() {
		res, _ := gitprepare.NewOSRunner().Run(ctx, gitprepare.Spec{
			Shell: "/bin/sh", Script: "sleep 60", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
		})
		resultCh <- res
	}()
	time.Sleep(200 * time.Millisecond)
	cancel()
	select {
	case res := <-resultCh:
		if !res.Cancelled {
			t.Fatalf("got %+v, want Cancelled true", res)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return within 10s of cancellation — the child was not killed")
	}
}

// TestRun_OnBatchDeliveredDuringRun proves output streams to OnBatch WHILE the process is still
// running, not only after it exits.
func TestRun_OnBatchDeliveredDuringRun(t *testing.T) {
	dir := t.TempDir()
	batchCh := make(chan []gitprepare.Line, 16)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_, _ = gitprepare.NewOSRunner().Run(ctx, gitprepare.Spec{
			Shell: "/bin/sh", Script: "echo one; sleep 5; echo two", Dir: dir, Env: []string{"PATH=/usr/bin:/bin"},
			OnBatch: func(b []gitprepare.Line) { batchCh <- b },
		})
	}()
	select {
	case b := <-batchCh:
		found := false
		for _, l := range b {
			if strings.TrimSpace(l.Text) == "one" {
				found = true
			}
		}
		if !found {
			t.Fatalf("first batch = %+v, want it to contain \"one\"", b)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no batch delivered within 5s of the first echo — output is not streaming live")
	}
}
