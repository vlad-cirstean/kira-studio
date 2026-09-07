package gitsock

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// §3.6's own two-windows/two-repos matrix, over the real socket: M1 (one repository, independent
// work), M2 (one repository, an exclusive remote op), M3 (two different repositories, full
// independence), M4 (a disconnect mid-operation leaves a second window untouched). Every test here
// begins TestMatrix so D16's own `-count=10` filter is exact.

// --- M1: two windows, one repository -------------------------------------------------------------

// TestMatrix_M1_WriteInOneWindowIsVisibleInTheOther proves D7's own second line of defence: A's own
// refs.list, immediately after its own op.run response and BEFORE any watcher event, already lists
// what it just wrote (invalidateAfterWrite) -- and B, once repo.changed actually arrives, sees the
// same thing through the normal path.
func TestMatrix_M1_WriteInOneWindowIsVisibleInTheOther(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA, clientB := pairTwoClients(t, server, sockPath)
	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	runResp := opRunOK(t, clientA, repoID, gitsession.OpRequest{Kind: "branchCreate", Name: "matrix-m1-branch", StartPoint: "main"})
	if !runResp.OK {
		t.Fatalf("A's branchCreate failed: %+v", runResp)
	}

	refsA := unmarshalResult[gitsession.RefsResult](t, requestIgnoringEvents(t, clientA, "refs.list", gitrpc.RefsListParams{RepoID: repoID}).Result)
	if findRefRow(refsA.Branches, "matrix-m1-branch") == nil {
		t.Fatal("A's own refs.list right after its own write does not list the new branch (D7)")
	}

	ev := clientB.recvEvent("repo.changed")
	if ev.RepoID != repoID || ev.Kind != "refsChanged" {
		t.Fatalf("B's event = %+v, want {%s refsChanged}", ev, repoID)
	}
	refsB := unmarshalResult[gitsession.RefsResult](t, requestIgnoringEvents(t, clientB, "refs.list", gitrpc.RefsListParams{RepoID: repoID}).Result)
	if findRefRow(refsB.Branches, "matrix-m1-branch") == nil {
		t.Fatal("B's refs.list after repo.changed does not list the new branch")
	}
}

// TestMatrix_M1_UndoSlotAttributionBothWays extends the existing single-direction
// TestIntegration_UndoSlotIsSharedAndAttributed: attribution flips depending on WHO wrote last,
// checked in both directions on the same pair of connections.
func TestMatrix_M1_UndoSlotAttributionBothWays(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA := pairAndReadyWithLabel(t, server, sockPath, "attrib-a", "window-a")
	clientB := pairAndReadyWithLabel(t, server, sockPath, "attrib-b", "window-b")
	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	delResp := opRunOK(t, clientA, repoID, gitsession.OpRequest{Kind: "branchDelete", Name: f.siblingBranch, Force: true})
	if !delResp.OK {
		t.Fatalf("A's branchDelete failed: %+v", delResp)
	}
	peekA := unmarshalResult[gitrpc.UndoPeekResult](t, requestIgnoringEvents(t, clientA, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID}).Result)
	if peekA.Slot == nil || strings.Contains(peekA.Slot.Label, "window:") {
		t.Fatalf("A's own peek = %+v, want the unsuffixed label", peekA.Slot)
	}
	peekB := unmarshalResult[gitrpc.UndoPeekResult](t, requestIgnoringEvents(t, clientB, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID}).Result)
	if peekB.Slot == nil || !strings.Contains(peekB.Slot.Label, "window: window-a") {
		t.Fatalf("B's own peek = %+v, want the (window: window-a)-suffixed label", peekB.Slot)
	}

	tagResp := opRunOK(t, clientB, repoID, gitsession.OpRequest{Kind: "tagDelete", Name: f.lightTag})
	if !tagResp.OK {
		t.Fatalf("B's tagDelete failed: %+v", tagResp)
	}
	peekBAfter := unmarshalResult[gitrpc.UndoPeekResult](t, requestIgnoringEvents(t, clientB, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID}).Result)
	if peekBAfter.Slot == nil || strings.Contains(peekBAfter.Slot.Label, "window:") {
		t.Fatalf("B's own peek after ITS OWN tagDelete = %+v, want the unsuffixed label", peekBAfter.Slot)
	}
	peekAAfter := unmarshalResult[gitrpc.UndoPeekResult](t, requestIgnoringEvents(t, clientA, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoID}).Result)
	if peekAAfter.Slot == nil || !strings.Contains(peekAAfter.Slot.Label, "window: window-b") {
		t.Fatalf("A's own peek after B's tagDelete = %+v, want the (window: window-b)-suffixed label", peekAAfter.Slot)
	}
}

