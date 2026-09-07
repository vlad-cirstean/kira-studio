package gitsock

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// §3.7's own M5: revoke while a connection holds each of the four things a connection can hold,
// asserted against D8's own five clauses (F8) rather than the looser "before the call returns"
// reading of G1 D18 — every test below waits a BOUND for asynchronous teardown rather than assuming
// it has already happened by the time Revoke returns. Every test here begins TestRevoke so D16's
// own `-count=10` filter is exact.

// pairFreshWithToken pairs a brand new client and returns its own minted token, needed by every
// test here that re-dials afterward to check tokenRejected (pairAndReady itself discards it).
func pairFreshWithToken(t *testing.T, server *Server, sockPath, clientID string) (c *testClient, token string) {
	t.Helper()
	c = dialTestClient(t, sockPath)
	errCh := make(chan error, 1)
	go approveHead(server, errCh)
	kind, tok := c.hello(clientID, "revoke test", nil)
	if err := <-errCh; err != nil {
		t.Fatalf("approveHead: %v", err)
	}
	if kind != "ready" {
		t.Fatalf("hello outcome for %s: got %q", clientID, kind)
	}
	return c, tok
}

// TestRevoke_WhileIdle re-asserts the baseline already inside
// TestIntegration_FullPairingAndRPCLifecycle, against D8's wording, so this file is self-contained
// (that existing test is NOT deleted, D15).
func TestRevoke_WhileIdle(t *testing.T) {
	server, sockPath, clientsRepo, _ := newIntegrationServer(t)
	client, token := pairFreshWithToken(t, server, sockPath, "revoke-idle")

	if err := server.Revoke("revoke-idle"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	row, found, err := clientsRepo.ByID("revoke-idle")
	if err != nil || !found {
		t.Fatalf("client row: found=%v err=%v", found, err)
	}
	if row.RevokedAt == nil {
		t.Fatal("revoked_at not set after Revoke returns (D8 clause 1)")
	}
	if _, err := readFrame(client.r); err == nil {
		t.Fatal("expected the revoked connection's read to error (D8 clause 2)")
	}

	client2 := dialTestClient(t, sockPath)
	kind2, _ := client2.hello("revoke-idle", "revoke test", &token)
	if kind2 != "tokenRejected" {
		t.Fatalf("re-dial with the revoked token = %q, want tokenRejected (D8 clause 5)", kind2)
	}

	client3 := dialTestClient(t, sockPath)
	client3.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "revoke-idle", Label: "revoke test", PID: os.Getpid(), AppVersion: "test"},
		Token:  nil,
	})
	resp3 := client3.recvHandshake()
	if resp3.Kind != "pairingRequired" {
		t.Fatalf("re-dial with no token = %q, want pairingRequired (D8 clause 5)", resp3.Kind)
	}
	if got := server.Broker().Deny(resp3.RequestID); got != PairingActionResolved {
		t.Fatalf("deny: got %v", got)
	}
}

