package reviewflow_test

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

// reviewTopology is main (base, main2) plus: feature (1 commit, same-name upstream), topic (2
// commits, upstream origin/develop), merged (at main's tip), unrelated (orphan root), master and
// release (candidates). baseSha is the shared root.
func reviewTopology(app *flowharness.App) (repo *flowharness.Repo, baseSha string) {
	repo = app.NewRepo("proj")
	baseSha = repo.Commit("base commit", map[string]string{"base.txt": "base\n"})
	repo.Commit("main work", map[string]string{"main2.txt": "main2\n"})
	repo.Git("remote", "add", "origin", "https://example.invalid/repo.git")

	repo.Git("checkout", "-q", "-b", "feature", baseSha)
	repo.Commit("feature work", map[string]string{"feature.txt": "feature\n"})
	repo.Git("update-ref", "refs/remotes/origin/feature", baseSha)
	repo.Git("config", "branch.feature.remote", "origin")
	repo.Git("config", "branch.feature.merge", "refs/heads/feature")

	repo.Git("checkout", "-q", "-b", "topic", baseSha)
	repo.Commit("topic work 1", map[string]string{"topic1.txt": "topic1\n"})
	repo.Commit("topic work 2", map[string]string{"topic2.txt": "topic2\n"})
	repo.Git("update-ref", "refs/remotes/origin/develop", baseSha)
	repo.Git("config", "branch.topic.remote", "origin")
	repo.Git("config", "branch.topic.merge", "refs/heads/develop")

	repo.Checkout("main")
	repo.Git("branch", "merged", "main")
	repo.Git("branch", "master", baseSha)
	repo.Git("branch", "release", baseSha)
	repo.Git("checkout", "-q", "--orphan", "unrelated")
	repo.Git("rm", "-rf", "-q", ".")
	repo.Commit("unrelated root", map[string]string{"unrelated.txt": "unrelated\n"})
	repo.Checkout("main")
	return repo, baseSha
}

func resolveBase(t *testing.T, gs *flowharness.GitStream, id, branch string, base *string) gitreview.BaseResolution {
	t.Helper()
	return call[gitreview.BaseResolution](t, gs, "review.resolveBase", gitrpc.ReviewResolveBaseParams{RepoID: id, Branch: branch, Base: base})
}

func ptr[T any](v T) *T { return &v }

func rangeStatus(t *testing.T, gs *flowharness.GitStream, id string, rng m) gitrpc.GraphStatusResult {
	t.Helper()
	return call[gitrpc.GraphStatusResult](t, gs, "graph.status", m{"repoId": id, "range": rng})
}

func graphStatus(t *testing.T, gs *flowharness.GitStream, id string) gitrpc.GraphStatusResult {
	t.Helper()
	return call[gitrpc.GraphStatusResult](t, gs, "graph.status", m{"repoId": id})
}

func rangedShas(t *testing.T, gs *flowharness.GitStream, id string, rng m) []string {
	t.Helper()
	var out []string
	for _, c := range gs.Stream("graph.stream", m{"repoId": id, "range": rng}, 10).Drain() {
		_, rows := c.Graph(t)
		for _, r := range rows {
			out = append(out, r.Sha)
		}
	}
	return out
}

// Guards the base resolver's four outcomes over the wire.
func TestResolveBaseFourOutcomes(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, _ := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	if r := resolveBase(t, gs, id, "topic", nil); r.Range.Kind != "ready" || r.Range.CommitCount == nil || *r.Range.CommitCount != 2 {
		t.Fatalf("topic range = %+v, want ready with 2 commits", r.Range)
	}
	if r := resolveBase(t, gs, id, "merged", ptr("main")); r.Range.Kind != "empty" {
		t.Fatalf("merged range = %+v, want empty", r.Range)
	}
	if r := resolveBase(t, gs, id, "unrelated", ptr("main")); r.Range.Kind != "unrelated" || r.Range.CommitCount != nil {
		t.Fatalf("unrelated range = %+v, want unrelated with no count", r.Range)
	}

	// Neither default candidate exists in a trunk-only repo, so nothing resolves.
	trunk := app.NewRepo("trunk")
	trunk.Commit("trunk base", map[string]string{"f.txt": "x\n"})
	trunk.Git("branch", "-m", "main", "trunk")
	trunk.Git("branch", "wip")
	trunkID := openRepo(t, gs, trunk.Dir)
	if r := resolveBase(t, gs, trunkID, "wip", nil); r.Range.Kind != "ask" || r.Base != nil || r.Reason != gitreview.ReasonNone {
		t.Fatalf("wip resolution = %+v, want no base, reason none, range ask", r)
	}
}

