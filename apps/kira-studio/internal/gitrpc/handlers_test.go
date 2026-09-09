package gitrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// recordingLocator is a gitclient.Locator fake that records every configuredPath it was asked to
// resolve — this test's only interest is proving that value reached Discovery.Status at all, not
// what a real probe would do with it, so it always reports "not found" (the cheapest honest
// answer that still exercises probe()'s own configuredPath argument, discovery.go:249).
type recordingLocator struct {
	got []string
}

func (r *recordingLocator) Locate(configuredPath string) (string, []string, bool) {
	r.got = append(r.got, configuredPath)
	return "", nil, false
}

// TestHandleAppInit_UsesConfiguredGitPath is G18 §3.19's own regression guard for D15: app.init's
// `git` field must be resolved against a real, configured git.path — via Registry.Settings' own
// widened three-value closure — rather than always calling Discovery.Status(ctx, "").
func TestHandleAppInit_UsesConfiguredGitPath(t *testing.T) {
	loc := &recordingLocator{}
	discovery := gitclient.NewDiscovery(loc, nil, gitclient.NewRealClock())

	reg := gitsession.NewRegistry(nil)
	reg.Settings = func() ([]string, int, string) { return nil, 0, "/opt/configured/git" }

	router := New(Deps{Discovery: discovery, Registry: reg, ServerVersion: "test"})
	result := router.handleAppInit(context.Background())

	if len(loc.got) != 1 || loc.got[0] != "/opt/configured/git" {
		t.Fatalf("Discovery.Status was resolved against %v, want exactly [\"/opt/configured/git\"]", loc.got)
	}
	if result.Git.Kind != "notFound" {
		t.Fatalf("Git.Kind = %q, want %q (recordingLocator always reports not found)", result.Git.Kind, "notFound")
	}
}

// TestHandleRepoOpen_UsesConfiguredGitPath is the same guard for repo.open's own Discovery.Status
// call site (handlers.go:196).
func TestHandleRepoOpen_UsesConfiguredGitPath(t *testing.T) {
	loc := &recordingLocator{}
	discovery := gitclient.NewDiscovery(loc, nil, gitclient.NewRealClock())

	reg := gitsession.NewRegistry(nil)
	reg.Settings = func() ([]string, int, string) { return nil, 0, "/opt/configured/git" }

	router := New(Deps{Discovery: discovery, Registry: reg, ServerVersion: "test"})
	conn := gitsession.NewConn("conn-1", "client-1", "label", nil)
	t.Cleanup(conn.Close)

	result, err := router.handleRepoOpen(context.Background(), conn, []byte(`{"path":"/tmp/some/repo"}`))
	if err != nil {
		t.Fatalf("handleRepoOpen: %v", err)
	}
	opened, ok := result.(RepoOpenResult)
	if !ok {
		t.Fatalf("handleRepoOpen result = %T, want RepoOpenResult", result)
	}
	if opened.Kind != "gitUnavailable" || opened.Git == nil || opened.Git.Kind != "notFound" {
		t.Fatalf("handleRepoOpen result = %+v, want gitUnavailable/notFound", opened)
	}
	if len(loc.got) != 1 || loc.got[0] != "/opt/configured/git" {
		t.Fatalf("Discovery.Status was resolved against %v, want exactly [\"/opt/configured/git\"]", loc.got)
	}
}

// --- G27 D6: entryFor/repo.open round-trip across a non-ASCII repository path -------------------
//
// Both cases below are the mirror pair the plan's exit criterion (§7.1 item 10) asks for, and both
// use a FAKE runner (D12's own instruction for this exact test) rather than a real repository:
// this container's own filesystem is byte-transparent (P1) and would make a REAL directory named
// with decomposed bytes simply not exist under the composed spelling handleRepoOpen's own p.Path
// normalization (D5d) produces — a limitation of this container, not of the fix, and exactly the
// gap D12 exists to route around. A scripted runner's canned rev-parse/worktree-list output is
// read regardless of Spec.Dir, so it exercises Identify's own composition (D5a) and entryFor's
// (D6) without ever touching a disk.

