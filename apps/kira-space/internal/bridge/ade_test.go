package bridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// recordingEmitter is a test double for appevent.Emitter — every Emit/EmitTo/EmitFocused call is
// recorded verbatim (channel plus the JSON-marshalled payload), so a test can assert both which
// channels fired and that no payload ever carries a hook token.
type recordingEmitter struct {
	mu    sync.Mutex
	calls []recordedEmit
}

type recordedEmit struct {
	channel string
	payload string
}

func (e *recordingEmitter) record(channel string, data any) {
	b, err := json.Marshal(data)
	payload := ""
	if err == nil {
		payload = string(b)
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls = append(e.calls, recordedEmit{channel: channel, payload: payload})
}

func (e *recordingEmitter) Emit(name string, data any)             { e.record(name, data) }
func (e *recordingEmitter) EmitTo(_ string, name string, data any) { e.record(name, data) }
func (e *recordingEmitter) EmitFocused(name string, data any)      { e.record(name, data) }

func (e *recordingEmitter) channels() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]string, len(e.calls))
	for i, c := range e.calls {
		out[i] = c.channel
	}
	return out
}

func (e *recordingEmitter) containsAny(needle string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, c := range e.calls {
		if strings.Contains(c.payload, needle) {
			return true
		}
	}
	return false
}

func containsChannel(channels []string, want string) bool {
	for _, c := range channels {
		if c == want {
			return true
		}
	}
	return false
}

// writeFakeClaude writes a POSIX sh script standing in for the real `claude` CLI: it reads
// --session-id/--resume's own value off argv, then curls SessionStart and Stop hook events
// directly at $KIRA_AGENT_HOOK_SOCKET — the same curl shape agenthooks' own shim.go uses — so this
// test exercises the real agenthooks HTTP listener end to end without a real model call. Returns
// the script's absolute path.
func writeFakeClaude(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "fake-claude")
	script := `#!/bin/sh
session_id=""
for arg in "$@"; do
  if [ "$prev" = "--session-id" ] || [ "$prev" = "--resume" ]; then
    session_id="$arg"
  fi
  prev="$arg"
done

post() {
  printf '{"hook_event_name":"%s","session_id":"%s","cwd":"/tmp"}' "$1" "$session_id" | \
    curl --silent --max-time 2 --output /dev/null \
      --unix-socket "$KIRA_AGENT_HOOK_SOCKET" \
      --header "Authorization: Bearer $KIRA_AGENT_HOOK_TOKEN" \
      --header "X-Kira-Terminal: $KIRA_TERMINAL_ID" \
      --header "Content-Type: application/json" \
      --data-binary @- \
      http://localhost/hook
}

post SessionStart
sleep 0.2
post Stop
exit 0
`
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	return path
}

func waitForAde(t *testing.T, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !cond() {
		t.Fatalf("condition not met within %s", timeout)
	}
}