// Guards the reason attached to each resolution and the candidate list staying the natural one
// under an override.
func TestResolveBaseReasonsAndCandidates(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, _ := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	if r := resolveBase(t, gs, id, "topic", nil); r.Reason != gitreview.ReasonUpstream || r.Base == nil || *r.Base != "origin/develop" {
		t.Fatalf("topic = %+v, want reason upstream, base origin/develop", r)
	}
	feature := resolveBase(t, gs, id, "feature", nil)
	if feature.Reason != gitreview.ReasonDefaultBranch || feature.Base == nil || *feature.Base != "main" {
		t.Fatalf("feature = %+v, want reason defaultBranch, base main (a same-name upstream falls through)", feature)
	}
	override := resolveBase(t, gs, id, "feature", ptr("master"))
	if override.Reason != gitreview.ReasonOverride || override.Base == nil || *override.Base != "master" {
		t.Fatalf("override = %+v, want reason override, base master", override)
	}
	if !reflect.DeepEqual(override.Candidates, feature.Candidates) {
		t.Fatalf("override candidates = %+v, want the natural %+v", override.Candidates, feature.Candidates)
	}
}

// Guards the repo's stored base candidates feeding the resolver when the request names none.
func TestResolveBaseUsesStoredCandidates(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, _ := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	if r := resolveBase(t, gs, id, "master", nil); r.Base == nil || *r.Base != "main" {
		t.Fatalf("master with default candidates = %+v, want base main", r)
	}
	call[gitrpc.RepoSettingsSnapshot](t, gs, "repoSettings.set", gitrpc.RepoSettingsSetParams{
		RepoID: id, Patch: gitrpc.RepoSettingsPatchWire{ReviewBaseCandidates: ptr([]string{"release"})},
	})
	if r := resolveBase(t, gs, id, "master", nil); r.Base == nil || *r.Base != "release" {
		t.Fatalf("master with stored candidates [release] = %+v, want base release", r)
	}
}

// Guards the ranged walk against git log: same commits, same order.
func TestRangedWalkMatchesGitLog(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, base := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	want := strings.Fields(repo.Git("log", "--topo-order", "--format=%H", base+"..topic"))
	if len(want) != 2 {
		t.Fatalf("git log reports %d commits, want 2", len(want))
	}
	if got := rangedShas(t, gs, id, m{"base": base, "branch": "topic"}); !reflect.DeepEqual(got, want) {
		t.Fatalf("ranged walk = %v, want %v", got, want)
	}
}

// Guards isolation: a full review round trip leaves the graph walk and its cache untouched.
func TestRangedWalkLeavesTheGraphAlone(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, base := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	gs.Stream("graph.stream", m{"repoId": id}, 10).Drain()
	before := graphStatus(t, gs, id)
	if !before.Exhausted {
		t.Fatalf("graph status before review = %+v, want exhausted", before)
	}

	topic := m{"base": base, "branch": "topic"}
	resolveBase(t, gs, id, "topic", nil)
	gs.Stream("graph.stream", m{"repoId": id, "range": topic}, 10).Drain()
	call[gitrpc.GraphLoadMoreResult](t, gs, "graph.loadMore", m{"repoId": id, "range": topic})
	gs.Stream("graph.stream", m{"repoId": id, "range": m{"base": base, "branch": "feature"}}, 10).Drain()

	if after := graphStatus(t, gs, id); after != before {
		t.Fatalf("graph status after review = %+v, want %+v", after, before)
	}
	for _, c := range gs.Stream("graph.stream", m{"repoId": id, "resumeThroughRow": before.Loaded}, 10).Drain() {
		if meta, _ := c.Graph(t); meta.Source != "cache" {
			t.Fatalf("graph reopen chunk source = %q, want cache", meta.Source)
		}
	}
}