// TestMatrix_M1_DetailCacheIsSharedAndDroppedForBoth extends
// TestIntegration_DetailCacheDropsOnRefsChanged to two connections: one set of spawns serves both,
// and a change drops it for both.
func TestMatrix_M1_DetailCacheIsSharedAndDroppedForBoth(t *testing.T) {
	f := buildDetailFixtureRepo(t)
	realRunner := gitclient.NewExecRunner()
	var showSpawns int32
	countRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if len(spec.Args) > 0 && spec.Args[0] == "show" {
			atomic.AddInt32(&showSpawns, 1)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})
	server, sockPath, _, _ := newIntegrationServerWithRunner(t, countRunner)
	clientA, clientB := pairTwoClients(t, server, sockPath)
	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	requestOK(t, clientA, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	afterA := atomic.LoadInt32(&showSpawns)
	if afterA == 0 {
		t.Fatal("expected at least one 'show' spawn for A's own commit.detail")
	}

	requestOK(t, clientB, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	if got := atomic.LoadInt32(&showSpawns); got != afterA {
		t.Fatalf("'show' spawns after B's own commit.detail for the SAME sha = %d, want unchanged from %d (shared cache)", got, afterA)
	}

	runGitIn(t, f.dir, "tag", "v-matrix-shared", f.root)
	if ev := clientA.recvEvent("repo.changed"); ev.Kind != "refsChanged" {
		t.Fatalf("A's event = %+v, want refsChanged", ev)
	}
	if ev := clientB.recvEvent("repo.changed"); ev.Kind != "refsChanged" {
		t.Fatalf("B's event = %+v, want refsChanged", ev)
	}

	requestIgnoringEvents(t, clientA, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	afterA2 := atomic.LoadInt32(&showSpawns)
	if afterA2 <= afterA {
		t.Fatalf("'show' spawns after refsChanged, A's re-fetch = %d, want an increase from %d", afterA2, afterA)
	}
	requestIgnoringEvents(t, clientB, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: f.root})
	if got := atomic.LoadInt32(&showSpawns); got != afterA2 {
		t.Fatalf("'show' spawns after B's re-fetch of A's now-fresh cache = %d, want unchanged from %d (shared, dropped for both)", got, afterA2)
	}
}

// TestMatrix_M1_StreamStalledOnCreditsBlocksOnlyItsOwnConnection is F10's own pin: Walk.Stream
// holds the walk's mutex across emit, which parks on credits. A connection that opens graph.stream
// and grants no credit stalls its OWN graph.loadMore (same walk, same mutex) but never touches a
// second connection's independent walk on the same repository.
func TestMatrix_M1_StreamStalledOnCreditsBlocksOnlyItsOwnConnection(t *testing.T) {
	dir, _ := initFixtureRepoWithCommits(t, 3)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA, clientB := pairTwoClients(t, server, sockPath)
	repoIDA := openRepoOK(t, clientA, dir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, dir).Repo.RepoID

	streamID := clientA.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoIDA})
	// No credit granted -- Stream is now parked inside its own walk's mutex. rpcstream dispatches
	// "open"'s handler onto its own goroutine (session.go's handleRaw), so this gives it time to
	// actually start and acquire the walk's mutex before loadMore (below) competes for the same
	// lock -- a real git-log spawn plus parse for a 3-commit fixture is on the order of a few ms,
	// comfortably inside this margin.
	time.Sleep(150 * time.Millisecond)

	loadMoreID := clientA.next
	clientA.next++
	loadMoreParams, err := json.Marshal(gitrpc.GraphLoadMoreParams{RepoID: repoIDA})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: loadMoreID, Method: "graph.loadMore", Params: loadMoreParams}})

	loadMoreDone := make(chan wireFrame, 1)
	go func() {
		for {
			raw, err := readFrame(clientA.r)
			if err != nil {
				return
			}
			var env wireEnvelope
			if json.Unmarshal(raw, &env) != nil {
				return
			}
			if env.Body.T == "evt" {
				continue
			}
			if env.Body.ID == loadMoreID {
				loadMoreDone <- env.Body
				return
			}
		}
	}()

	select {
	case <-loadMoreDone:
		t.Fatal("A's graph.loadMore answered while its own stream is stalled on credits")
	case <-time.After(300 * time.Millisecond):
	}

	// B, a completely separate connection with its own walk, remains fully responsive.
	requestOK(t, clientB, "refs.list", gitrpc.RefsListParams{RepoID: repoIDB})
	bStreamID := clientB.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoIDB})
	clientB.sendCredit(bStreamID, 10)
	drainStreamToEnd(t, clientB)
	requestIgnoringEvents(t, clientB, "graph.loadMore", gitrpc.GraphLoadMoreParams{RepoID: repoIDB})
	requestIgnoringEvents(t, clientB, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoIDB, SHA: ""})

	// A cancels its own stalled stream; loadMore then unblocks.
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "cancel", ID: streamID}})
	select {
	case <-loadMoreDone:
	case <-time.After(5 * time.Second):
		t.Fatal("A's graph.loadMore never answered after cancelling the stalled stream")
	}
}

