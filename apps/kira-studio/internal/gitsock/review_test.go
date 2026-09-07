package gitsock

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
)

// §3.9's own end-to-end proof: the base resolver's four outcomes, its reasons and candidate list,
// the request-borne baseCandidates override, the ranged walk agreeing with `git log` itself,
// graph/review isolation, ranged loadMore/status, the post-refsChanged reset, two connections
// reviewing independently, and the two E_BAD_REQUEST refusals -- all over a real socket against a
// real fixture repository.

// reviewFixture names the commits/branches buildReviewFixtureRepo's own topology produces.
type reviewFixture struct {
	dir string

	baseSha     string // the shared root every branch below is built from
	mainHeadSha string // main's own second commit

	featureSha string // feature's own extra commit -- upstream is origin/feature, SAME short name

	topicSha1 string // topic's first extra commit
	topicSha2 string // topic's second extra commit -- upstream is origin/develop, DIFFERENT name

	mergedSha    string // == mainHeadSha: reviewing "merged" against "main" is empty
	unrelatedSha string // an orphan root sharing no history with main at all
}

// buildReviewFixtureRepo builds the topology §3.9 names: main; feature tracking origin/feature
// (same name -- the fall-through case); topic tracking origin/develop (the honoured case, two
// commits ahead so the ranged-walk-order test has more than one row); a fully-merged merged; an
// orphan root history unrelated; and master/release for the candidate-list cases. Fully isolated
// (D17/G5 D19): GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM=/dev/null, gpgsign off per commit.
func buildReviewFixtureRepo(t *testing.T) *reviewFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	dir := t.TempDir()

	run := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return string(out)
	}
	writeFile := func(name, content string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	commit := func(msg string) string {
		t.Helper()
		cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", msg)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git commit: %v\n%s", err, out)
		}
		return trimNewline(run("rev-parse", "HEAD"))
	}

	run("init", "-q", "-b", "main")
	f := &reviewFixture{dir: dir}

	writeFile("base.txt", "base\n")
	run("add", "base.txt")
	f.baseSha = commit("base commit")

	writeFile("main2.txt", "main2\n")
	run("add", "main2.txt")
	f.mainHeadSha = commit("main work")

	run("remote", "add", "origin", "https://example.invalid/repo.git")

	// feature tracks origin/feature -- SAME short name: rule 1's same-name fall-through.
	run("branch", "feature", f.baseSha)
	run("checkout", "-q", "feature")
	writeFile("feature.txt", "feature\n")
	run("add", "feature.txt")
	f.featureSha = commit("feature work")
	run("update-ref", "refs/remotes/origin/feature", f.baseSha)
	run("config", "branch.feature.remote", "origin")
	run("config", "branch.feature.merge", "refs/heads/feature")
	run("checkout", "-q", "main")

	// topic tracks origin/develop -- DIFFERENT name: rule 1's honoured case.
	run("branch", "topic", f.baseSha)
	run("checkout", "-q", "topic")
	writeFile("topic1.txt", "topic1\n")
	run("add", "topic1.txt")
	f.topicSha1 = commit("topic work 1")
	writeFile("topic2.txt", "topic2\n")
	run("add", "topic2.txt")
	f.topicSha2 = commit("topic work 2")
	run("update-ref", "refs/remotes/origin/develop", f.baseSha)
	run("config", "branch.topic.remote", "origin")
	run("config", "branch.topic.merge", "refs/heads/develop")
	run("checkout", "-q", "main")

	// merged sits exactly at main's own tip -- reviewing it against main is "empty" (D7c).
	run("branch", "merged", f.mainHeadSha)
	f.mergedSha = f.mainHeadSha

	// unrelated is an orphan root -- shares no history with main at all (D7c's "unrelated").
	run("checkout", "-q", "--orphan", "unrelated")
	writeFile("unrelated.txt", "unrelated\n")
	run("add", "unrelated.txt")
	f.unrelatedSha = commit("unrelated root")
	run("checkout", "-q", "main")

	// master/release: candidate-list members, no upstream of their own.
	run("branch", "master", f.baseSha)
	run("branch", "release", f.baseSha)

	return f
}