// handlersScriptedProcess is a canned-bytes gitclient.Process — Run(ctx, r, ...) drains it exactly
// like a real spawn.
type handlersScriptedProcess struct{ result gitclient.Result }

func (p *handlersScriptedProcess) Stdout() io.ReadCloser {
	return io.NopCloser(bytes.NewReader(p.result.Stdout))
}
func (p *handlersScriptedProcess) Stdin() io.WriteCloser { return nil }
func (p *handlersScriptedProcess) Wait() (gitclient.Result, error) {
	return gitclient.Result{Stderr: p.result.Stderr, ExitCode: p.result.ExitCode}, nil
}
func (p *handlersScriptedProcess) Close() error { return nil }

// handlersScriptedRunner scripts a canned gitclient.Result per invocation, keyed on the joined
// Args — Identify alone makes five distinct calls in sequence (is-bare-repository, the two
// absolute-dir queries, show-toplevel, and ResolveHead's own symbolic-ref/rev-parse pair), each
// needing different output; worktree.list needs a sixth. Spec.Dir is never consulted: exactly the
// property that lets this test use non-ASCII bytes with no real directory behind them (D12).
type handlersScriptedRunner struct {
	byArgs map[string]gitclient.Result
}

func (r *handlersScriptedRunner) Start(_ context.Context, _ string, spec gitclient.Spec) (gitclient.Process, error) {
	key := strings.Join(spec.Args, " ")
	res, ok := r.byArgs[key]
	if !ok {
		return nil, fmt.Errorf("handlersScriptedRunner: no scripted result for %q", key)
	}
	return &handlersScriptedProcess{result: res}, nil
}

// handlersFakeWatcher is a Watcher that never fires — registry_test.go's own fakeWatcher shape,
// reproduced locally since gitrpc's tests need a Registry.NewWatcher override too and gitsession's
// unexported fixture is not reachable from this package.
type handlersFakeWatcher struct {
	sig chan gitclient.Signal
}

func newHandlersFakeWatcher() *handlersFakeWatcher {
	return &handlersFakeWatcher{sig: make(chan gitclient.Signal)}
}
func (w *handlersFakeWatcher) Signals() <-chan gitclient.Signal { return w.sig }
func (w *handlersFakeWatcher) Close() error                     { close(w.sig); return nil }

// scriptedIdentify builds the byArgs map every case below shares: is-bare-repository=false, HEAD
// on branch "main", and gitDir/commonDir/root all equal to root (a main, non-linked worktree) —
// spelled however the caller wants (composed or decomposed).
func scriptedIdentify(root string) map[string]gitclient.Result {
	return map[string]gitclient.Result{
		"--version":                      {Stdout: []byte("git version 2.43.0\n")},
		"rev-parse --is-bare-repository": {Stdout: []byte("false\n")},
		"rev-parse --path-format=absolute --absolute-git-dir": {Stdout: []byte(root + "/.git\n")},
		"rev-parse --path-format=absolute --git-common-dir":   {Stdout: []byte(root + "/.git\n")},
		"rev-parse --show-toplevel":                           {Stdout: []byte(root + "\n")},
		"symbolic-ref --short -q HEAD":                        {Stdout: []byte("main\n"), ExitCode: 0},
		"rev-parse -q --verify HEAD":                          {Stdout: []byte(strings.Repeat("a", 40) + "\n"), ExitCode: 0},
		"worktree list --porcelain -z":                        {Stdout: []byte("worktree " + root + "\x00HEAD " + strings.Repeat("a", 40) + "\x00branch refs/heads/main\x00\x00")},
	}
}

func newHandlersScriptedRouter(byArgs map[string]gitclient.Result) (*Router, *gitsession.Conn, Handlers) {
	runner := &handlersScriptedRunner{byArgs: byArgs}
	registry := gitsession.NewRegistry(runner)
	registry.NewWatcher = func(gitclient.RepoSummary) (gitsession.Watcher, error) {
		return newHandlersFakeWatcher(), nil
	}
	discovery := gitclient.NewDiscovery(alwaysGitLocator{}, runner, gitclient.NewRealClock())
	router := New(Deps{Discovery: discovery, Runner: runner, Registry: registry, ServerVersion: "test"})
	conn := gitsession.NewConn(gitsession.ConnID("g27-roundtrip-conn"), "test-client", "test-label", nil)
	return router, conn, router.ForConn(conn)
}