// --- M2: two windows, one repository, an exclusive operation --------------------------------------

// sleepyGitShim writes a `git` stand-in that ignores its argv and just sleeps -- a real, genuinely
// running child so the remote-op slot's own claim/cancel has something real to hold and kill.
func sleepyGitShim(t *testing.T) string {
	t.Helper()
	shimDir := t.TempDir()
	path := filepath.Join(shimDir, "git-sleepy")
	if err := os.WriteFile(path, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatalf("write sleepy git shim: %v", err)
	}
	return path
}

// TestMatrix_M2_SimultaneousRemoteRunsAdmitExactlyOne is F9's own gap: N remote.run requests fired
// at the SAME INSTANT from N different connections on one repository must admit exactly one.
func TestMatrix_M2_SimultaneousRemoteRunsAdmitExactlyOne(t *testing.T) {
	f := buildRemoteFixture(t)
	const n = 4

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

	clients := make([]*testClient, n)
	ids := make([]int, n)
	var repoID string
	for i := range clients {
		clients[i] = pairAndReady(t, server, sockPath, "matrix-m2-"+string(rune('a'+i)))
		r := openRepoOK(t, clients[i], f.workDir).Repo.RepoID
		if repoID == "" {
			repoID = r
		}
	}

	type reply struct {
		idx    int
		result gitsession.RemoteOpResult
	}
	replies := make(chan reply, n)

	var sendWG sync.WaitGroup
	sendWG.Add(n)
	for i := 0; i < n; i++ {
		go func(i int) {
			defer sendWG.Done()
			id := clients[i].next
			clients[i].next++
			ids[i] = id
			params, err := json.Marshal(gitrpc.RemoteRunParams{
				RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
			})
			if err != nil {
				t.Errorf("marshal: %v", err)
				return
			}
			clients[i].sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})
		}(i)
	}
	sendWG.Wait()
	<-started // exactly one of the N simultaneous attempts actually reached the spawn.

	for i := 0; i < n; i++ {
		go func(i int) {
			for {
				raw, err := readFrame(clients[i].r)
				if err != nil {
					return
				}
				var env wireEnvelope
				if json.Unmarshal(raw, &env) != nil {
					return
				}
				if env.Body.T == "evt" {
					continue
				}
				if env.Body.ID == ids[i] {
					replies <- reply{i, unmarshalResult[gitsession.RemoteOpResult](t, env.Body.Result)}
					return
				}
			}
		}(i)
	}

	losers := 0
	deadline := time.After(3 * time.Second)
	for losers < n-1 {
		select {
		case r := <-replies:
			if r.result.OK || r.result.Error == nil || r.result.Error.Kind != "OperationInProgress" {
				t.Fatalf("client %d result = %+v, want OperationInProgress", r.idx, r.result)
			}
			losers++
		case <-deadline:
			t.Fatalf("only %d/%d losers reported OperationInProgress in time", losers, n-1)
		}
	}

	select {
	case r := <-replies:
		t.Fatalf("more than one connection was admitted: an extra reply arrived (%+v)", r)
	case <-time.After(200 * time.Millisecond):
	}

	// A dedicated, uninvolved connection frees the winner via cancel (the slot is shared per-repo,
	// D19/SPEC §6 -- any connection holding the repository may cancel it) so the test winds down
	// cleanly instead of leaking a 30s sleeper.
	controller := pairAndReady(t, server, sockPath, "matrix-m2-controller")
	_ = openRepoOK(t, controller, f.workDir)
	requestOK(t, controller, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID})

	select {
	case r := <-replies:
		if r.result.OK || r.result.Error == nil || r.result.Error.Kind != "Cancelled" {
			t.Fatalf("the winner's own result after cancel = %+v, want Cancelled", r.result)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the winner's own remote.run never answered after remote.cancel")
	}

	idleCancel := unmarshalResult[gitrpc.RemoteCancelResult](t, requestOK(t, controller, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID}).Result)
	if idleCancel.Cancelled {
		t.Fatal("remote.cancel with nothing running (slot freed after the winner's cancel) reported true")
	}
}