// buildAskFixtureRepo builds a repository with NEITHER a "main" nor a "master" branch and no
// origin remote at all -- the one topology that can genuinely reach BaseResolution's "ask"
// outcome, since the server always substitutes gitreview.DefaultBaseCandidates for an
// omitted/empty request candidate list (D7c).
func buildAskFixtureRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = opsFixtureEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "trunk")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	run("add", "f.txt")
	commitCmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "trunk base")
	commitCmd.Dir = dir
	commitCmd.Env = opsFixtureEnv()
	if out, err := commitCmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}
	run("branch", "wip")
	return dir
}

func strPtr(s string) *string { return &s }
func intPtr(n int) *int       { return &n }

func resolveBaseOK(t *testing.T, c *testClient, repoID, branch string, base *string, baseCandidates []string) gitreview.BaseResolution {
	t.Helper()
	params := gitrpc.ReviewResolveBaseParams{RepoID: repoID, Branch: branch, Base: base, BaseCandidates: baseCandidates}
	resp := requestOK(t, c, "review.resolveBase", params)
	return unmarshalResult[gitreview.BaseResolution](t, resp.Result)
}

func rangedGraphStatusOK(t *testing.T, c *testClient, repoID string, rng *gitrpc.CommitRangeParams) graphStatusResult {
	t.Helper()
	resp := requestOK(t, c, "graph.status", gitrpc.GraphStatusParams{RepoID: repoID, Range: rng})
	return unmarshalResult[graphStatusResult](t, resp.Result)
}

// readStreamFrameIgnoringEvents is readStreamFrame, tolerant of 'evt' frames interleaved before
// the next chunk/end frame -- a force-move fires repo.changed (refsChanged, and often
// worktreeChanged alongside it) on the same connection a stream is then re-opened on, so this
// avoids guessing exactly how many events land before the response (integration_test.go's own
// requestIgnoringEvents, generalised to a stream).
func (c *testClient) readStreamFrameIgnoringEvents() streamFrame {
	c.t.Helper()
	for {
		raw, err := readFrame(c.r)
		if err != nil {
			c.t.Fatalf("read stream frame: %v", err)
		}
		if len(raw) > 0 && raw[0] == 0x00 {
			if len(raw) < 5 {
				c.t.Fatalf("blob frame too short: %d bytes", len(raw))
			}
			headerLen := int(raw[1])<<24 | int(raw[2])<<16 | int(raw[3])<<8 | int(raw[4])
			if 5+headerLen > len(raw) {
				c.t.Fatalf("blob frame header length %d exceeds frame (%d bytes)", headerLen, len(raw))
			}
			header := raw[5 : 5+headerLen]
			blob := raw[5+headerLen:]
			var env wireEnvelope
			if err := json.Unmarshal(header, &env); err != nil {
				c.t.Fatalf("unmarshal blob frame header: %v\n%s", err, header)
			}
			return streamFrame{Body: env.Body, Blob: blob}
		}
		var env wireEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			c.t.Fatalf("unmarshal stream frame: %v\n%s", err, raw)
		}
		if env.Body.T == "evt" {
			continue
		}
		return streamFrame{Body: env.Body}
	}
}

func drainStreamToEndIgnoringEvents(t *testing.T, c *testClient) []streamFrame {
	t.Helper()
	var chunks []streamFrame
	for {
		f := c.readStreamFrameIgnoringEvents()
		if f.Body.T == "end" {
			if f.Body.Error != nil {
				t.Fatalf("stream ended with error: %+v", f.Body.Error)
			}
			return chunks
		}
		if f.Body.T != "chunk" {
			t.Fatalf("frame = %+v, want chunk or end", f.Body)
		}
		chunks = append(chunks, f)
	}
}

func assertBadRequest(t *testing.T, resp wireFrame, wantFieldSubstring string) {
	t.Helper()
	if resp.T != "res" || resp.OK == nil || *resp.OK {
		t.Fatalf("got %+v, want a refused (not-ok) response", resp)
	}
	if resp.Error == nil || resp.Error.Code != "E_BAD_REQUEST" {
		t.Fatalf("error = %+v, want E_BAD_REQUEST", resp.Error)
	}
	if !strings.Contains(resp.Error.Message, wantFieldSubstring) {
		t.Fatalf("error message = %q, want it to name %q", resp.Error.Message, wantFieldSubstring)
	}
}