// TestAdeService_SpawnTrackAndExit is P129 Part 1 §6.1's own integration test: a real
// terminal.Registry, a real agenthooks.Manager (real unix socket, real HTTP listener), a real
// ade.Tracker and a real AdeService, driving the exact launch flow §4.2 describes end to end — no
// prompt is submitted and no real Claude Code process ever runs (writeFakeClaude stands in for
// it), so this needs no display and makes no model call.
func TestAdeService_SpawnTrackAndExit(t *testing.T) {
	if _, err := os.Stat("/usr/bin/curl"); err != nil {
		if _, err := os.Stat("/usr/local/bin/curl"); err != nil {
			t.Skip("curl not found: agenthooks needs it (see internal/agenthooks's own New)")
		}
	}

	db, err := storage.OpenAt(t.TempDir())
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	cwd := t.TempDir()
	codeRepo, err := repositories.CodeRepos.Create(model.CodeRepo{ID: "cr1", Name: "n", Root: cwd, RepoID: "rid"})
	if err != nil {
		t.Fatalf("create code repo: %v", err)
	}

	emitter := &recordingEmitter{}
	events := NewEvents(emitter)

	var onEventMu sync.Mutex
	var tracker *ade.Tracker
	hooks := agenthooks.NewManager(agenthooks.Options{OnEvent: func(ev agenthooks.Event) {
		onEventMu.Lock()
		tr := tracker
		onEventMu.Unlock()
		if tr != nil {
			tr.HandleEvent(ev)
		}
		EmitAgentEvent(emitter, ev)
	}})
	if err := hooks.Start(); err != nil {
		t.Skipf("agent hooks did not start in this sandbox: %v", err)
	}
	t.Cleanup(func() { _ = hooks.Stop() })

	registry := terminal.NewRegistry()
	t.Cleanup(registry.CloseAll)

	fakeClaude := writeFakeClaude(t)
	tr := ade.NewTracker(ade.TrackerDeps{
		Store: repositories.AdeSessions, LiveAgents: registry.AgentSessions, WriteTerminal: registry.Write,
		Now: time.Now, OnChange: func() { AdeSessionsChanged(events) }, ClaudeBin: fakeClaude,
		// A short but real Grace: Reconcile only stops a record once this elapses (tracker.go's own
		// Compose/Reconcile), and this test uses a real time.AfterFunc, not tracker_test.go's fake
		// clock — the default 30s production Grace would make this integration test needlessly slow.
		Grace: 200 * time.Millisecond,
	})
	onEventMu.Lock()
	tracker = tr
	onEventMu.Unlock()
	tr.SetHooks(hooks.ComposeLaunch)

	boundSvc := &terminal.BoundService{Emit: emitter, Registry: registry, ComposeAgent: tr.Compose}
	deps := appcore.Deps{Repos: repositories, Events: emitter}
	adeSvc := &AdeService{Deps: deps, Tracker: tr, Registry: registry}
	registry.OnChange = func() {
		tr.Reconcile()
		AgentSessionsChanged(emitter, registry)
	}

	prep, err := adeSvc.PrepareLaunch(AdePrepareLaunchArgs{CodeRepoID: codeRepo.ID, Branch: "main", Cwd: cwd})
	if err != nil {
		t.Fatalf("PrepareLaunch: %v", err)
	}
	if prep.TerminalID == "" || prep.SessionID == "" || prep.Command == "" {
		t.Fatalf("PrepareLaunch result = %+v, want every field set", prep)
	}

	openRes, err := boundSvc.Open(terminal.OpenArgs{
		TerminalID: prep.TerminalID, WindowKey: "w1", Cwd: cwd, Cols: 80, Rows: 24,
		Command: prep.Command, LaunchKind: terminal.LaunchKindClaudeCode,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if openRes.Shell == "" {
		t.Fatalf("Open result shell = %q, want non-empty", openRes.Shell)
	}

	// SessionStart arrives with the prepared Claude session id, and the record reads running.
	waitForAde(t, 5*time.Second, func() bool {
		res, err := adeSvc.Sessions()
		if err != nil || len(res.Sessions) != 1 {
			return false
		}
		return res.Sessions[0].State == model.AdeSessionStateRunning && res.Sessions[0].ClaudeSessionID == prep.SessionID
	})

	// The fake CLI exits after its own Stop post; Reconcile (driven by Registry.OnChange on the
	// PTY's own exit) must flip the record to stopped.
	waitForAde(t, 5*time.Second, func() bool {
		res, err := adeSvc.Sessions()
		if err != nil || len(res.Sessions) != 1 {
			return false
		}
		return res.Sessions[0].State == model.AdeSessionStateStopped
	})

	channels := emitter.channels()
	if !containsChannel(channels, ChannelAgentEvent) {
		t.Fatalf("channels = %v, want %s emitted", channels, ChannelAgentEvent)
	}
	if !containsChannel(channels, ChannelAgentSessions) {
		t.Fatalf("channels = %v, want %s emitted", channels, ChannelAgentSessions)
	}
	if !containsChannel(channels, ChannelAdeSessions) {
		t.Fatalf("channels = %v, want %s emitted", channels, ChannelAdeSessions)
	}

	// The token must never appear in any emitted payload, nor in either bound result.
	_, tokenEnv := hooks.ComposeLaunch("sample-terminal", "sample-command")
	var token string
	for _, kv := range tokenEnv {
		if strings.HasPrefix(kv, "KIRA_AGENT_HOOK_TOKEN=") {
			token = strings.TrimPrefix(kv, "KIRA_AGENT_HOOK_TOKEN=")
		}
	}
	if token == "" {
		t.Fatalf("could not sample a hook token from ComposeLaunch")
	}
	if emitter.containsAny(token) {
		t.Fatalf("a hook token appeared in an emitted payload")
	}
	prepJSON, _ := json.Marshal(prep)
	openJSON, _ := json.Marshal(openRes)
	if strings.Contains(string(prepJSON), token) || strings.Contains(string(openJSON), token) {
		t.Fatalf("a hook token appeared in a bound result")
	}
}