// TestMatrix_M2_LocalOpAndRemoteOpAreNotMutuallyExclusive is G7 D11's own claim, never yet tested
// end to end: a remote op holds no gate a local write needs, and vice versa.
func TestMatrix_M2_LocalOpAndRemoteOpAreNotMutuallyExclusive(t *testing.T) {
	f := buildRemoteFixture(t)
	runRemoteGit(t, f.workDir, "branch", "matrix-side-branch")

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
	clientA := pairAndReady(t, server, sockPath, "m2-mutex-a")
	clientB := pairAndReady(t, server, sockPath, "m2-mutex-b")
	repoID := openRepoOK(t, clientA, f.workDir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.workDir).Repo.RepoID

	fetchID := clientA.next
	clientA.next++
	fetchParams, err := json.Marshal(gitrpc.RemoteRunParams{RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: fetchID, Method: "remote.run", Params: fetchParams}})
	<-started // A's fetch is now genuinely in flight.

	checkoutResult := opRunOK(t, clientB, repoID, gitsession.OpRequest{Kind: "checkout", Target: "matrix-side-branch", Mode: "switch"})
	if !checkoutResult.OK {
		t.Fatalf("B's checkout failed while A's fetch was still running: %+v", checkoutResult)
	}
	if checkoutResult.Head.Kind != "branch" || checkoutResult.Head.Name != "matrix-side-branch" {
		t.Fatalf("B's checkout head = %+v, want matrix-side-branch", checkoutResult.Head)
	}

	clientC := pairAndReady(t, server, sockPath, "m2-mutex-c")
	_ = openRepoOK(t, clientC, f.workDir)
	busy := unmarshalResult[gitsession.RemoteOpResult](t, requestIgnoringEvents(t, clientC, "remote.run", gitrpc.RemoteRunParams{
		RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	}).Result)
	if busy.OK || busy.Error == nil || busy.Error.Kind != "OperationInProgress" {
		t.Fatalf("C's remote.run while A's fetch is still running = %+v, want OperationInProgress (B's write must not have disturbed it)", busy)
	}

	cancelResp := unmarshalResult[gitrpc.RemoteCancelResult](t, requestIgnoringEvents(t, clientC, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID}).Result)
	if !cancelResp.Cancelled {
		t.Fatal("cancelling A's still-running fetch reported false")
	}
	for {
		raw, err := readFrame(clientA.r)
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var env wireEnvelope
		if unmarshalErr := json.Unmarshal(raw, &env); unmarshalErr != nil {
			t.Fatalf("unmarshal: %v", unmarshalErr)
		}
		if env.Body.T == "evt" {
			continue
		}
		if env.Body.ID == fetchID {
			res := unmarshalResult[gitsession.RemoteOpResult](t, env.Body.Result)
			if res.OK || res.Error == nil || res.Error.Kind != "Cancelled" {
				t.Fatalf("A's fetch result after cancel = %+v, want Cancelled", res)
			}
			break
		}
	}
}

// --- M3: two windows, two different repositories ---------------------------------------------------