func TestIntegration_ResolveBaseFourOutcomes(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	askDir := buildAskFixtureRepo(t)

	realRunner := gitclient.NewExecRunner()
	var revListSpawns int32
	countRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if len(spec.Args) > 0 && spec.Args[0] == "rev-list" {
			atomic.AddInt32(&revListSpawns, 1)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})
	server, sockPath, _, _ := newIntegrationServerWithRunner(t, countRunner)
	client := pairAndReady(t, server, sockPath, "resolve-outcomes")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID
	askRepoID := openRepoOK(t, client, askDir).Repo.RepoID

	// ready: topic's own upstream (origin/develop) resolves naturally, two commits ahead.
	ready := resolveBaseOK(t, client, repoID, "topic", nil, nil)
	if ready.Range.Kind != "ready" || ready.Range.CommitCount == nil || *ready.Range.CommitCount != 2 {
		t.Fatalf("topic range = %+v, want ready with commitCount 2", ready.Range)
	}

	// empty: merged sits exactly at main's own tip.
	empty := resolveBaseOK(t, client, repoID, "merged", strPtr("main"), nil)
	if empty.Range.Kind != "empty" {
		t.Fatalf("merged range = %+v, want empty", empty.Range)
	}

	// unrelated: an orphan root shares no history with main -- and rev-list --count must never
	// run for it (probe P4/D7c's own short-circuit: merge-base runs first).
	beforeUnrelated := atomic.LoadInt32(&revListSpawns)
	unrelated := resolveBaseOK(t, client, repoID, "unrelated", strPtr("main"), nil)
	if unrelated.Range.Kind != "unrelated" {
		t.Fatalf("unrelated range = %+v, want unrelated", unrelated.Range)
	}
	if got := atomic.LoadInt32(&revListSpawns); got != beforeUnrelated {
		t.Fatalf("rev-list spawns after an unrelated resolution = %d, want unchanged from %d (merge-base must short-circuit the count)", got, beforeUnrelated)
	}

	// ask: no upstream, no origin/HEAD, and neither default candidate ("main"/"master") exists.
	ask := resolveBaseOK(t, client, askRepoID, "wip", nil, nil)
	if ask.Range.Kind != "ask" || ask.Base != nil || ask.Reason != gitreview.ReasonNone {
		t.Fatalf("wip resolution = %+v, want {base:nil reason:none range:ask}", ask)
	}
}

func TestIntegration_ResolveBaseReasonsAndCandidates(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "resolve-reasons")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	topic := resolveBaseOK(t, client, repoID, "topic", nil, nil)
	if topic.Reason != gitreview.ReasonUpstream || topic.Base == nil || *topic.Base != "origin/develop" {
		t.Fatalf("topic resolution = %+v, want reason upstream base origin/develop", topic)
	}

	feature := resolveBaseOK(t, client, repoID, "feature", nil, nil)
	if feature.Reason != gitreview.ReasonDefaultBranch || feature.Base == nil || *feature.Base != "main" {
		t.Fatalf("feature resolution = %+v, want reason defaultBranch base main (same-name upstream falls through)", feature)
	}

	override := resolveBaseOK(t, client, repoID, "feature", strPtr("master"), nil)
	if override.Reason != gitreview.ReasonOverride || override.Base == nil || *override.Base != "master" {
		t.Fatalf("feature override resolution = %+v, want reason override base master", override)
	}
	if !reflect.DeepEqual(override.Candidates, feature.Candidates) {
		t.Fatalf("override candidates = %+v, want unchanged from the natural resolution's own %+v (D7c: candidates always reflects the natural resolution)", override.Candidates, feature.Candidates)
	}
}

func TestIntegration_ResolveBaseHonoursRequestBaseCandidates(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "resolve-candidates")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	withDefault := resolveBaseOK(t, client, repoID, "master", nil, nil)
	if withDefault.Base == nil || *withDefault.Base != "main" {
		t.Fatalf("master resolution with the server's own default candidates = %+v, want base main", withDefault)
	}

	withRequestCandidates := resolveBaseOK(t, client, repoID, "master", nil, []string{"release"})
	if withRequestCandidates.Base == nil || *withRequestCandidates.Base != "release" {
		t.Fatalf("master resolution with baseCandidates=[release] = %+v, want base release", withRequestCandidates)
	}
}