// Guards ranged paging: the stored page size is fixed at walk creation and exhaustion shows only after a read hits EOF.
func TestRangedLoadMoreAndStatus(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo := app.NewRepo("proj")
	base := repo.Commit("base commit", map[string]string{"base.txt": "base\n"})
	repo.Git("checkout", "-q", "-b", "topic", base)
	for i := range 150 {
		repo.Commit(fmt.Sprintf("topic work %d", i), nil)
	}
	id := openRepo(t, gs, repo.Dir)
	call[gitrpc.RepoSettingsSnapshot](t, gs, "repoSettings.set", gitrpc.RepoSettingsSetParams{
		RepoID: id, Patch: gitrpc.RepoSettingsPatchWire{GraphPageSize: ptr(100)},
	})
	rng := m{"base": base, "branch": "topic"}

	call[gitrpc.GraphLoadMoreResult](t, gs, "graph.loadMore", m{"repoId": id, "range": rng})
	if st := rangeStatus(t, gs, id, rng); st.Loaded != 100 || st.Exhausted {
		t.Fatalf("after the first page = %+v, want 100 loaded, not exhausted", st)
	}
	call[gitrpc.GraphLoadMoreResult](t, gs, "graph.loadMore", m{"repoId": id, "range": rng, "pages": 2})
	if st := rangeStatus(t, gs, id, rng); st.Loaded != 150 || !st.Exhausted {
		t.Fatalf("after the second call = %+v, want 150 loaded, exhausted", st)
	}
	if st := graphStatus(t, gs, id); st.Loaded != 0 || st.Remaining != 0 || st.Exhausted {
		t.Fatalf("unranged status = %+v, want the empty answer for a connection with no graph walk", st)
	}
}

// Guards the reset: a branch move under a live review walk re-walks instead of replaying a stale store.
func TestReviewWalkResetsAfterRefsChange(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, base := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)
	rng := m{"base": base, "branch": "topic"}

	if got := rangedShas(t, gs, id, rng); len(got) != 2 {
		t.Fatalf("first ranged stream = %d rows, want 2", len(got))
	}
	external(t, gs, func() {
		repo.Checkout("topic")
		repo.Commit("topic work 3", nil)
		repo.Checkout("main")
	})
	if got := rangedShas(t, gs, id, rng); len(got) != 3 {
		t.Fatalf("ranged stream after the branch moved = %d rows, want 3", len(got))
	}
}

// Guards walk independence: two windows reviewing different ranges never see each other's counters.
func TestTwoConnectionsReviewIndependently(t *testing.T) {
	app := flowharness.New(t)
	a, b := app.OpenGitStream(), app.OpenGitStream()
	repo, base := reviewTopology(app)
	id := openRepo(t, a, repo.Dir)
	openRepo(t, b, repo.Dir)
	rngA, rngB := m{"base": base, "branch": "topic"}, m{"base": base, "branch": "feature"}

	a.Stream("graph.stream", m{"repoId": id, "range": rngA}, 10).Drain()
	b.Stream("graph.stream", m{"repoId": id, "range": rngB}, 10).Drain()

	stA := rangeStatus(t, a, id, rngA)
	if stA.Loaded != 2 || !stA.Exhausted {
		t.Fatalf("A status = %+v, want 2 loaded, exhausted", stA)
	}
	if st := rangeStatus(t, b, id, rngB); st.Loaded != 1 || !st.Exhausted {
		t.Fatalf("B status = %+v, want 1 loaded, exhausted", st)
	}
	if again := rangeStatus(t, a, id, rngA); again != stA {
		t.Fatalf("A status changed after B's review: %+v -> %+v", stA, again)
	}
	if ga, gb := graphStatus(t, a, id), graphStatus(t, b, id); ga.Loaded != 0 || ga.Exhausted || gb.Loaded != 0 || gb.Exhausted {
		t.Fatalf("graph status A=%+v B=%+v, want both empty", ga, gb)
	}
}

// Guards the range validation on graph.status.
func TestRangedRefusals(t *testing.T) {
	app := flowharness.New(t)
	gs := app.OpenGitStream()
	repo, _ := reviewTopology(app)
	id := openRepo(t, gs, repo.Dir)

	for _, base := range []string{"", "-foo"} {
		badRequest(t, gs, "graph.status", gitrpc.GraphStatusParams{RepoID: id, Range: &gitrpc.CommitRangeParams{Base: base, Branch: "topic"}}, "range.base")
	}
}