// TestMatrix_M3_FullIndependence covers SPEC's own matrix scenario 3: no cross-repo signal, no
// shared cache, no shared undo slot, no shared remote-op slot, and a lookup for a sha that exists
// only in the other repository fails cleanly rather than finding it by accident.
func TestMatrix_M3_FullIndependence(t *testing.T) {
	repoA, repoB := initTwoFixtureRepos(t)
	server, sockPath, _, _ := newIntegrationServer(t)
	clientA, clientB := pairTwoClients(t, server, sockPath)
	repoIDA := openRepoOK(t, clientA, repoA).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, repoB).Repo.RepoID
	if repoIDA == repoIDB {
		t.Fatal("two different fixture repositories produced the same RepoID")
	}

	runGitIn(t, repoA, "commit", "--allow-empty", "-q", "-m", "repo A only")
	ev := clientA.recvEvent("repo.changed")
	if ev.RepoID != repoIDA || ev.Kind != "refsChanged" {
		t.Fatalf("A's event = %+v, want {%s refsChanged}", ev, repoIDA)
	}
	_ = clientB.nc.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
	if _, err := readFrame(clientB.r); err == nil {
		t.Fatal("B received something after a write to a DIFFERENT repository -- cross-repo leakage")
	}
	_ = clientB.nc.SetReadDeadline(time.Time{})

	branchResp := opRunIgnoringEvents(t, clientA, repoIDA, gitsession.OpRequest{Kind: "branchCreate", Name: "matrix-m3-branch", StartPoint: "main"})
	if !branchResp.OK {
		t.Fatalf("A's branchCreate failed: %+v", branchResp)
	}
	delResp := opRunIgnoringEvents(t, clientA, repoIDA, gitsession.OpRequest{Kind: "branchDelete", Name: "matrix-m3-branch"})
	if !delResp.OK {
		t.Fatalf("A's branchDelete failed: %+v", delResp)
	}
	peekB := unmarshalResult[gitrpc.UndoPeekResult](t, requestIgnoringEvents(t, clientB, "undo.peek", gitrpc.UndoPeekParams{RepoID: repoIDB}).Result)
	if peekB.Slot != nil {
		t.Fatalf("B's undo slot (a DIFFERENT repository) = %+v, want nil after A's own delete", peekB.Slot)
	}

	cancelA := unmarshalResult[gitrpc.RemoteCancelResult](t, requestIgnoringEvents(t, clientA, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoIDA}).Result)
	cancelB := unmarshalResult[gitrpc.RemoteCancelResult](t, requestIgnoringEvents(t, clientB, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoIDB}).Result)
	if cancelA.Cancelled || cancelB.Cancelled {
		t.Fatal("remote.cancel reported true with nothing running on either repository")
	}

	shaOnlyInA := trimNewline(runGitOutput(t, repoA, "rev-parse", "HEAD"))
	badResp := requestIgnoringEvents(t, clientB, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoIDB, SHA: shaOnlyInA})
	if badResp.OK != nil && *badResp.OK {
		t.Fatalf("B's commit.detail for a sha that only exists in repo A succeeded: %+v", badResp)
	}
}

// TestMatrix_M3_NoGoroutineOrProcessGrowth is the test F1 would have caught (D2's own note): 20
// cycles of pairing, opening two DIFFERENT repositories, opening a stream and disconnecting, must
// grow neither goroutines (D10) nor orphaned git processes (Linux, F15).
func TestMatrix_M3_NoGoroutineOrProcessGrowth(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	repoA, repoB := initTwoFixtureRepos(t)
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 10 * time.Millisecond

	var cycle int32
	iteration := func() {
		clientID := fmt.Sprintf("matrix-m3-cycle-%d", atomic.AddInt32(&cycle, 1))
		client := pairAndReady(t, server, sockPath, clientID)
		resA := openRepoOK(t, client, repoA)
		_ = openRepoOK(t, client, repoB)
		streamID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: resA.Repo.RepoID})
		client.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "cancel", ID: streamID}})
		_ = client.nc.Close()
		time.Sleep(30 * time.Millisecond) // past LingerFor, giving teardown a chance to run each cycle.
	}

	assertNoGoroutineGrowth(t, 20, iteration)

	if runtime.GOOS == "linux" {
		if n := countGitProcessesUnder(t, repoA) + countGitProcessesUnder(t, repoB); n != 0 {
			t.Fatalf("%d orphaned git processes remain after 20 open/page/close cycles across two repositories", n)
		}
	}
}

// --- M4: one window disconnects mid-operation ------------------------------------------------------