func TestIntegration_RangedWalkMatchesGitLog(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "ranged-matches-log")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	logCmd := exec.Command("git", "log", "--topo-order", "--format=%H", f.baseSha+"..topic")
	logCmd.Dir = f.dir
	out, err := logCmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git log: %v\n%s", err, out)
	}
	wantShas := strings.Fields(string(out))
	if len(wantShas) != 2 {
		t.Fatalf("git log itself reports %d commits in the range, want 2", len(wantShas))
	}

	id := client.openStream("graph.stream", gitrpc.GraphStreamParams{
		RepoID: repoID, Range: &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"},
	})
	client.sendCredit(id, 10)
	var gotShas []string
	for _, fr := range drainStreamToEnd(t, client) {
		if fr.Blob == nil {
			t.Fatal("ranged chunk carried no out-of-band blob")
		}
		table := decodePackedChunk(t, fr.Blob)
		gotShas = append(gotShas, shasFromChunk(table)...)
	}
	if !reflect.DeepEqual(gotShas, wantShas) {
		t.Fatalf("ranged walk shas = %v, want %v (git log's own order, upstream's own agreement check)", gotShas, wantShas)
	}
}

func TestIntegration_RangedWalkDoesNotDisturbTheGraph(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "ranged-vs-graph")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	graphID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
	client.sendCredit(graphID, 10)
	drainStreamToEnd(t, client)
	graphStatusBefore := graphStatusOK(t, client, repoID)
	if !graphStatusBefore.Exhausted {
		t.Fatalf("graph status before any review = %+v, want exhausted", graphStatusBefore)
	}

	// A full review round trip: resolve, stream, loadMore, stream a second range.
	resolveBaseOK(t, client, repoID, "topic", nil, nil)
	firstRng := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"}
	reviewID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: firstRng})
	client.sendCredit(reviewID, 10)
	drainStreamToEnd(t, client)
	requestOK(t, client, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: repoID, Range: firstRng})

	secondRng := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "feature"}
	secondID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: secondRng})
	client.sendCredit(secondID, 10)
	drainStreamToEnd(t, client)

	graphStatusAfter := graphStatusOK(t, client, repoID)
	if graphStatusAfter != graphStatusBefore {
		t.Fatalf("graph status after a full review round trip = %+v, want unchanged from %+v", graphStatusAfter, graphStatusBefore)
	}

	reopenID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, ResumeThroughRow: &graphStatusAfter.Loaded})
	client.sendCredit(reopenID, 10)
	for _, fr := range drainStreamToEnd(t, client) {
		var payload graphChunkPayload
		if err := json.Unmarshal(fr.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		if payload.Source != "cache" {
			t.Fatalf("graph re-open chunk source = %q after a full review round trip, want cache -- the graph must be untouched", payload.Source)
		}
	}
}

func TestIntegration_RangedLoadMoreAndStatus(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "ranged-loadmore")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	rng := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"} // 2 commits
	pageSize := 1

	requestOK(t, client, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: repoID, Range: rng, PageSize: &pageSize})
	status1 := rangedGraphStatusOK(t, client, repoID, rng)
	if status1.Loaded != 1 || status1.Exhausted {
		t.Fatalf("review status after the first page = %+v, want {loaded:1 exhausted:false}", status1)
	}

	// pageSize is fixed at the walk's own construction (D6) -- a second request's PageSize has no
	// effect on the already-built walk. Pages:2 makes the SAME loadMore call read the range's last
	// row and then probe once more, which is what actually discovers EOF (exhaustion is only known
	// once a read attempt hits it, not merely once loadedCount reaches the total).
	requestOK(t, client, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: repoID, Range: rng, Pages: intPtr(2)})
	status2 := rangedGraphStatusOK(t, client, repoID, rng)
	if status2.Loaded != 2 || !status2.Exhausted {
		t.Fatalf("review status after the second page = %+v, want {loaded:2 exhausted:true}", status2)
	}

	// The same two calls without a range report the graph's own (never opened) counters.
	graphOnlyStatus := graphStatusOK(t, client, repoID)
	if graphOnlyStatus.Loaded != 0 || graphOnlyStatus.Remaining != 0 || graphOnlyStatus.Exhausted {
		t.Fatalf("graph status = %+v, want the zero-value answer for a connection with no graph walk yet", graphOnlyStatus)
	}
}