// TestRepoOpen_DecomposedIdentifyOutputThenComposedRepoIDResolves scripts Identify's own
// rev-parse output as decomposed — exactly what an NFD-producing filesystem's readdir could hand
// git before D3's core.precomposeunicode=true, or what git's own worktree registry could report —
// and proves handleRepoOpen (D5a via Identify) hands back a composed RepoID, and that a follow-up
// request using exactly that composed RepoID resolves.
func TestRepoOpen_DecomposedIdentifyOutputThenComposedRepoIDResolves(t *testing.T) {
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	composedE := string([]byte{0xc3, 0xa9})         // U+00E9, composed "é"
	decomposedRoot := "/repo/caf" + decomposedE

	router, conn, handlers := newHandlersScriptedRouter(scriptedIdentify(decomposedRoot))
	t.Cleanup(conn.Close)
	ctx := context.Background()

	openParams, err := json.Marshal(map[string]string{"path": decomposedRoot})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	result, err := router.handleRepoOpen(ctx, conn, openParams)
	if err != nil {
		t.Fatalf("handleRepoOpen: %v", err)
	}
	opened, ok := result.(RepoOpenResult)
	if !ok || opened.Kind != "ok" || opened.Repo == nil {
		t.Fatalf("handleRepoOpen result = %+v, want kind=ok", result)
	}
	if !strings.Contains(opened.Repo.RepoID, composedE) || strings.Contains(opened.Repo.RepoID, decomposedE) {
		t.Fatalf("RepoID = %q, want the composed spelling, not the decomposed one Identify was scripted with", opened.Repo.RepoID)
	}

	listParams, err := json.Marshal(map[string]string{"repoId": opened.Repo.RepoID})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := handlers.Request(ctx, "worktree.list", listParams); err != nil {
		t.Fatalf("worktree.list with the composed RepoID the open result carried: %v", err)
	}
}

// TestRepoOpen_ComposedIdentifyOutputThenDecomposedRepoIDStillResolves is the mirror: Identify's
// own output is already composed (RepoID comes back composed, trivially), but a follow-up request
// spells repoId with decomposed bytes — entryFor's own D6 normalization is what makes this
// resolve.
func TestRepoOpen_ComposedIdentifyOutputThenDecomposedRepoIDStillResolves(t *testing.T) {
	decomposedE := string([]byte{0x65, 0xcc, 0x81}) // "e" + U+0301, decomposed "é"
	composedE := string([]byte{0xc3, 0xa9})         // U+00E9, composed "é"
	composedRoot := "/repo/caf" + composedE

	router, conn, handlers := newHandlersScriptedRouter(scriptedIdentify(composedRoot))
	t.Cleanup(conn.Close)
	ctx := context.Background()

	openParams, err := json.Marshal(map[string]string{"path": composedRoot})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	result, err := router.handleRepoOpen(ctx, conn, openParams)
	if err != nil {
		t.Fatalf("handleRepoOpen: %v", err)
	}
	opened, ok := result.(RepoOpenResult)
	if !ok || opened.Kind != "ok" || opened.Repo == nil {
		t.Fatalf("handleRepoOpen result = %+v, want kind=ok", result)
	}
	if !strings.Contains(opened.Repo.RepoID, composedE) {
		t.Fatalf("RepoID = %q, want the composed spelling", opened.Repo.RepoID)
	}

	// A stale/un-normalized repoId spelling of the exact same repository — this is purely what
	// entryFor's gitpath.CleanNFC call is for (D6/F6).
	decomposedRepoID := strings.Replace(opened.Repo.RepoID, composedE, decomposedE, 1)
	listParams, err := json.Marshal(map[string]string{"repoId": decomposedRepoID})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := handlers.Request(ctx, "worktree.list", listParams); err != nil {
		t.Fatalf("worktree.list with a decomposed spelling of the RepoID: %v", err)
	}
}