// TestMatrix_M4_DisconnectDuringRepoOpen is F1's own end-to-end reproduction, promoted to a
// permanent regression test: a repo.open sent immediately before the socket closes, without ever
// reading the response, must not leak the RepoEntry -- proven by a fresh watcher construction once
// the (correctly released) ref lingers out and expires.
func TestMatrix_M4_DisconnectDuringRepoOpen(t *testing.T) {
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 50 * time.Millisecond
	var watcherConstructions int32
	realNewWatcher := registry.NewWatcher
	registry.NewWatcher = func(s gitclient.RepoSummary) (gitsession.Watcher, error) {
		atomic.AddInt32(&watcherConstructions, 1)
		return realNewWatcher(s)
	}
	repoDir := initFixtureRepo(t)

	client := pairAndReady(t, server, sockPath, "m4-open-disconnect")
	id := client.next
	client.next++
	params, err := json.Marshal(gitrpc.RepoOpenParams{Path: repoDir})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	client.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "repo.open", Params: params}})
	_ = client.nc.Close() // disconnect WITHOUT ever reading repo.open's own response (F1).

	time.Sleep(500 * time.Millisecond) // comfortably past LingerFor(50ms) if the ref was released.

	client2 := pairAndReady(t, server, sockPath, "m4-open-disconnect-2")
	_ = openRepoOK(t, client2, repoDir)
	if got := atomic.LoadInt32(&watcherConstructions); got != 2 {
		t.Fatalf("watcher constructions after disconnect-during-open + reopen = %d, want 2 (a fresh RepoEntry -- F1's leak would keep the first one alive forever, holding constructions at 1)", got)
	}
}

// TestMatrix_M4_DisconnectDuringAWrite is SPEC §6/G5 D8's own end-to-end proof extended with a
// second, untouched window: a write in flight when its own connection disconnects still completes
// (an already-detached ctx), and a second connection observes the effect and is never disturbed.
func TestMatrix_M4_DisconnectDuringAWrite(t *testing.T) {
	f := buildOpsFixtureRepo(t)
	realRunner := gitclient.NewExecRunner()
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	blockingRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if !spec.ReadOnly && argvContains(spec.Args, "switch") {
			once.Do(func() { close(started) })
			<-release
		}
		return realRunner.Start(ctx, gitPath, spec)
	})

	server, sockPath, _, _ := newIntegrationServerWithRunner(t, blockingRunner)
	clientA := pairAndReady(t, server, sockPath, "m4-write-a")
	clientB := pairAndReady(t, server, sockPath, "m4-write-b")
	repoID := openRepoOK(t, clientA, f.dir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.dir).Repo.RepoID

	id := clientA.next
	clientA.next++
	params, err := json.Marshal(gitrpc.OpRunParams{RepoID: repoID, Op: gitsession.OpRequest{Kind: "checkout", Target: "sibling", Mode: "switch"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "op.run", Params: params}})
	<-started // the write spawn is now blocked mid-flight, inside the runner.

	_ = clientA.nc.Close() // A disconnects WHILE its own write is still running.
	close(release)         // let the (already-detached) write proceed regardless of the disconnect.

	refs := waitForHeadName(t, clientB, repoID, "sibling")
	if refs.Head.Kind != "branch" || refs.Head.Name != "sibling" {
		t.Fatalf("head after the disconnected-but-completed write = %+v", refs.Head)
	}
}

