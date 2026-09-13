package gitsock

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// §3.8's own M6: stale-socket recovery across a real SIGKILL, proven in this container for the
// first time (D11/F14) — G1 §8.1(b) item 7 only ever proved the in-process half (a second
// Server.Start() in the SAME process). Every test here begins TestRecovery so D16's own `-count=10`
// filter is exact.

// TestRecovery_AfterSIGKILLWithRepositoriesOpen is D11's full sequence: a real helper process is
// SIGKILLed with a repository genuinely open (a watcher, a subscriber pump, a persistent cat-file
// pair), and a fresh Server against the same KIRA_HOME recovers cleanly.
func TestRecovery_AfterSIGKILLWithRepositoriesOpen(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	kiraHome := t.TempDir()
	// The helper process gets KIRA_HOME through its own env (launchGitsockHelper); this process
	// needs it too, since the "fresh Server" built below calls storage.Open() itself and must find
	// the SAME kira.db the killed helper created (config.KiraHome falls back to a real
	// $HOME/.kira-studio otherwise -- exactly the state this phase must never touch, G4 D15's own
	// rule extended to KIRA_HOME).
	t.Setenv("KIRA_HOME", kiraHome)
	repoDir := initFixtureRepo(t)
	sockPath := filepath.Join(kiraHome, "git.sock")

	cmd := launchGitsockHelper(t, kiraHome, repoDir)
	if _, err := os.Stat(sockPath); err != nil {
		t.Fatalf("socket file missing after the helper reported READY: %v", err)
	}

	killAndReap(t, cmd)

	// acquireLock's own flock is on an fd the kernel releases on process death; nothing runs
	// net.UnixListener.Close, so the inode itself must still be there.
	if _, err := os.Stat(sockPath); err != nil {
		t.Fatalf("socket file gone after a SIGKILL -- nothing should have unlinked it: %v", err)
	}

	gitRunner := gitclient.NewExecRunner()
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = repositories.Close() })
	gitDiscovery := gitclient.NewDiscovery(lookPathLocator{}, gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
	server := New(Deps{
		SocketPath: sockPath,
		LockPath:   filepath.Join(kiraHome, "git.sock.lock"),
		Clients:    repositories.GitClients,
		Registry:   gitRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: "recovery",
		}),
		ServerVersion: "recovery",
		Now:           time.Now,
	})
	if err := server.Start(); err != nil {
		t.Fatalf("Start after a hard kill of the previous instance: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })
	if !isListening(server) {
		t.Fatal("the fresh Server did not actually listen after a hard kill of the previous instance -- the dead process's flock must have been released by the kernel")
	}

	client := pairAndReady(t, server, sockPath, "recovery-client")
	result := openRepoOK(t, client, repoDir)
	if result.Kind != "ok" || result.Repo == nil {
		t.Fatalf("repo.open after recovery: got %+v", result)
	}
	if result.Repo.Head.Kind == "" {
		t.Fatalf("repo.open after recovery returned an incomplete summary: %+v", result.Repo)
	}

	if runtime.GOOS == "linux" {
		deadline := time.Now().Add(5 * time.Second)
		var n int
		for time.Now().Before(deadline) {
			n = countGitProcessesUnder(t, repoDir)
			if n == 0 {
				break
			}
			time.Sleep(50 * time.Millisecond)
		}
		if n != 0 {
			t.Fatalf("%d orphaned git processes remain under the fixture repo after a hard kill (F15)", n)
		}
	}
}

// TestRecovery_SecondInstanceDoesNotListenOrUnlink re-asserts G1 D5's in-process property now that
// a Registry with a live watcher and an open stream is actually attached (G1's own version predates
// all of it) — a second Start() against the same KIRA_HOME must neither listen nor disturb the
// first instance's socket, its live connection, or its open walk.
func TestRecovery_SecondInstanceDoesNotListenOrUnlink(t *testing.T) {
	server, sockPath, clientsRepo, _ := newIntegrationServer(t)
	repoDir := initFixtureRepo(t)
	client := pairAndReady(t, server, sockPath, "recovery-second-instance")
	repoID := openRepoOK(t, client, repoDir).Repo.RepoID
	streamID := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
	client.sendCredit(streamID, 10)
	drainStreamToEnd(t, client)

	secondRunner := gitclient.NewExecRunner()
	secondRegistry := gitsession.NewRegistry(secondRunner)
	second := New(Deps{
		SocketPath: sockPath,
		LockPath:   filepath.Join(filepath.Dir(sockPath), "git.sock.lock"),
		Clients:    clientsRepo,
		Registry:   secondRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitclient.NewDiscovery(lookPathLocator{}, secondRunner, gitclient.NewRealClock()),
			Runner:    secondRunner, Registry: secondRegistry, ServerVersion: "second",
		}),
		ServerVersion: "second",
		Now:           time.Now,
	})
	if err := second.Start(); err != nil {
		t.Fatalf("second Start: %v", err)
	}
	defer second.Close()
	if isListening(second) {
		t.Fatal("a second instance against the same KIRA_HOME must not listen")
	}

	client2 := dialTestClient(t, sockPath)
	client2.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "still-first-instance", Label: "still first", PID: os.Getpid(), AppVersion: "test"},
	})
	resp := client2.recvHandshake()
	if resp.Kind != "pairingRequired" {
		t.Fatalf("first server after a second Start: got %q -- the second instance must not have disturbed it", resp.Kind)
	}
	if got := server.Broker().Deny(resp.RequestID); got != PairingActionResolved {
		t.Fatalf("deny: got %v", got)
	}

	// The original connection's own live walk is entirely undisturbed.
	statusResp := requestIgnoringEvents(t, client, "graph.status", gitrpc.GraphStatusParams{RepoID: repoID})
	if statusResp.T != "res" {
		t.Fatalf("original client's graph.status after a second Start: got %+v", statusResp)
	}
}

