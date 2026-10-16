package gitsession

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
)

// failConfigSetWhenArmedRunner makes StackConfigSetArgs' shape (`config --local <key> <value>`)
// exit non-zero while armed, so a multi-argv op fails after its first write landed.
type failConfigSetWhenArmedRunner struct {
	gitclient.Runner
	armed *atomic.Bool
}

func (r failConfigSetWhenArmedRunner) Start(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
	if r.armed.Load() && len(spec.Args) == 4 && spec.Args[0] == "config" && spec.Args[1] == "--local" {
		spec.Args = []string{"config", "--local", "invalid key", "x"}
	}
	return r.Runner.Start(ctx, gitPath, spec)
}

func TestRunOp_BranchDeleteFailingAfterFirstWriteKeepsUndo(t *testing.T) {
	t.Parallel()
	skipWithoutGitStack(t)
	dir := initThreeLevelStack(t)
	armed := &atomic.Bool{}
	conn, entry := newStackTestConnAndEntry(t, failConfigSetWhenArmedRunner{Runner: gitclient.NewExecRunner(), armed: armed}, dir)
	ctx := context.Background()
	parentBefore := strings.TrimSpace(runOutput(t, dir, "config", "branch.feat3.kirastackparent"))

	armed.Store(true)
	res, err := entry.RunOp(ctx, conn.ID, "t", OpRequest{Kind: "branchDelete", Name: "feat2", Force: true})
	if err != nil {
		t.Fatalf("RunOp: %v", err)
	}
	if res.OK || res.Error == nil || !strings.Contains(res.Error.Message, "Branch feat2 was deleted") {
		t.Fatalf("result = %+v, want a failure naming the landed delete", res)
	}
	if res.Undo == nil {
		t.Fatal("undo dropped although the branch delete landed")
	}
	if out := runOutput(t, dir, "branch", "--list", "feat2"); strings.TrimSpace(out) != "" {
		t.Fatalf("feat2 still exists: %q", out)
	}

	armed.Store(false)
	undo, err := entry.UndoRun(ctx, "t", res.Undo.ID)
	if err != nil || !undo.OK {
		t.Fatalf("UndoRun = %+v, %v", undo, err)
	}
	if got := strings.TrimSpace(runOutput(t, dir, "config", "branch.feat3.kirastackparent")); got != parentBefore {
		t.Fatalf("feat3 parent = %q, want %q", got, parentBefore)
	}
}

func TestUndoRun_BranchDeleteRestoresMultiLineAndMultiValuedConfig(t *testing.T) {
	t.Parallel()
	dir, entry := initUndoGuardRepo(t)
	runGitQ(t, dir, "branch", "topic")
	const hooks = "core.hooksPath /tmp/evil"
	runGitQ(t, dir, "config", "--local", "branch.topic.description", "first line\n"+hooks)
	runGitQ(t, dir, "config", "--local", "--add", "branch.topic.merge", "refs/heads/a")
	runGitQ(t, dir, "config", "--local", "--add", "branch.topic.merge", "refs/heads/b")

	ctx := context.Background()
	res, err := entry.RunOp(ctx, ConnID("c"), "t", OpRequest{Kind: "branchDelete", Name: "topic", Force: true})
	if err != nil || !res.OK || res.Undo == nil {
		t.Fatalf("RunOp = %+v, %v", res, err)
	}
	undo, err := entry.UndoRun(ctx, "t", res.Undo.ID)
	if err != nil || !undo.OK {
		t.Fatalf("UndoRun = %+v, %v", undo, err)
	}
	if got := runOutput(t, dir, "config", "--local", "--get-all", "branch.topic.merge"); got != "refs/heads/a\nrefs/heads/b\n" {
		t.Fatalf("branch.topic.merge = %q, want both values", got)
	}
	if got := runOutput(t, dir, "config", "--local", "branch.topic.description"); got != "first line\n"+hooks+"\n" {
		t.Fatalf("description = %q", got)
	}
	if out, err := execGitOutput(dir, "config", "--local", "core.hooksPath"); err == nil {
		t.Fatalf("undo wrote core.hooksPath = %q from a description line", out)
	}
}

func execGitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("git %v: %w", args, err)
	}
	return string(out), nil
}

func TestUndoRun_RefusesWhenRefMovedSinceOp(t *testing.T) {
	t.Parallel()
	t.Run("hardReset", func(t *testing.T) {
		t.Parallel()
		dir, entry := initUndoGuardRepo(t)
		prev := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("two\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		runGitQ(t, dir, "commit", "-aqm", "second")
		ctx := context.Background()
		res, err := entry.RunOp(ctx, ConnID("c"), "t", OpRequest{Kind: "reset", Mode: "hard", Target: prev})
		if err != nil || !res.OK || res.Undo == nil {
			t.Fatalf("RunOp = %+v, %v", res, err)
		}
		if err := os.WriteFile(filepath.Join(dir, "g.txt"), []byte("g\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		runGitQ(t, dir, "add", "g.txt")
		runGitQ(t, dir, "commit", "-qm", "terminal commit")
		newer := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
		undo, err := entry.UndoRun(ctx, "t", res.Undo.ID)
		if err != nil || undo.OK {
			t.Fatalf("UndoRun = %+v, %v, want refusal", undo, err)
		}
		if got := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD")); got != newer {
			t.Fatalf("HEAD = %s, want untouched %s", got, newer)
		}
	})
	t.Run("restack", func(t *testing.T) {
		t.Parallel()
		skipWithoutGitStack(t)
		dir := initThreeLevelStack(t)
		conn, entry := newStackTestConnAndEntry(t, gitclient.NewExecRunner(), dir)
		ctx := context.Background()
		result, err := entry.RunRestack(ctx, conn, "feat3")
		if err != nil || !result.OK || result.Undo == nil {
			t.Fatalf("RunRestack: result=%+v err=%v", result, err)
		}
		runGitStack(t, dir, "checkout", "-q", "feat3")
		writeFileStack(t, dir, "d.txt", "d\n")
		runGitStack(t, dir, "add", "d.txt")
		runGitStack(t, dir, "commit", "-q", "-m", "terminal commit")
		newer := revParseStack(t, dir, "feat3")
		undo, err := entry.UndoRun(ctx, "t", result.Undo.ID)
		if err != nil || undo.OK {
			t.Fatalf("UndoRun = %+v, %v, want refusal", undo, err)
		}
		if got := revParseStack(t, dir, "feat3"); got != newer {
			t.Fatalf("feat3 = %s, want untouched %s", got, newer)
		}
	})
}
