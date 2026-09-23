package gitsession

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// initPreflightTestRepo builds a one-commit repo suitable for every F1 (P108 Part 16 review)
// regression test below: real git 2.43 probes confirmed a client-supplied value reaching an
// unvalidated argv position (e.g. `--output=<path>`) writes or truncates an arbitrary file —
// these tests confirm the guard rejects that value before any such spawn runs.
func initPreflightTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGitQ(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "add", "a.txt")
	runGitQ(t, dir, "commit", "-q", "-m", "base")
	return dir
}

// assertNoCanary confirms the malicious `--output=` argument never reached a real git spawn: no
// file named canary was written anywhere a plausible `--output=<path>` could have landed (repo
// root, since every gitclient.Run defaults its cwd there).
func assertNoCanary(t *testing.T, dir string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(dir, "canary")); !os.IsNotExist(err) {
		t.Fatalf("canary file exists (or Stat errored unexpectedly): %v", err)
	}
}

func TestPreflightCheckoutRejectsFlagLikeTarget(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initPreflightTestRepo(t)
	entry := newQueriesTestEntry(t, dir)

	_, err := entry.PreflightCheckout(context.Background(), "--output=canary", "switch")
	if err == nil {
		t.Fatal("PreflightCheckout: expected an error for a flag-like target, got nil")
	}
	if !errors.Is(err, ErrInvalidOpArg) {
		t.Fatalf("PreflightCheckout: expected ErrInvalidOpArg, got: %v", err)
	}
	assertNoCanary(t, dir)
}

func TestPreflightRevertRejectsFlagLikeSha(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initPreflightTestRepo(t)
	entry := newQueriesTestEntry(t, dir)

	_, err := entry.PreflightRevert(context.Background(), []string{"--output=canary"}, nil)
	if err == nil {
		t.Fatal("PreflightRevert: expected an error for a flag-like sha, got nil")
	}
	if !errors.Is(err, ErrInvalidOpArg) {
		t.Fatalf("PreflightRevert: expected ErrInvalidOpArg, got: %v", err)
	}
	assertNoCanary(t, dir)
}

func TestPreflightCherryPickRejectsFlagLikeSha(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initPreflightTestRepo(t)
	entry := newQueriesTestEntry(t, dir)

	_, err := entry.PreflightCherryPick(context.Background(), "--output=canary", nil)
	if err == nil {
		t.Fatal("PreflightCherryPick: expected an error for a flag-like sha, got nil")
	}
	if !errors.Is(err, ErrInvalidOpArg) {
		t.Fatalf("PreflightCherryPick: expected ErrInvalidOpArg, got: %v", err)
	}
	assertNoCanary(t, dir)
}

func TestPreflightStashPopRejectsFlagLikeTargetSha(t *testing.T) {
	skipWithoutGitQueries(t)
	dir := initPreflightTestRepo(t)
	entry := newQueriesTestEntry(t, dir)

	// A real stash entry so resolveStashEntryScoped succeeds and the guard under test
	// (targetSha) is the one actually exercised, not an earlier "no such stash" refusal.
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("two\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitQ(t, dir, "stash", "push", "-q", "-m", "wip")
	sha := trimTrailingNL(runOutput(t, dir, "rev-parse", "refs/stash"))

	malicious := "--output=canary"
	_, err := entry.PreflightStashPop(context.Background(), sha, &malicious, "")
	if err == nil {
		t.Fatal("PreflightStashPop: expected an error for a flag-like targetSha, got nil")
	}
	if !errors.Is(err, ErrInvalidOpArg) {
		t.Fatalf("PreflightStashPop: expected ErrInvalidOpArg, got: %v", err)
	}
	assertNoCanary(t, dir)
}
