package gitflow_test

import (
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
)

// Two streams drive one repo at once: branch creation on one, fetches on the other while a third
// clone pushes. Afterwards both streams and git itself must agree.
func TestParallelOpsOneRepo(t *testing.T) {
	r := newRig(t)
	pair := newRemotePair(r, "par", map[string]string{"f.txt": "seed\n"})
	id := r.open(pair.x.Dir).RepoID
	gsB := r.app.OpenGitStream()
	if got := openOn(t, gsB, pair.x.Dir).RepoID; got != id {
		t.Fatalf("second stream repo id %s, want %s", got, id)
	}

	const n = 8
	var wg sync.WaitGroup
	errs := make(chan error, 3*n)
	wg.Add(3)
	go func() {
		defer wg.Done()
		for i := range n {
			var res gitsession.OpResult
			err := r.gs.Request("op.run", gitrpc.OpRunParams{RepoID: id, Op: gitsession.OpRequest{Kind: "branchCreate", Name: fmt.Sprintf("a-%d", i), StartPoint: "main"}}, &res)
			if err != nil || !res.OK {
				errs <- fmt.Errorf("branchCreate a-%d: %v %+v", i, err, res.Error)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := range n {
			var res gitsession.RemoteOpResult
			err := gsB.Request("remote.run", gitrpc.RemoteRunParams{RepoID: id, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}}, &res)
			if err != nil || !res.OK {
				errs <- fmt.Errorf("fetch %d: %v %+v", i, err, res.Error)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := range n {
			pair.y.Commit(fmt.Sprintf("remote %d", i), map[string]string{fmt.Sprintf("y%d.txt", i): "y\n"})
			if out, err := pair.y.GitErr("push", "-q", "origin", "main"); err != nil {
				errs <- fmt.Errorf("push %d: %v %s", i, err, out)
			}
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if t.Failed() {
		return
	}

	if res := r.remote(id, gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}); !res.OK {
		t.Fatalf("final fetch = %+v", res.Error)
	}
	want := lines(pair.x.Git("for-each-ref", "--format=%(refname:short)", "refs/heads"))
	slices.Sort(want)
	for name, gs := range map[string]*flowharness.GitStream{"A": r.gs, "B": gsB} {
		refs := call[gitsession.RefsResult](t, gs, "refs.list", gitrpc.RefsListParams{RepoID: id})
		var got []string
		for _, b := range refs.Branches {
			got = append(got, b.ShortName)
		}
		slices.Sort(got)
		if !slices.Equal(got, want) {
			t.Fatalf("stream %s branches %v, want %v", name, got, want)
		}
		rows := graphAll(t, gs, id, 2)
		wantShas := pair.x.RevList("--exclude=refs/kira/*", "--all", "--topo-order")
		if strings.Join(shas(rows), "\n") != strings.Join(wantShas, "\n") {
			t.Fatalf("stream %s graph has %d rows, git rev-list has %d", name, len(rows), len(wantShas))
		}
	}
}