func TestIntegration_ReviewWalkResetsAfterRefsChange(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "ranged-reset")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	rng := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"}
	id1 := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: rng})
	client.sendCredit(id1, 10)
	firstRows := 0
	for _, fr := range drainStreamToEnd(t, client) {
		var payload graphChunkPayload
		if err := json.Unmarshal(fr.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		firstRows = payload.To
	}
	if firstRows != 2 {
		t.Fatalf("first ranged stream row count = %d, want 2", firstRows)
	}

	// Force-move topic under the live review walk.
	runGitIn(t, f.dir, "checkout", "-q", "topic")
	runGitIn(t, f.dir, "commit", "--allow-empty", "-q", "-m", "topic work 3")
	runGitIn(t, f.dir, "checkout", "-q", "main")

	// Wait for the watcher's own debounced refsChanged to actually reach this connection before
	// re-opening the stream -- otherwise the re-open can race ahead of MarkStale and legitimately
	// replay the still-fresh cache. The force-move can fire more than one event (refsChanged, and
	// often worktreeChanged alongside it, per ops_test.go's own note); readStreamFrameIgnoringEvents
	// below tolerates any further ones that arrive after this loop stops.
	foundRefsChanged := false
	for i := 0; i < 20 && !foundRefsChanged; i++ {
		if client.recvEvent("repo.changed").Kind == "refsChanged" {
			foundRefsChanged = true
		}
	}
	if !foundRefsChanged {
		t.Fatal("no refsChanged event arrived after the force-move")
	}

	id2 := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: rng})
	client.sendCredit(id2, 10)
	secondRows := 0
	for _, fr := range drainStreamToEndIgnoringEvents(t, client) {
		var payload graphChunkPayload
		if err := json.Unmarshal(fr.Body.Chunk, &payload); err != nil {
			t.Fatalf("unmarshal chunk payload: %v", err)
		}
		secondRows = payload.To
	}
	if secondRows != 3 {
		t.Fatalf("second ranged stream (after the branch moved) row count = %d, want 3 -- D5: the walk must reset and re-walk, not replay a stale store", secondRows)
	}
}

func TestIntegration_TwoConnectionsReviewIndependently(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA := pairAndReady(t, server, sockPath, "review-two-a")
	clientB := pairAndReady(t, server, sockPath, "review-two-b")
	repoIDA := openRepoOK(t, clientA, f.dir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, f.dir).Repo.RepoID
	if repoIDA != repoIDB {
		t.Fatalf("clients opened the same repo but got different RepoIDs: %s vs %s", repoIDA, repoIDB)
	}
	repoID := repoIDA

	rngA := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"}   // 2 commits
	rngB := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "feature"} // 1 commit

	idA := clientA.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: rngA})
	clientA.sendCredit(idA, 10)
	drainStreamToEnd(t, clientA)

	idB := clientB.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: rngB})
	clientB.sendCredit(idB, 10)
	drainStreamToEnd(t, clientB)

	statusA := rangedGraphStatusOK(t, clientA, repoID, rngA)
	if statusA.Loaded != 2 || !statusA.Exhausted {
		t.Fatalf("A's review status = %+v, want {loaded:2 exhausted:true}", statusA)
	}
	statusB := rangedGraphStatusOK(t, clientB, repoID, rngB)
	if statusB.Loaded != 1 || !statusB.Exhausted {
		t.Fatalf("B's review status = %+v, want {loaded:1 exhausted:true}", statusB)
	}

	statusAAgain := rangedGraphStatusOK(t, clientA, repoID, rngA)
	if statusAAgain != statusA {
		t.Fatalf("A's review status changed after B's own review: %+v -> %+v", statusA, statusAAgain)
	}

	graphA := graphStatusOK(t, clientA, repoID)
	graphB := graphStatusOK(t, clientB, repoID)
	if graphA.Loaded != 0 || graphA.Exhausted || graphB.Loaded != 0 || graphB.Exhausted {
		t.Fatalf("graph status A=%+v B=%+v, want both zero-value (neither connection opened a graph walk)", graphA, graphB)
	}
}

func TestIntegration_RangedRefusalsAreBadRequests(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	client := pairAndReady(t, server, sockPath, "ranged-refusals")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	emptyBase := client.request("graph.status", gitrpc.GraphStatusParams{
		RepoID: repoID, Range: &gitrpc.CommitRangeParams{Base: "", Branch: "topic"},
	})
	assertBadRequest(t, emptyBase, "range.base")

	dashBase := client.request("graph.status", gitrpc.GraphStatusParams{
		RepoID: repoID, Range: &gitrpc.CommitRangeParams{Base: "-foo", Branch: "topic"},
	})
	assertBadRequest(t, dashBase, "range.base")
}
