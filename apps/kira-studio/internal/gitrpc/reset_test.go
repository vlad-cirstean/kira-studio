package gitrpc

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
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

// TestRunOpReset_RejectsInvalidMode is G30 round-1 architecture/security review, finding #5:
// op.run's own write path never validated op.mode the way preflight.reset does, so a mode of
// "keep" (reserved for the undo replay's own ResetKeepArgs — never a user-selectable mode) or any
// other non-soft/mixed/hard spelling reached `git reset --<mode>` verbatim. Proves it is now
// refused before any spawn, with HEAD left untouched.
func TestRunOpReset_RejectsInvalidMode(t *testing.T) {
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
	headBefore, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("rev-parse HEAD: %v", err)
	}

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	for _, mode := range []string{"keep", "--soft", ""} {
		opParams, _ := json.Marshal(map[string]any{
			"repoId": repoID,
			"op":     map[string]any{"kind": "reset", "mode": mode, "target": "HEAD~1"},
		})
		if _, err := handlers.Request(ctx, "op.run", opParams); err == nil {
			t.Fatalf("op.run with mode %q: want an error, got nil", mode)
		}
	}

	headAfter, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("rev-parse HEAD: %v", err)
	}
	if string(headBefore) != string(headAfter) {
		t.Fatalf("HEAD moved despite every reset being rejected: before=%q after=%q", headBefore, headAfter)
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

// TestPreflightReset_RejectsOptionInjectingTargetPreventsArbitraryFileWrite and
// TestOpRunReset_RejectsOptionInjectingTargetPreventsArbitraryFileWrite are G32 round-3
// architecture/security review, finding #4's own regression proof. Both preflight.reset and
// op.run(reset) resolve their own target through gitsession's shared resolveCommit, which runs
// `git show -s --decorate=full -z --format=<fmt> <target>` — target reaches that argv as a bare,
// unguarded token. Confirmed empirically against a real git: `--output=<path>` is honoured there
// exactly like any other `git show` invocation, writing the command's own output to an
// attacker-chosen path — a real arbitrary-file-write primitive, not a hypothetical one. Both tests
// prove the canary file is never created and the request is refused before any git process for
// that argv is spawned.
func TestPreflightReset_RejectsOptionInjectingTargetPreventsArbitraryFileWrite(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	resetSmokeGit(t, dir, "commit", "-q", "--allow-empty", "-m", "base")

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	canary := filepath.Join(t.TempDir(), "pwned-preflight-reset")
	maliciousTarget := "--output=" + canary

	resetParams, _ := json.Marshal(PreflightResetParams{RepoID: repoID, Target: maliciousTarget, Mode: "mixed"})
	preflightAny, err := handlers.Request(ctx, "preflight.reset", resetParams)
	if err != nil {
		t.Fatalf("preflight.reset: %v", err)
	}
	preflight, ok := preflightAny.(gitpreflight.ResetPreflight)
	if !ok {
		t.Fatalf("preflight.reset result = %T, want gitpreflight.ResetPreflight", preflightAny)
	}
	unknownTarget := false
	for _, b := range preflight.Blockers {
		if b == "unknownTarget" {
			unknownTarget = true
		}
	}
	if preflight.Verdict != "blocked" || !unknownTarget {
		t.Fatalf("preflight.reset treated an option-injecting target as resolvable: %+v", preflight)
	}
	if _, statErr := os.Stat(canary); statErr == nil {
		t.Fatalf("preflight.reset: canary file %s was created — --output= reached a real git show", canary)
	}
}

func TestOpRunReset_RejectsOptionInjectingTargetPreventsArbitraryFileWrite(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	resetSmokeGit(t, dir, "commit", "-q", "--allow-empty", "-m", "base")
	headBefore, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("rev-parse HEAD: %v", err)
	}

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	canary := filepath.Join(t.TempDir(), "pwned-op-run-reset")
	maliciousTarget := "--output=" + canary

	opParams, _ := json.Marshal(map[string]any{
		"repoId": repoID,
		"op":     map[string]any{"kind": "reset", "mode": "mixed", "target": maliciousTarget},
	})
	opAny, err := handlers.Request(ctx, "op.run", opParams)
	if err != nil {
		t.Fatalf("op.run: %v", err)
	}
	opRes, ok := opAny.(gitsession.OpResult)
	if !ok || opRes.OK || opRes.Error == nil || opRes.Error.Kind != "NotFound" {
		t.Fatalf("op.run result = %+v, want ok=false error.kind=NotFound (target does not resolve)", opAny)
	}

	if _, statErr := os.Stat(canary); statErr == nil {
		t.Fatalf("op.run reset: canary file %s was created — --output= reached a real git show", canary)
	}
	headAfter, err := exec.Command("git", "-C", dir, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatalf("rev-parse HEAD: %v", err)
	}
	if string(headBefore) != string(headAfter) {
		t.Fatalf("HEAD moved despite the reset being refused: before=%q after=%q", headBefore, headAfter)
	}
}

// TestOpRunCherryPick_RejectsOptionInjectingSha is the same finding's proof for a field with no
// resolveCommit step of its own: cherryPick's sha reaches gitops.CherryPickArgs directly. Proves
// the request is refused with validOpArg's own message and CHERRY_PICK_HEAD is never created.
func TestOpRunCherryPick_RejectsOptionInjectingSha(t *testing.T) {
	dir := t.TempDir()
	resetSmokeGit(t, dir, "init", "-q", "-b", "main")
	resetSmokeGit(t, dir, "commit", "-q", "--allow-empty", "-m", "base")

	handlers, repoID := resetSmokeConn(t, dir)
	ctx := context.Background()

	opParams, _ := json.Marshal(map[string]any{
		"repoId": repoID,
		"op":     map[string]any{"kind": "cherryPick", "sha": "--no-commit"},
	})
	_, err := handlers.Request(ctx, "op.run", opParams)
	if err == nil {
		t.Fatal("op.run cherryPick: expected an error for an option-injecting sha, got nil")
	}
	if !strings.Contains(err.Error(), "must not be empty or begin with '-'") {
		t.Fatalf("op.run cherryPick: expected a validOpArg rejection, got: %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, ".git", "CHERRY_PICK_HEAD")); statErr == nil {
		t.Fatal("op.run cherryPick: CHERRY_PICK_HEAD exists — the malicious sha reached a real spawn")
	}
}
