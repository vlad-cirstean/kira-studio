package gitflow_test

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/internal/testx"
)

// Guards wire encoding and decoration mapping of the first graph page against git log.
func TestGraphFirstPage(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 300, Branches: 6, MergeEvery: 7})
	repo.Tag("v1")
	repo.Git("tag", "-a", "-m", "annotated", "v2", "HEAD~3")
	bare := r.app.NewBare("remote")
	bare.PushFrom(repo)
	repo.Git("fetch", "-q", "origin")
	id := r.open(repo.Dir).RepoID

	page := 100
	r.setSettings(id, gitrpc.RepoSettingsPatchWire{GraphPageSize: &page})
	want := repo.RevList("--exclude=refs/kira/*", "--all", "--topo-order")
	var firstPage []flowharness.GraphRow
	for _, c := range r.gs.Stream("graph.stream", m{"repoId": id}, 1).Drain() {
		_, got := c.Graph(t)
		firstPage = append(firstPage, got...)
	}
	if strings.Join(shas(firstPage), "\n") != strings.Join(want[:page], "\n") {
		t.Fatalf("first page = %d rows, want the first %d of git rev-list", len(firstPage), page)
	}

	rows := graphAll(t, r.gs, id, 2)

	if got := shas(rows); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("graph shas differ from git rev-list: got %d rows, want %d", len(got), len(want))
	}
	parents := map[string]string{}
	for _, l := range lines(repo.Git("log", "--all", "--topo-order", "--format=%H %P")) {
		f := strings.SplitN(l, " ", 2)
		parents[f[0]] = ""
		if len(f) == 2 {
			parents[f[0]] = f[1]
		}
	}
	for _, row := range rows {
		if got := strings.Join(row.Parents, " "); got != parents[row.Sha] {
			t.Fatalf("row %s parents = %q, want %q", row.Sha, got, parents[row.Sha])
		}
	}

	decor := map[string][]string{}
	for _, l := range lines(repo.Git("for-each-ref", "--format=%(objectname) %(*objectname) %(refname)")) {
		f := strings.Fields(l)
		target := f[0]
		if len(f) == 3 {
			target = f[1]
		}
		decor[target] = append(decor[target], f[len(f)-1])
	}
	seen := map[string][]string{}
	for _, row := range rows {
		for _, ref := range row.Refs {
			seen[row.Sha] = append(seen[row.Sha], ref.Kind+":"+ref.Name)
		}
	}
	for sha, refs := range decor {
		var shortNames []string
		for _, full := range refs {
			shortNames = append(shortNames, strings.TrimPrefix(strings.TrimPrefix(strings.TrimPrefix(full, "refs/heads/"), "refs/tags/"), "refs/remotes/"))
		}
		for _, short := range shortNames {
			found := false
			for _, got := range seen[sha] {
				if strings.HasSuffix(got, ":"+short) {
					found = true
				}
			}
			if !found {
				t.Fatalf("commit %s lacks decoration %q; got %v", sha, short, seen[sha])
			}
		}
	}
	head := rows[0]
	if len(head.Refs) == 0 {
		t.Fatalf("top row has no decorations: %+v", head)
	}
}

// Guards the P225 class: paging by Show more yields exactly git's order, no gaps, no duplicates.
func TestGraphPagesToEnd(t *testing.T) {
	for _, tc := range []struct {
		name     string
		commits  int
		complete bool
	}{{"2500", 2500, false}, {"50000", 50000, true}} {
		t.Run(tc.name, func(t *testing.T) {
			if tc.complete {
				flowharness.Complete(t)
			}
			r := newRig(t)
			repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: tc.commits, Branches: 8, MergeEvery: 5})
			id := r.open(repo.Dir).RepoID
			page := 100
			if tc.complete {
				page = 5000
			}
			r.setSettings(id, gitrpc.RepoSettingsPatchWire{GraphPageSize: &page})

			seen := map[string]bool{}
			rows := graphAll(t, r.gs, id, 1)
			for i, row := range rows {
				if seen[row.Sha] {
					t.Fatalf("duplicate sha %s at row %d", row.Sha, i)
				}
				seen[row.Sha] = true
			}
			want := repo.RevList("--exclude=refs/kira/*", "--all", "--topo-order")
			if len(rows) != len(want) {
				t.Fatalf("paged %d rows, git has %d", len(rows), len(want))
			}
			for i := range want {
				if rows[i].Sha != want[i] {
					t.Fatalf("row %d = %s, want %s", i, rows[i].Sha, want[i])
				}
			}
			st := call[gitrpc.GraphStatusResult](t, r.gs, "graph.status", gitrpc.GraphStatusParams{RepoID: id})
			if !st.Exhausted || st.Remaining != 0 || st.Loaded != len(want) {
				t.Fatalf("graph.status = %+v, want exhausted with %d loaded", st, len(want))
			}
		})
	}
}

// Guards P225's open item: Refresh after Show more must keep every row already loaded.
func TestGraphRefreshAfterExternalCommit(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 600, Branches: 3, MergeEvery: 5})
	id := r.open(repo.Dir).RepoID
	page := 100
	r.setSettings(id, gitrpc.RepoSettingsPatchWire{GraphPageSize: &page})

	first := r.gs.Stream("graph.stream", m{"repoId": id}, 4).Drain()
	if _, held := first[0].Graph(t); len(held) != page {
		t.Fatalf("first page = %d rows, want %d", len(held), page)
	}
	for i := 0; i < 2; i++ {
		call[gitrpc.GraphLoadMoreResult](t, r.gs, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: id})
	}
	st := call[gitrpc.GraphStatusResult](t, r.gs, "graph.status", gitrpc.GraphStatusParams{RepoID: id})
	if st.Loaded < 3*page {
		t.Fatalf("loaded = %d after two Show more, want >= %d", st.Loaded, 3*page)
	}
	before := len(r.gs.Events("repo.changed"))

	newSha := repo.Commit("external commit", map[string]string{"external.txt": "x\n"})
	if out, err := exec.Command("git", "-C", repo.Dir, "rev-parse", "HEAD").CombinedOutput(); err != nil || strings.TrimSpace(string(out)) != newSha {
		t.Fatalf("external commit not at HEAD: %v %s", err, out)
	}
	testx.WaitUntil(t, wait, func() bool { return len(r.gs.Events("repo.changed")) > before })

	res := call[gitrpc.GraphRefreshResult](t, r.gs, "graph.refresh", gitrpc.GraphRefreshParams{RepoID: id})
	if !res.Restarted {
		t.Fatal("graph.refresh did not restart the walk")
	}
	chunks := r.gs.Stream("graph.stream", m{"repoId": id}, 64).Drain()
	var rows []flowharness.GraphRow
	for _, c := range chunks {
		_, got := c.Graph(t)
		rows = append(rows, got...)
	}
	if len(rows) == 0 || rows[0].Sha != newSha {
		t.Fatalf("top row after refresh = %v, want the external commit %s", firstSha(rows), newSha)
	}
	want := repo.RevList("--exclude=refs/kira/*", "--all", "--topo-order")[:len(rows)]
	for i := range rows {
		if rows[i].Sha != want[i] {
			t.Fatalf("row %d after refresh = %s, want %s", i, rows[i].Sha, want[i])
		}
	}
	t.Run("keeps every loaded page", func(t *testing.T) {
		if len(rows) < st.Loaded {
			t.Fatalf("refresh kept %d rows, want at least the %d loaded before", len(rows), st.Loaded)
		}
	})
}

func firstSha(rows []flowharness.GraphRow) string {
	if len(rows) == 0 {
		return "<none>"
	}
	return rows[0].Sha
}
