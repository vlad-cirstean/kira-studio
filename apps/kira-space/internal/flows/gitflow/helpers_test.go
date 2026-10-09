package gitflow_test

import (
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
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
