package gitflow_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// rig is one booted app plus one git stream connection, default settings.
type rig struct {
	t   *testing.T
	app *flowharness.App
	gs  *flowharness.GitStream
}

func newRig(t *testing.T, opts ...flowharness.Opt) *rig {
	t.Helper()
	app := flowharness.New(t, opts...)
	return &rig{t: t, app: app, gs: app.OpenGitStream()}
}

// call sends a request and decodes the result, failing the test on a wire error.
func call[T any](t *testing.T, gs *flowharness.GitStream, method string, params any) T {
	t.Helper()
	var out T
	gs.MustRequest(method, params, &out)
	return out
}

func (r *rig) open(dir string) gitclient.RepoSummary {
	r.t.Helper()
	return openOn(r.t, r.gs, dir)
}

func openOn(t *testing.T, gs *flowharness.GitStream, dir string) gitclient.RepoSummary {
	t.Helper()
	res := call[gitrpc.RepoOpenResult](t, gs, "repo.open", gitrpc.RepoOpenParams{Path: dir})
	if res.Kind != "ok" || res.Repo == nil {
		t.Fatalf("repo.open %s = %+v, want ok", dir, res)
	}
	return *res.Repo
}

type m = map[string]any

func (r *rig) setSettings(id string, patch gitrpc.RepoSettingsPatchWire) gitrpc.RepoSettingsSnapshot {
	r.t.Helper()
	return call[gitrpc.RepoSettingsSnapshot](r.t, r.gs, "repoSettings.set", gitrpc.RepoSettingsSetParams{RepoID: id, Patch: patch})
}

// graphAll pages the graph to the end the way the UI does: graph.stream, then graph.loadMore
// followed by a graph.stream resumed through the rows already held. It returns every row in order.
func graphAll(t *testing.T, gs *flowharness.GitStream, repoID string, credit int) []flowharness.GraphRow {
	t.Helper()
	var rows []flowharness.GraphRow
	var last flowharness.GraphMeta
	pull := func() {
		params := m{"repoId": repoID}
		if len(rows) > 0 {
			params["resumeThroughRow"] = len(rows)
		}
		for _, c := range gs.Stream("graph.stream", params, credit).Drain() {
			meta, got := c.Graph(t)
			if meta.From != len(rows) {
				t.Fatalf("chunk from=%d, want %d (rows held)", meta.From, len(rows))
			}
			rows = append(rows, got...)
			last = meta
		}
	}
	pull()
	for guard := 0; !last.Exhausted; guard++ {
		if guard > 10000 {
			t.Fatal("graph paging did not terminate")
		}
		res := call[gitrpc.GraphLoadMoreResult](t, gs, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: repoID})
		if !res.Started {
			t.Fatalf("graph.loadMore not started at %d rows, exhausted=false", len(rows))
		}
		pull()
	}
	return rows
}

func shas(rows []flowharness.GraphRow) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.Sha
	}
	return out
}

func lines(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "\n")
}

const wait = 20 * time.Second

// wireErr sends a request expected to fail and returns the wire error.
func wireErr(t *testing.T, gs *flowharness.GitStream, method string, params any) *flowharness.WireError {
	t.Helper()
	err := gs.Request(method, params, nil)
	if err == nil {
		t.Fatalf("%s: want a wire error, got success", method)
	}
	we, ok := err.(*flowharness.WireError)
	if !ok {
		t.Fatalf("%s: error %v is not a wire error", method, err)
	}
	return we
}

func (r *rig) op(id string, op gitsession.OpRequest) gitsession.OpResult {
	r.t.Helper()
	return call[gitsession.OpResult](r.t, r.gs, "op.run", gitrpc.OpRunParams{RepoID: id, Op: op})
}

func (r *rig) mustOp(id string, op gitsession.OpRequest) gitsession.OpResult {
	r.t.Helper()
	res := r.op(id, op)
	if !res.OK {
		r.t.Fatalf("op.run %s failed: %+v", op.Kind, res.Error)
	}
	return res
}

func (r *rig) status(id string) gitpreflight.StatusSummary {
	r.t.Helper()
	return call[gitpreflight.StatusSummary](r.t, r.gs, "status.get", gitrpc.StatusGetParams{RepoID: id})
}

// external runs a change made outside the app and waits for the real watcher to announce it, the
// way the UI learns about it.
func (r *rig) external(fn func()) {
	r.t.Helper()
	before := len(r.gs.Events("repo.changed"))
	fn()
	testx.WaitUntil(r.t, wait, func() bool { return len(r.gs.Events("repo.changed")) > before })
}
func (r *rig) remote(id string, p gitsession.RemoteOpParams) gitsession.RemoteOpResult {
	r.t.Helper()
	return call[gitsession.RemoteOpResult](r.t, r.gs, "remote.run", gitrpc.RemoteRunParams{RepoID: id, RemoteOpParams: p})
}

func (r *rig) refs(id string) gitsession.RefsResult {
	r.t.Helper()
	return call[gitsession.RefsResult](r.t, r.gs, "refs.list", gitrpc.RefsListParams{RepoID: id})
}

// gitNow runs git with real commit dates. The harness pins old dates for reproducible shas, and
// --force-if-includes ignores reflog entries older than the remote-tracking ref's last update, so a
// rewrite that a force push must accept needs a current timestamp.
func gitNow(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test Author", "GIT_AUTHOR_EMAIL=author@example.com",
		"GIT_COMMITTER_NAME=Test Author", "GIT_COMMITTER_EMAIL=author@example.com")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

func bridgeOpsArgs(limit int) bridge.OpsRecentArgs { return bridge.OpsRecentArgs{Limit: limit} }

// refsChangedCount counts the refsChanged signals gs has received.
func refsChangedCount(gs *flowharness.GitStream) int {
	n := 0
	for _, e := range gs.Events("repo.changed") {
		var p struct {
			Kind string `json:"kind"`
		}
		if raw, ok := e.Data.(json.RawMessage); ok && json.Unmarshal(raw, &p) == nil && p.Kind == "refsChanged" {
			n++
		}
	}
	return n
}

// externalOn runs a change made outside the app and waits until every stream heard refsChanged.
func externalOn(t *testing.T, fn func(), streams ...*flowharness.GitStream) {
	t.Helper()
	before := make([]int, len(streams))
	for i, s := range streams {
		before[i] = refsChangedCount(s)
	}
	fn()
	for i, s := range streams {
		testx.WaitUntil(t, wait, func() bool { return refsChangedCount(s) > before[i] })
	}
}