// TestMatrix_M4_DisconnectWithAStreamOpen: A opens graph.stream, grants partial credit, and
// disconnects mid-stream -- its own git log process and ref are released, and B's own independent
// stream on the same repository is entirely unaffected throughout.
func TestMatrix_M4_DisconnectWithAStreamOpen(t *testing.T) {
	dir, _ := initFixtureRepoWithCommits(t, 3)
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 50 * time.Millisecond
	var watcherConstructions int32
	realNewWatcher := registry.NewWatcher
	registry.NewWatcher = func(s gitclient.RepoSummary) (gitsession.Watcher, error) {
		atomic.AddInt32(&watcherConstructions, 1)
		return realNewWatcher(s)
	}

	clientA, clientB := pairTwoClients(t, server, sockPath)
	repoIDA := openRepoOK(t, clientA, dir).Repo.RepoID
	repoIDB := openRepoOK(t, clientB, dir).Repo.RepoID
	if got := atomic.LoadInt32(&watcherConstructions); got != 1 {
		t.Fatalf("watcher constructions after two opens of one repo = %d, want 1", got)
	}

	streamID := clientA.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoIDA})
	clientA.sendCredit(streamID, 1)
	_ = clientA.nc.Close() // A disconnects mid-stream.

	bStreamID := clientB.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoIDB})
	clientB.sendCredit(bStreamID, 10)
	drainStreamToEnd(t, clientB)

	closeResp := requestOK(t, clientB, "repo.close", gitrpc.RepoCloseParams{RepoID: repoIDB})
	if closeResp.T != "res" {
		t.Fatalf("repo.close: got %+v", closeResp)
	}

	time.Sleep(500 * time.Millisecond) // comfortably past LingerFor(50ms) once both A and B released.
	clientC := pairAndReady(t, server, sockPath, "m4-stream-probe")
	_ = openRepoOK(t, clientC, dir)
	if got := atomic.LoadInt32(&watcherConstructions); got != 2 {
		t.Fatalf("watcher constructions after disconnect-mid-stream + release + reopen = %d, want 2 (A's stream and ref were properly torn down)", got)
	}
}

// TestMatrix_M4_DisconnectDuringARemoteOp: A starts a fetch and disconnects -- the fetch is NOT
// killed (G7 D19), the slot frees only once it actually ends, and a second connection can then run
// its own remote op.
func TestMatrix_M4_DisconnectDuringARemoteOp(t *testing.T) {
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
	clientA := pairAndReady(t, server, sockPath, "m4-remote-a")
	repoID := openRepoOK(t, clientA, f.workDir).Repo.RepoID

	id := clientA.next
	clientA.next++
	params, err := json.Marshal(gitrpc.RemoteRunParams{RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})
	<-started

	_ = clientA.nc.Close() // A disconnects while its own fetch is still running.

	clientB := pairAndReady(t, server, sockPath, "m4-remote-b")
	_ = openRepoOK(t, clientB, f.workDir)
	busy := unmarshalResult[gitsession.RemoteOpResult](t, requestIgnoringEvents(t, clientB, "remote.run", gitrpc.RemoteRunParams{
		RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	}).Result)
	if busy.OK || busy.Error == nil || busy.Error.Kind != "OperationInProgress" {
		t.Fatalf("B's remote.run right after A's disconnect = %+v, want OperationInProgress (the fetch must survive the disconnect)", busy)
	}

	cancelResp := unmarshalResult[gitrpc.RemoteCancelResult](t, requestIgnoringEvents(t, clientB, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID}).Result)
	if !cancelResp.Cancelled {
		t.Fatal("cancelling the disconnected connection's still-running fetch reported false")
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
	t.Fatal("the shared slot never freed up after cancelling the disconnected connection's fetch")
}

// TestMatrix_M4_DisconnectDuringACredentialPrompt adds the half G7's own disconnect-mid-prompt test
// does not cover (per the plan's own note): B, live on the same repository throughout, can
// immediately run and answer its own prompted fetch once A's disconnect frees the slot.
func TestMatrix_M4_DisconnectDuringACredentialPrompt(t *testing.T) {
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
	clientA := pairAndReady(t, server, sockPath, "m4-cred-a")
	clientB := pairAndReady(t, server, sockPath, "m4-cred-b")
	repoID := openRepoOK(t, clientA, dir).Repo.RepoID
	_ = openRepoOK(t, clientB, dir).Repo.RepoID

	params, err := json.Marshal(gitrpc.RemoteRunParams{
		RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	id := clientA.next
	clientA.next++
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})
	_ = clientA.recvEvent("credential.request") // wait for the prompt to actually arrive.
	_ = clientA.nc.Close()                      // A disconnects WITHOUT answering.

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		result := runRemoteAnsweringCredentials(t, clientB, gitrpc.RemoteRunParams{
			RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		}, strPtr("does-not-matter"))
		if result.Error != nil && result.Error.Kind == "OperationInProgress" {
			time.Sleep(20 * time.Millisecond)
			continue
		}
		if result.OK || result.Error == nil || result.Error.Kind != "AuthFailed" {
			t.Fatalf("B's own prompted fetch = %+v, want AuthFailed (the test server always denies)", result)
		}
		return
	}
	t.Fatal("B was never able to run its own remote op after A disconnected mid-prompt")
}