// TestRevoke_WhileHoldingAGraphWalk revokes a connection mid-stream: the socket closes at once, and
// -- bounded, not assumed instantaneous (D8 clause 3/F8) -- the walk's own git log process is
// killed and the ref released, proven by a fresh open building a NEW RepoEntry.
func TestRevoke_WhileHoldingAGraphWalk(t *testing.T) {
	dir, _ := initFixtureRepoWithCommits(t, 3)
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 30 * time.Millisecond
	var watcherConstructions int32
	realNewWatcher := registry.NewWatcher
	registry.NewWatcher = func(s gitclient.RepoSummary) (gitsession.Watcher, error) {
		atomic.AddInt32(&watcherConstructions, 1)
		return realNewWatcher(s)
	}

	client, token := pairFreshWithToken(t, server, sockPath, "revoke-walk")
	repoID := openRepoOK(t, client, dir).Repo.RepoID
	streamID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
	client.sendCredit(streamID, 1)

	if err := server.Revoke("revoke-walk"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := readFrame(client.r); err == nil {
		t.Fatal("expected the revoked connection's read to error")
	}

	time.Sleep(500 * time.Millisecond) // comfortably past LingerFor(30ms) once teardown finishes.
	client2, _ := pairFreshWithToken(t, server, sockPath, "revoke-walk-probe")
	_ = openRepoOK(t, client2, dir)
	if got := atomic.LoadInt32(&watcherConstructions); got != 2 {
		t.Fatalf("watcher constructions after revoke-while-streaming + reopen = %d, want 2 (the walk's git log process and the ref were properly torn down)", got)
	}

	client3 := dialTestClient(t, sockPath)
	kind3, _ := client3.hello("revoke-walk", "revoke test", &token)
	if kind3 != "tokenRejected" {
		t.Fatalf("re-dial with the revoked token = %q, want tokenRejected", kind3)
	}
}

// TestRevoke_WhileHoldingAReviewSession is the same shape with BOTH walk slots open (D3's own
// walkPair) -- both must be disposed, not just the graph one.
func TestRevoke_WhileHoldingAReviewSession(t *testing.T) {
	f := buildReviewFixtureRepo(t)
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 30 * time.Millisecond
	var watcherConstructions int32
	realNewWatcher := registry.NewWatcher
	registry.NewWatcher = func(s gitclient.RepoSummary) (gitsession.Watcher, error) {
		atomic.AddInt32(&watcherConstructions, 1)
		return realNewWatcher(s)
	}

	client, _ := pairFreshWithToken(t, server, sockPath, "revoke-review")
	repoID := openRepoOK(t, client, f.dir).Repo.RepoID

	graphID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
	client.sendCredit(graphID, 1)
	rng := &gitrpc.CommitRangeParams{Base: f.baseSha, Branch: "topic"}
	reviewID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID, Range: rng})
	client.sendCredit(reviewID, 1)

	if err := server.Revoke("revoke-review"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := readFrame(client.r); err == nil {
		t.Fatal("expected the revoked connection's read to error")
	}

	time.Sleep(500 * time.Millisecond)
	client2, _ := pairFreshWithToken(t, server, sockPath, "revoke-review-probe")
	_ = openRepoOK(t, client2, f.dir)
	if got := atomic.LoadInt32(&watcherConstructions); got != 2 {
		t.Fatalf("watcher constructions after revoke-while-reviewing + reopen = %d, want 2 (both walk slots were disposed)", got)
	}
}

// TestRevoke_WhileARemoteOpIsRunning proves D8 clause 4: a write or remote op already in flight is
// NOT killed by revoke, and finishes on its own -- proven from a second, non-revoked connection.
func TestRevoke_WhileARemoteOpIsRunning(t *testing.T) {
	f := buildRemoteFixture(t)
	started := make(chan struct{})
	var once sync.Once
	sleepyGit := sleepyGitShim(t)
	realRunner := gitclient.NewExecRunner()
	blockingRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if argvContains(spec.Args, "fetch") {
			once.Do(func() { close(started) })
			return realRunner.Start(ctx, sleepyGit, spec)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})

	server, sockPath, _, _ := newRemoteIntegrationServerWithRunner(t, 5*time.Second, blockingRunner)
	clientA, _ := pairFreshWithToken(t, server, sockPath, "revoke-remote-a")
	repoID := openRepoOK(t, clientA, f.workDir).Repo.RepoID

	id := clientA.next
	clientA.next++
	params, err := json.Marshal(gitrpc.RemoteRunParams{RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})
	<-started

	if err := server.Revoke("revoke-remote-a"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	clientB, _ := pairFreshWithToken(t, server, sockPath, "revoke-remote-b")
	_ = openRepoOK(t, clientB, f.workDir)
	busy := unmarshalResult[gitsession.RemoteOpResult](t, requestIgnoringEvents(t, clientB, "remote.run", gitrpc.RemoteRunParams{
		RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	}).Result)
	if busy.OK || busy.Error == nil || busy.Error.Kind != "OperationInProgress" {
		t.Fatalf("B's remote.run right after A's revoke = %+v, want OperationInProgress (the fetch must survive revoke, D8 clause 4)", busy)
	}

	cancelResp := unmarshalResult[gitrpc.RemoteCancelResult](t, requestIgnoringEvents(t, clientB, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID}).Result)
	if !cancelResp.Cancelled {
		t.Fatal("cancelling the revoked connection's still-running fetch reported false")
	}

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result := unmarshalResult[gitsession.RemoteOpResult](t, requestIgnoringEvents(t, clientB, "remote.run", gitrpc.RemoteRunParams{
			RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		}).Result)
		if result.Error == nil || result.Error.Kind != "OperationInProgress" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the shared slot never freed up after cancelling the revoked connection's fetch")
}

