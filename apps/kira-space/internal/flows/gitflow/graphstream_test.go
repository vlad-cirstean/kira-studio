package gitflow_test

import (
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

func chunkMetas(t *testing.T, chunks []flowharness.Chunk) []flowharness.GraphMeta {
	t.Helper()
	out := make([]flowharness.GraphMeta, len(chunks))
	for i, c := range chunks {
		out[i], _ = c.Graph(t)
	}
	return out
}

// Guards the resume path: a reopened stream replays the held range from cache, never from row 0.
func TestGraphStreamResumesFromCache(t *testing.T) {
	r := newRig(t)
	// 600 rows over ChunkRows=500: the first stream has two chunks, so resuming at 500 has a real
	// cached range to replay.
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 600, Branches: 1})
	id := r.open(repo.Dir).RepoID
	if first := r.gs.Stream("graph.stream", m{"repoId": id}, 10).Drain(); len(first) != 2 {
		t.Fatalf("first stream = %d chunks, want 2", len(first))
	}

	metas := chunkMetas(t, r.gs.Stream("graph.stream", m{"repoId": id, "resumeThroughRow": 500}, 10).Drain())
	if len(metas) != 1 || metas[0].From != 500 || metas[0].To != 600 || metas[0].Source != "cache" {
		t.Fatalf("resumed chunks = %+v, want one cache chunk [500,600)", metas)
	}
}

// Guards the ranged (review) walk resuming through its own row cache, not re-sending row 0.
func TestRangedGraphStreamResumesFromCache(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 600, Branches: 1})
	id := r.open(repo.Dir).RepoID
	base := repo.RevList("--max-parents=0", "HEAD")[0]
	rng := m{"base": base, "branch": "main"}
	page := 300
	r.setSettings(id, gitrpc.RepoSettingsPatchWire{GraphPageSize: &page})

	r.gs.Stream("graph.stream", m{"repoId": id, "range": rng}, 10).Drain()
	call[gitrpc.GraphLoadMoreResult](t, r.gs, "graph.loadMore", m{"repoId": id, "pages": 1, "range": rng})
	st := call[gitrpc.GraphStatusResult](t, r.gs, "graph.status", m{"repoId": id, "range": rng})
	if st.Loaded <= 300 {
		t.Fatalf("ranged loaded = %d after loadMore, want a second page past 300", st.Loaded)
	}

	metas := chunkMetas(t, r.gs.Stream("graph.stream", m{"repoId": id, "range": rng, "resumeThroughRow": 300}, 10).Drain())
	if len(metas) == 0 || metas[0].From != 300 {
		t.Fatalf("resumed ranged chunks = %+v, want the first starting at row 300", metas)
	}
	for _, meta := range metas {
		if meta.Source != "cache" {
			t.Fatalf("resumed ranged chunk source = %q, want cache", meta.Source)
		}
	}
}

// Guards walk privacy: one window's load, refresh and status never touch another window's walk.
func TestGraphWalksArePrivatePerConnection(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 40, Branches: 1})
	other := r.app.OpenGitStream()
	id := r.open(repo.Dir).RepoID
	openOn(t, other, repo.Dir)

	call[gitrpc.GraphLoadMoreResult](t, r.gs, "graph.loadMore", m{"repoId": id, "pages": 1})
	if st := call[gitrpc.GraphStatusResult](t, r.gs, "graph.status", m{"repoId": id}); st.Loaded != 40 || !st.Exhausted {
		t.Fatalf("own status after loadMore = %+v, want fully loaded", st)
	}
	if st := call[gitrpc.GraphStatusResult](t, other, "graph.status", m{"repoId": id}); st.Loaded != 0 || st.Remaining != 0 || st.Exhausted {
		t.Fatalf("other window status = %+v, want the empty answer for a connection with no walk", st)
	}

	other.Stream("graph.stream", m{"repoId": id}, 10).Drain()
	if st := call[gitrpc.GraphStatusResult](t, other, "graph.status", m{"repoId": id}); st.Loaded != 40 || !st.Exhausted {
		t.Fatalf("other status after its own stream = %+v, want fully loaded", st)
	}

	if res := call[gitrpc.GraphRefreshResult](t, r.gs, "graph.refresh", m{"repoId": id}); !res.Restarted {
		t.Fatal("graph.refresh restarted nothing, want the first window's walk restarted")
	}
	for _, meta := range chunkMetas(t, other.Stream("graph.stream", m{"repoId": id, "resumeThroughRow": 40}, 10).Drain()) {
		if meta.Source != "cache" {
			t.Fatalf("other chunk source = %q after the first window's refresh, want cache", meta.Source)
		}
	}
}

// Guards credit flow control: the server sends no more chunks than credit granted.
func TestGraphStreamCreditBackpressure(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 1200, Branches: 1})
	id := r.open(repo.Dir).RepoID

	stream := r.gs.Stream("graph.stream", m{"repoId": id}, 2)
	for i := 0; i < 2; i++ {
		if _, ok, err := stream.Next(); !ok || err != nil {
			t.Fatalf("chunk %d: ok=%v err=%v", i, ok, err)
		}
	}
	third := make(chan bool, 1)
	go func() {
		_, ok, _ := stream.Next()
		third <- ok
	}()
	select {
	case <-third:
		t.Fatal("received a third chunk without more credit")
	case <-time.After(300 * time.Millisecond):
	}
	stream.Credit(1)
	select {
	case ok := <-third:
		if !ok {
			t.Fatal("stream ended after the extra credit, want a third chunk")
		}
	case <-time.After(wait):
		t.Fatal("no chunk after granting one more credit")
	}
}

// Guards the stored page size: graph.loadMore without pageSize uses the repo's setting.
func TestGraphLoadMoreHonorsStoredPageSize(t *testing.T) {
	r := newRig(t)
	repo := r.app.NewHistory("hist", flowharness.HistorySpec{Commits: 250, Branches: 1})
	id := r.open(repo.Dir).RepoID
	page := 100
	r.setSettings(id, gitrpc.RepoSettingsPatchWire{GraphPageSize: &page})

	call[gitrpc.GraphLoadMoreResult](t, r.gs, "graph.loadMore", m{"repoId": id, "pages": 1})
	if st := call[gitrpc.GraphStatusResult](t, r.gs, "graph.status", m{"repoId": id}); st.Loaded != 100 || st.Exhausted {
		t.Fatalf("status after one page = %+v, want 100 loaded of 250", st)
	}
}
