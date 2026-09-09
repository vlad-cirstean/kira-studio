package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// These two tests are the manual smoke §6 step 6 asks for, kept as committed regression coverage
// (matching handlers_test.go's own convention) rather than a throwaway script: they exercise the
// real Router.ForConn dispatch — JSON decode through the wire.go param types, the two new switch
// cases in handlers.go, and op.run's existing generic dispatch — the one layer gitsession's own
// tests (which call RepoEntry methods directly) never touch. Conn.Open bypasses Discovery (D3:
// darwin-only, so a linux CI container would always see notFound regardless of a real git on
// PATH) with a raw gitPath, exactly as gitsession's own newQueriesTestEntry does.

func resetSmokeGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func resetSmokeConn(t *testing.T, dir string) (Handlers, string) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	runner := gitclient.NewExecRunner()
	registry := gitsession.NewRegistry(runner)
	t.Cleanup(registry.Close)
	router := New(Deps{Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("reset-rpc-test-conn"), "test-client", "test-label", nil)
	t.Cleanup(conn.Close)
	handlers := router.ForConn(conn)

	summary, err := conn.Open(context.Background(), registry, "git", dir)
	if err != nil {
		t.Fatalf("conn.Open: %v", err)
	}
	return handlers, summary.RepoID
}

var resetUndoLabelPattern = regexp.MustCompile(`^Reset \((soft|mixed|hard)\) to `)

// TestPreflightResetAndRunOpReset_OverDispatch exercises preflight.reset, op.run (kind reset) and
// undo.peek through the real JSON-decoding dispatch path (handlers.go's switch, wire.go's
// PreflightResetParams).
func TestPreflightResetAndRunOpReset_OverDispatch(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "commit", "-aqm", "second")

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	resetParams, _ := json.Marshal(PreflightResetParams{RepoID: repoID, Target: "HEAD~1", Mode: "mixed"})
	preflightAny, err := handlers.Request(ctx, "preflight.reset", resetParams)
	if err != nil {
		t.Fatalf("preflight.reset: %v", err)
	}
	preflight, ok := preflightAny.(gitpreflight.ResetPreflight)
	if !ok {
		t.Fatalf("preflight.reset result = %T, want gitpreflight.ResetPreflight", preflightAny)
	}
	if preflight.Verdict != "clean" || preflight.Leaving != 1 || preflight.TargetSubject != "base" {
		t.Fatalf("preflight.reset result = %+v, want verdict=clean leaving=1 targetSubject=base", preflight)
	}

	opParams, _ := json.Marshal(map[string]any{
		"repoId": repoID,
		"op":     map[string]any{"kind": "reset", "mode": "mixed", "target": "HEAD~1"},
	})
	opAny, err := handlers.Request(ctx, "op.run", opParams)
	if err != nil {
		t.Fatalf("op.run: %v", err)
	}
	opRes, ok := opAny.(gitsession.OpResult)
	if !ok || !opRes.OK {
		t.Fatalf("op.run result = %+v, want ok=true", opAny)
	}
	if opRes.Undo == nil || !resetUndoLabelPattern.MatchString(opRes.Undo.Label) {
		t.Fatalf("op.run undo = %+v, want a label matching %s", opRes.Undo, resetUndoLabelPattern)
	}

	peekParams, _ := json.Marshal(map[string]any{"repoId": repoID})
	peekAny, err := handlers.Request(ctx, "undo.peek", peekParams)
	if err != nil {
		t.Fatalf("undo.peek: %v", err)
	}
	peekRes, ok := peekAny.(UndoPeekResult)
	if !ok || peekRes.Slot == nil || !resetUndoLabelPattern.MatchString(peekRes.Slot.Label) {
		t.Fatalf("undo.peek result = %+v, want a slot with a matching label", peekAny)
	}
}

// TestPreflightCherryPickAndRunOpCherryPick_OverDispatch exercises preflight.cherryPick and op.run
// (kind cherryPick) through the same real dispatch path, ending in a real EmptyCherryPick — the
// wire.go PreflightCherryPickParams decode, the handlers.go switch case, and reclassifyCherryPick
// all proven together over JSON, not just at the RepoEntry level (which gitsession/ops_test.go
// already covers directly).
func TestPreflightCherryPickAndRunOpCherryPick_OverDispatch(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "add", "f.txt")
	resetSmokeGit(t, dir, "commit", "-q", "-m", "base")
	resetSmokeGit(t, dir, "branch", "topic")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nCHANGED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "commit", "-aqm", "change on main")
	resetSmokeGit(t, dir, "checkout", "-q", "topic")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("line1\nCHANGED\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	resetSmokeGit(t, dir, "commit", "-aqm", "same change on topic")
	topicOut, err := exec.Command("git", "-C", dir, "rev-parse", "topic").Output()
	if err != nil {
		t.Fatalf("rev-parse topic: %v", err)
	}
	topicSha := trimNLReset(string(topicOut))
	resetSmokeGit(t, dir, "checkout", "-q", "main")

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	cpParams, _ := json.Marshal(PreflightCherryPickParams{RepoID: repoID, SHA: topicSha})
	preflightAny, err := handlers.Request(ctx, "preflight.cherryPick", cpParams)
	if err != nil {
		t.Fatalf("preflight.cherryPick: %v", err)
	}
	preflight, ok := preflightAny.(gitpreflight.CherryPickPreflight)
	if !ok {
		t.Fatalf("preflight.cherryPick result = %T, want gitpreflight.CherryPickPreflight", preflightAny)
	}
	if preflight.Verdict != "clean" || preflight.AlreadyApplied {
		t.Fatalf("preflight.cherryPick result = %+v, want verdict=clean alreadyApplied=false", preflight)
	}

	opParams, _ := json.Marshal(map[string]any{
		"repoId": repoID,
		"op":     map[string]any{"kind": "cherryPick", "sha": topicSha},
	})
	opAny, err := handlers.Request(ctx, "op.run", opParams)
	if err != nil {
		t.Fatalf("op.run: %v", err)
	}
	opRes, ok := opAny.(gitsession.OpResult)
	if !ok || opRes.OK || opRes.Error == nil || opRes.Error.Kind != "EmptyCherryPick" {
		t.Fatalf("op.run result = %+v, want ok=false error.kind=EmptyCherryPick", opAny)
	}

	if _, statErr := os.Stat(filepath.Join(dir, ".git", "CHERRY_PICK_HEAD")); statErr != nil {
		t.Fatalf("CHERRY_PICK_HEAD missing after an empty-pick refusal: %v", statErr)
	}
}

func trimNLReset(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r') {
		s = s[:len(s)-1]
	}
	return s
}