// TestRecovery_StaleAskpassDirectoryIsInert is D13(f): a kira-askpass-* directory left behind by a
// crash does not prevent a fresh broker from starting or a remote op from running. No startup sweep
// exists for it, and none is added -- it is 0700, its own socket died with its process, and the OS
// reaps $TMPDIR on its own schedule.
func TestRecovery_StaleAskpassDirectoryIsInert(t *testing.T) {
	staleDir, err := os.MkdirTemp("", "kira-askpass-*")
	if err != nil {
		t.Fatalf("mkdir stale askpass dir: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(staleDir) })
	if err := os.Chmod(staleDir, 0o700); err != nil {
		t.Fatalf("chmod: %v", err)
	}

	f := buildRemoteFixture(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 3*time.Second)
	client := pairAndReady(t, server, sockPath, "recovery-askpass")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	resp := requestOK(t, client, "remote.run", gitrpc.RemoteRunParams{
		RepoID: repoID, RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	})
	result := unmarshalResult[gitsession.RemoteOpResult](t, resp.Result)
	if !result.OK {
		t.Fatalf("fetch with a stale kira-askpass-* directory present in $TMPDIR failed: %+v", result)
	}
}

// TestRecovery_NoOrphanedGitChildren is F15's own pin, Linux-only: a real SIGKILL of a process
// holding a persistent cat-file pair must leave no git process running under the fixture repo.
func TestRecovery_NoOrphanedGitChildren(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("TestRecovery_NoOrphanedGitChildren: /proc is Linux-only")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	kiraHome := t.TempDir()
	repoDir := initFixtureRepo(t)

	cmd := launchGitsockHelper(t, kiraHome, repoDir)
	killAndReap(t, cmd)

	// F15's own reasoning: every long-lived child this chapter spawns is attached to its parent by
	// a pipe, so a SIGKILLed parent closes those fds and the child sees EOF/SIGPIPE on its own next
	// write -- "should" is exactly what this test is for. Poll briefly for the kernel to finish.
	deadline := time.Now().Add(5 * time.Second)
	var n int
	for time.Now().Before(deadline) {
		n = countGitProcessesUnder(t, repoDir)
		if n == 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("%d git process(es) under %s survived a SIGKILL of their parent", n, repoDir)
}
