package repomap

import (
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeparse"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// firstText pulls the one TextContent out of a *mcp.CallToolResult — every result this package
// returns carries exactly one (tools.go's own textResult/errResult).
func firstText(res *mcp.CallToolResult) string {
	if res == nil || len(res.Content) == 0 {
		return ""
	}
	tc, ok := res.Content[0].(*mcp.TextContent)
	if !ok {
		return ""
	}
	return tc.Text
}

// newPickTestServer builds a bare Server with repos/order populated directly — pick (attach.go)
// only ever reads the map/order and each instance's own key/root, so a minimal repoInstance (no
// real index) is enough here; Attach's own full construction, and pick's Add(1)/Done() drain
// discipline, are covered by TestDetachDrainsInFlightCall below.
func newPickTestServer(keys ...string) *Server {
	s := &Server{repos: make(map[string]*repoInstance)}
	for _, k := range keys {
		inst := &repoInstance{key: k, repoID: "repo-id-" + k, root: "/repos/" + k}
		s.repos[k] = inst
		s.order = append(s.order, k)
	}
	return s
}

// TestPickRepo is P67d §3.4's own five-rule resolution order, in one table: a decision structure
// with several interacting rules, per CLAUDE.md's own bar for a dedicated test.
func TestPickRepo(t *testing.T) {
	cases := []struct {
		name       string
		keys       []string
		arg        string
		wantErr    bool
		wantErrHas string
		wantKey    string
	}{
		{
			name: "no repositories attached, no name given", keys: nil, arg: "",
			wantErr: true, wantErrHas: "no repositories are shared",
		},
		{
			name: "exactly one attached, no name given", keys: []string{"solo"}, arg: "",
			wantKey: "solo",
		},
		{
			name: "several attached, no name given", keys: []string{"a", "b"}, arg: "",
			wantErr: true, wantErrHas: "several repositories are attached",
		},
		{
			name: "exact key match", keys: []string{"a", "b"}, arg: "b",
			wantKey: "b",
		},
		{
			name: "case-insensitive key match", keys: []string{"MyRepo", "other"}, arg: "myrepo",
			wantKey: "MyRepo",
		},
		{
			name: "root path match", keys: []string{"a", "b"}, arg: "/repos/b",
			wantKey: "b",
		},
		{
			name: "no hit at all", keys: []string{"a", "b"}, arg: "nope",
			wantErr: true, wantErrHas: "no attached repository matches",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := newPickTestServer(c.keys...)
			inst, early := s.pick(c.arg)
			if c.wantErr {
				if early == nil {
					t.Fatalf("pick(%q) = an instance, want an error result", c.arg)
				}
				if !early.IsError {
					t.Fatalf("pick(%q) result is not IsError", c.arg)
				}
				if !strings.Contains(firstText(early), c.wantErrHas) {
					t.Fatalf("pick(%q) error = %q, want it to contain %q", c.arg, firstText(early), c.wantErrHas)
				}
				return
			}
			if early != nil {
				t.Fatalf("pick(%q) = error result %q, want a live instance", c.arg, firstText(early))
			}
			if inst == nil || inst.key != c.wantKey {
				t.Fatalf("pick(%q) resolved key = %+v, want %q", c.arg, inst, c.wantKey)
			}
			inst.inflight.Done() // balance pick's own Add(1) for this hit
		})
	}
}

