package gitsearch

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

func skipWithoutGitScan(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

// initScanRepo builds a repo of n commits via `git fast-import` — orders of magnitude faster than
// n real `git commit` spawns, which is what makes a 1000+-commit budget test practical to run on
// every `go test`. subjectFor derives commit i's (1-indexed) subject.
func initScanRepo(t *testing.T, n int, subjectFor func(i int) string) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")

	var script strings.Builder
	for i := 1; i <= n; i++ {
		subject := subjectFor(i)
		fmt.Fprintf(&script, "commit refs/heads/main\n")
		fmt.Fprintf(&script, "committer Test <test@example.com> %d +0000\n", 1_700_000_000+i)
		fmt.Fprintf(&script, "data %d\n%s\n", len(subject), subject)
		if i == 1 {
			script.WriteString("deleteall\n")
		}
		body := fmt.Sprintf("%d", i)
		fmt.Fprintf(&script, "M 100644 inline f.txt\ndata %d\n%s\n", len(body), body)
	}

	cmd := exec.Command("git", "fast-import", "--quiet")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
	cmd.Stdin = strings.NewReader(script.String())
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git fast-import: %v\n%s", err, out)
	}
	return dir
}

func scanDeps(dir string) Deps {
	return Deps{Runner: gitclient.NewExecRunner(), GitPath: "git", Dir: dir}
}

func TestScan_BasicMatch(t *testing.T) {
	skipWithoutGitScan(t)
	dir := initScanRepo(t, 5, func(i int) string {
		if i == 3 {
			return "the needle commit"
		}
		return fmt.Sprintf("plain commit %d", i)
	})
	m, err := Compile(Query{Text: "needle"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	res, err := Scan(context.Background(), scanDeps(dir), Options{
		Args: porcelain.LogScanArgs(porcelain.WalkSpec{Scope: "all"}), Matcher: m,
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if res.Scanned != 5 {
		t.Fatalf("Scanned = %d, want 5", res.Scanned)
	}
	if res.Total != 1 {
		t.Fatalf("Total = %d, want 1", res.Total)
	}
	if len(res.Hits) != 1 || res.Hits[0].Subject != "the needle commit" {
		t.Fatalf("Hits = %+v, want exactly the needle commit", res.Hits)
	}
	if res.Truncated {
		t.Fatal("expected Truncated = false")
	}
	if !res.Complete {
		t.Fatal("expected Complete = true")
	}
}

func TestScan_LimitCapsHitsButKeepsExactTotal(t *testing.T) {
	skipWithoutGitScan(t)
	const n = 50
	dir := initScanRepo(t, n, func(i int) string {
		if i%5 == 0 {
			return fmt.Sprintf("needle commit %d", i)
		}
		return fmt.Sprintf("plain commit %d", i)
	})
	m, err := Compile(Query{Text: "needle"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	res, err := Scan(context.Background(), scanDeps(dir), Options{
		Args: porcelain.LogScanArgs(porcelain.WalkSpec{Scope: "all"}), Matcher: m, Limit: 3,
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	wantTotal := n / 5
	if res.Total != wantTotal {
		t.Fatalf("Total = %d, want %d (exact past the limit)", res.Total, wantTotal)
	}
	if len(res.Hits) != 3 {
		t.Fatalf("len(Hits) = %d, want 3 (Limit)", len(res.Hits))
	}
	if !res.Truncated {
		t.Fatal("expected Truncated = true")
	}
	if res.Scanned != n {
		t.Fatalf("Scanned = %d, want %d (the scan runs to git's own end regardless of Limit)", res.Scanned, n)
	}
	if !res.Complete {
		t.Fatal("expected Complete = true (no time box fired)")
	}
}

// TestScan_BudgetFiresEarly needs > 1024 commits so the deadline check (every 1024 scanned
// records) actually fires before EOF — built via fast-import so this stays fast.
func TestScan_BudgetFiresEarly(t *testing.T) {
	skipWithoutGitScan(t)
	const n = 1100
	dir := initScanRepo(t, n, func(i int) string { return fmt.Sprintf("commit %d", i) })
	m, err := Compile(Query{Text: "commit"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	res, err := Scan(context.Background(), scanDeps(dir), Options{
		Args:    porcelain.LogScanArgs(porcelain.WalkSpec{Scope: "all"}),
		Matcher: m,
		Budget:  1, // already in the past by the time the first 1024-record check runs.
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if res.Complete {
		t.Fatal("expected Complete = false -- the budget must have fired before EOF")
	}
	if res.Scanned != 1024 {
		t.Fatalf("Scanned = %d, want exactly 1024 (the first deadline-check boundary)", res.Scanned)
	}
	if res.Scanned >= n {
		t.Fatalf("Scanned = %d, want less than the full walk (%d) -- the scan must have stopped early", res.Scanned, n)
	}
}

func TestScan_DefaultsApplyWhenUnset(t *testing.T) {
	skipWithoutGitScan(t)
	dir := initScanRepo(t, 1, func(i int) string { return "sole commit" })
	m, err := Compile(Query{Text: "sole"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	res, err := Scan(context.Background(), scanDeps(dir), Options{
		Args: porcelain.LogScanArgs(porcelain.WalkSpec{Scope: "all"}), Matcher: m,
		// Limit and Budget both left zero -- DefaultLimit/DefaultScanBudget must apply.
	})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if len(res.Hits) != 1 {
		t.Fatalf("Hits = %+v, want exactly one", res.Hits)
	}
}

// TestScan_CancelledContextStopsPromptlyAndKillsTheChild is the exit criterion's own "a cancelled
// scan actually kills its child process with no orphan left running": Scan must return promptly
// once ctx is cancelled, and Process.Close (which readScanChunk calls on cancellation) BLOCKS
// until the child has actually been reaped (Process's own doc comment) -- so this test returning
// at all, well within its own timeout, is itself the proof no orphan git process is left running
// past this call.
func TestScan_CancelledContextStopsPromptlyAndKillsTheChild(t *testing.T) {
	skipWithoutGitScan(t)
	// Large enough that an uncancelled scan would still be reading when the cancel fires.
	const n = 5000
	dir := initScanRepo(t, n, func(i int) string { return fmt.Sprintf("commit number %d has a fairly long subject line to pad the scan's own output a little", i) })
	m, err := Compile(Query{Text: "commit"})
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct {
		res Result
		err error
	}, 1)
	go func() {
		res, serr := Scan(ctx, scanDeps(dir), Options{
			Args: porcelain.LogScanArgs(porcelain.WalkSpec{Scope: "all"}), Matcher: m,
		})
		done <- struct {
			res Result
			err error
		}{res, serr}
	}()
	cancel()

	select {
	case outcome := <-done:
		if outcome.err == nil {
			t.Fatal("expected Scan to return an error for a cancelled context")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Scan did not return within 10s of cancellation -- the child was not killed promptly")
	}
}
