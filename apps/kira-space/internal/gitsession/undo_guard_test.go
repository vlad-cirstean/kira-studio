package gitsession

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func initUndoGuardRepo(t *testing.T) (string, *RepoEntry) {
	t.Helper()
	skipWithoutGitQueries(t)
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitQ(t, dir, "add", "f.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	return dir, newQueriesTestEntry(t, dir)
}

func TestUndoRun_RefusesToMoveRefRecreatedOutsideApp(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"tagDelete", "branchDelete"} {
		t.Run(kind, func(t *testing.T) {
			t.Parallel()
			dir, entry := initUndoGuardRepo(t)
			ref := "refs/tags/v1"
			if kind == "branchDelete" {
				ref = "refs/heads/feature"
			}
			runGitQ(t, dir, "update-ref", ref, "HEAD")
			ctx := context.Background()
			op := OpRequest{Kind: kind, Name: strings.TrimPrefix(strings.TrimPrefix(ref, "refs/tags/"), "refs/heads/")}
			res, err := entry.RunOp(ctx, ConnID("c"), "t", op)
			if err != nil || !res.OK || res.Undo == nil {
				t.Fatalf("RunOp = %+v, %v", res, err)
			}
			if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("two\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			runGitQ(t, dir, "commit", "-aqm", "second")
			newer := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
			runGitQ(t, dir, "update-ref", ref, newer)

			undo, err := entry.UndoRun(ctx, "t", res.Undo.ID)
			if err != nil {
				t.Fatalf("UndoRun: %v", err)
			}
			if undo.OK {
				t.Fatal("undo moved a ref recreated outside the app")
			}
			if got := strings.TrimSpace(runOutput(t, dir, "rev-parse", ref)); got != newer {
				t.Fatalf("%s = %s, want untouched %s", ref, got, newer)
			}
		})
	}
}

func TestUndoRun_HardResetUndoKeepsEditsMadeSince(t *testing.T) {
	t.Parallel()
	dir, entry := initUndoGuardRepo(t)
	prev := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitQ(t, dir, "commit", "-aqm", "second")
	tip := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD"))
	ctx := context.Background()
	res, err := entry.RunOp(ctx, ConnID("c"), "t", OpRequest{Kind: "reset", Mode: "hard", Target: prev})
	if err != nil || !res.OK || res.Undo == nil {
		t.Fatalf("RunOp = %+v, %v", res, err)
	}
	edit := []byte("edited after reset\n")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), edit, 0o644); err != nil {
		t.Fatal(err)
	}
	undo, err := entry.UndoRun(ctx, "t", res.Undo.ID)
	if err != nil {
		t.Fatalf("UndoRun: %v", err)
	}
	if undo.OK {
		t.Fatal("hard-reset undo overwrote local edits")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "f.txt")); string(got) != string(edit) {
		t.Fatalf("f.txt = %q, want edits kept", got)
	}
	if head := strings.TrimSpace(runOutput(t, dir, "rev-parse", "HEAD")); head != prev {
		t.Fatalf("HEAD = %s, want unchanged %s", head, prev)
	}

	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err = entry.RunOp(ctx, ConnID("c"), "t", OpRequest{Kind: "reset", Mode: "hard", Target: tip})
	if err != nil || !res.OK || res.Undo == nil {
		t.Fatalf("RunOp = %+v, %v", res, err)
	}
	undo, err = entry.UndoRun(ctx, "t", res.Undo.ID)
	if err != nil || !undo.OK {
		t.Fatalf("clean-tree undo = %+v, %v", undo, err)
	}
}

func TestPrepareBranchCreate_TrackBuildsSetUpstreamAndRejectsDash(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	track := "origin/main"
	for _, checkout := range []bool{false, true} {
		prep, err := prepareBranchCreate(ctx, nil, "c", "t", OpRequest{Name: "nb", StartPoint: "main", Checkout: checkout, Track: &track})
		if err != nil {
			t.Fatal(err)
		}
		if len(prep.argvList) != 2 || strings.Join(prep.argvList[1], " ") != "branch --set-upstream-to=origin/main nb" {
			t.Fatalf("checkout=%v argvList = %v", checkout, prep.argvList)
		}
		for _, a := range prep.argvList[0] {
			if a == "-t" {
				t.Fatalf("create argv carries -t: %v", prep.argvList[0])
			}
		}
	}
	bad := "-D"
	_, err := prepareBranchCreate(ctx, nil, "c", "t", OpRequest{Name: "main", StartPoint: "release", Track: &bad})
	if !errors.Is(err, ErrInvalidOpArg) {
		t.Fatalf("err = %v, want ErrInvalidOpArg", err)
	}
}