// newDrainTestInstance builds one real repoInstance (a real codeindex.Index/codegraph.Graph over a
// real, seeded Store) without going through Attach — so the test controls exactly when (or whether)
// the readiness gate closes, the one thing TestDetachDrainsInFlightCall needs to control precisely.
func newDrainTestInstance(t *testing.T, repoID string) (*repoInstance, *codeindex.Store) {
	t.Helper()
	home := t.TempDir()
	root := t.TempDir()
	store := codeindex.OpenStoreAt(home)
	t.Cleanup(func() { _ = store.Close() })
	if err := store.ReplaceFile(context.Background(), codeindex.FileWrite{
		RepoID: repoID, Path: "main.go", Language: "go",
		ParseStatus: codeindex.StatusOK, ParsedAt: time.Now().UnixMilli(),
		ContentSHA: make([]byte, 32),
		Symbols:    []codeparse.Symbol{mkSym("function", "Main", 0, 0, 20, 5)},
	}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	idx := codeindex.Open(store, gitclient.NewExecRunner(), "", repoID, root)
	t.Cleanup(idx.Close)
	graph := codegraph.New(store, repoID)

	// syncDone pre-closed: this helper bypasses Attach's own `go inst.runInitialSync(...)` entirely,
	// so there is no such goroutine for close() (instance.go) to wait on — closing it here up front
	// is the same "nothing to run" case Attach's own discardUnregistered handles for a speculative
	// instance that lost its registration race.
	syncDone := make(chan struct{})
	close(syncDone)
	return &repoInstance{
		key: repoID, repoID: repoID, root: root,
		store: store, idx: idx, graph: graph, log: slog.Default(),
		ready: make(chan struct{}), done: make(chan struct{}), syncDone: syncDone, cancel: func() {},
	}, store
}

// TestDetachDrainsInFlightCall is P67d §3.3's own drain guarantee, proven under -race: (1) a call
// already resolved via pick, still doing real work against the graph when Detach runs, completes
// normally rather than racing a concurrent close; (2) a call that arrives after Detach's synchronous
// phase can never resolve the repository; (3) a call blocked inside waitReady wakes immediately once
// Detach revokes it, rather than only after the (much longer) readyTimeout.
func TestDetachDrainsInFlightCall(t *testing.T) {
	old := readyTimeout
	readyTimeout = time.Minute // large enough that a prompt wake can only come from done, not this
	defer func() { readyTimeout = old }()

	t.Run("a call already in flight completes against a live index", func(t *testing.T) {
		inst, _ := newDrainTestInstance(t, "drain-live")
		close(inst.ready) // already ready: SyncSettled() is closed by default (no Sync ever run)

		s := &Server{repos: map[string]*repoInstance{inst.key: inst}, order: []string{inst.key}}

		got, early := s.pick("")
		if early != nil {
			t.Fatalf("pick before Detach: unexpected error result %q", firstText(early))
		}
		if got != inst {
			t.Fatal("pick returned a different instance")
		}

		detachDone := make(chan struct{})
		go func() { s.Detach(inst.key); close(detachDone) }()
		<-detachDone // Detach's own map removal is synchronous — safe to rely on here.

		// A call arriving now can never resolve the repository, even though the call that already
		// holds `inst` (above) has not finished yet.
		if _, early := s.pick(""); early == nil || !strings.Contains(firstText(early), "no repositories are shared") {
			t.Fatalf("pick after Detach = %v, want the no-repositories error", early)
		}

		// The call still holding inst does real, live work — proving Detach did not close
		// anything out from under it while inflight was still held.
		targets, err := inst.graph.SearchSymbols(context.Background(), codegraph.SymbolSearch{Text: "Main", Limit: 10})
		if err != nil {
			t.Fatalf("SearchSymbols after Detach (still in flight) = %v, want it to still work", err)
		}
		if len(targets) != 1 || targets[0].Name != "Main" {
			t.Fatalf("SearchSymbols after Detach = %+v, want the seeded Main symbol", targets)
		}

		inst.inflight.Done() // the real handler shape: deferred right after pick resolved
	})

	t.Run("a call blocked in waitReady wakes promptly on revoke, not on readyTimeout", func(t *testing.T) {
		inst, _ := newDrainTestInstance(t, "drain-blocked")
		// inst.ready is deliberately never closed — this simulates a call still waiting on the
		// initial sync when Detach runs.

		s := &Server{repos: map[string]*repoInstance{inst.key: inst}, order: []string{inst.key}}

		got, early := s.pick("")
		if early != nil {
			t.Fatalf("pick before Detach: unexpected error result %q", firstText(early))
		}

		waitDone := make(chan error, 1)
		go func() {
			defer got.inflight.Done() // the real handler shape
			waitDone <- got.waitReady(context.Background())
		}()

		// Give the goroutine above a moment to actually be blocked inside waitReady before
		// revoking — avoids a false pass where Detach happens to run first.
		time.Sleep(20 * time.Millisecond)

		s.Detach(inst.key)

		select {
		case err := <-waitDone:
			if err == nil || !strings.Contains(err.Error(), "revoked") {
				t.Fatalf("waitReady during Detach = %v, want a \"revoked\" error", err)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("waitReady did not wake promptly on Detach — it is blocking on readyTimeout (1m) instead of done")
		}
	})
}