// TestRevoke_WhileACredentialPromptIsPending revokes a connection with a credential.request
// outstanding: the waiter unblocks "not answered", the op fails AuthFailed promptly, and a second
// connection can then run and answer its own prompted fetch.
func TestRevoke_WhileACredentialPromptIsPending(t *testing.T) {
	url := newDenyingHTTPServer(t)
	dir := t.TempDir()
	runRemoteGit(t, dir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, dir, "add", "f.txt")
	commitRemoteFixture(t, dir, "base")
	runRemoteGit(t, dir, "remote", "add", "origin", url)

	server, sockPath, _, _ := newRemoteIntegrationServer(t, 3*time.Second)
	client, _ := pairFreshWithToken(t, server, sockPath, "revoke-cred")
	repoID := openRepoOK(t, client, dir).Repo.RepoID

	params, err := json.Marshal(gitrpc.RemoteRunParams{RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	id := client.next
	client.next++
	client.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})
	_ = client.recvEvent("credential.request") // wait for the prompt to actually arrive.

	if err := server.Revoke("revoke-cred"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	client2, _ := pairFreshWithToken(t, server, sockPath, "revoke-cred-2")
	_ = openRepoOK(t, client2, dir)
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result := unmarshalResult[gitsession.RemoteOpResult](t, requestIgnoringEvents(t, client2, "remote.run", gitrpc.RemoteRunParams{
			RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		}).Result)
		if result.Error == nil || result.Error.Kind != "OperationInProgress" {
			return // the revoked connection's own prompted fetch ended -- nothing hangs.
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("the shared slot never freed up after revoking a connection mid-prompt")
}

// TestRevoke_DoesNotDisturbAnotherClient revokes one of two clients holding the same repository:
// the other's holds, walk and events are entirely intact, and its OWN token still works.
func TestRevoke_DoesNotDisturbAnotherClient(t *testing.T) {
	dir, _ := initFixtureRepoWithCommits(t, 3)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA, _ := pairFreshWithToken(t, server, sockPath, "revoke-other-a")
	clientB, tokenB := pairFreshWithToken(t, server, sockPath, "revoke-other-b")
	repoID := openRepoOK(t, clientA, dir).Repo.RepoID
	_ = openRepoOK(t, clientB, dir).Repo.RepoID

	streamID := clientB.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
	clientB.sendCredit(streamID, 10)
	drainStreamToEnd(t, clientB)

	if err := server.Revoke("revoke-other-a"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	requestIgnoringEvents(t, clientB, "refs.list", gitrpc.RefsListParams{RepoID: repoID})
	runGitIn(t, dir, "commit", "--allow-empty", "-q", "-m", "still alive")
	ev := clientB.recvEvent("repo.changed")
	if ev.RepoID != repoID || ev.Kind != "refsChanged" {
		t.Fatalf("B's event after A was revoked = %+v, want {%s refsChanged}", ev, repoID)
	}

	client3 := dialTestClient(t, sockPath)
	kind3, _ := client3.hello("revoke-other-b", "revoke test", &tokenB)
	if kind3 != "ready" {
		t.Fatalf("B's OWN token after A's revoke = %q, want ready (untouched)", kind3)
	}
}
