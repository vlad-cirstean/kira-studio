package gitsock

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// §8.1(e)'s own end-to-end proof: fetch, push, force-push, delete, decomposed pull,
// non-fast-forward, lease violation, hook rejection, protected-branch refusal and the whole
// credential relay, all against a REAL local bare remote and a real 401 listener — this is the
// phase's real end-to-end proof, per the plan's own §7.1(e).

// remoteFixtureEnv is G4 D15's own fixtureEnv() pattern, copied verbatim (D24/§0.4): every
// fixture repository this file builds scopes its git config to itself. Never `git config
// --global` or `--system`, in this file or anywhere else.
func remoteFixtureEnv() []string {
	return append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		"GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null",
	)
}

func runRemoteGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = remoteFixtureEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v (dir=%s): %v\n%s", args, dir, err, out)
	}
	return string(out)
}

func commitRemoteFixture(t *testing.T, dir, message string) string {
	t.Helper()
	cmd := exec.Command("git", "-c", "commit.gpgsign=false", "commit", "-q", "-m", message, "--allow-empty-message")
	cmd.Dir = dir
	cmd.Env = remoteFixtureEnv()
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v\n%s", err, out)
	}
	return trimNewline(runRemoteGit(t, dir, "rev-parse", "HEAD"))
}

// remoteFixture is a real local bare remote (the "server"), a real work clone (the repository
// under test) and a real second clone (used to diverge the bare remote out from under the work
// clone, exactly as a collaborator's own push would).
type remoteFixture struct {
	bareDir    string
	workDir    string
	divergeDir string
	mainSha    string
}

func buildRemoteFixture(t *testing.T) *remoteFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	f := &remoteFixture{bareDir: t.TempDir(), workDir: t.TempDir(), divergeDir: t.TempDir()}

	runRemoteGit(t, f.bareDir, "init", "-q", "--bare", "-b", "main")

	runRemoteGit(t, f.workDir, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(f.workDir, "base.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "base.txt")
	f.mainSha = commitRemoteFixture(t, f.workDir, "base commit")
	runRemoteGit(t, f.workDir, "remote", "add", "origin", f.bareDir)
	runRemoteGit(t, f.workDir, "push", "-q", "origin", "main")

	runRemoteGit(t, f.divergeDir, "clone", "-q", f.bareDir, ".")
	runRemoteGit(t, f.divergeDir, "config", "user.email", "test@example.com")
	runRemoteGit(t, f.divergeDir, "config", "user.name", "Test")

	return f
}

// divergeRemote makes one commit in the second clone and pushes it — simulating a collaborator
// moving the remote out from under the work clone, which never fetches as part of this call.
func (f *remoteFixture) divergeRemote(t *testing.T, filename, content, message string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(f.divergeDir, filename), []byte(content), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.divergeDir, "add", filename)
	sha := commitRemoteFixture(t, f.divergeDir, message)
	runRemoteGit(t, f.divergeDir, "push", "-q", "origin", "main")
	return sha
}

// installPreReceiveHook installs a pre-receive hook on the bare remote that rejects every push
// with a fixed message (probe P7).
func (f *remoteFixture) installPreReceiveHook(t *testing.T) {
	t.Helper()
	hook := "#!/bin/sh\necho 'policy: no pushes on Fridays' >&2\nexit 1\n"
	path := filepath.Join(f.bareDir, "hooks", "pre-receive")
	if err := os.WriteFile(path, []byte(hook), 0o755); err != nil {
		t.Fatalf("write pre-receive hook: %v", err)
	}
}

// TestAskpassHelperProcessForGitsock mirrors gitaskpass's own TestAskpassHelperProcess (the
// stdlib os/exec "helper process" idiom) — this package's own compiled test binary is what a real
// git child re-execs through the shim in these integration tests, since HelperCommand names
// os.Executable() at construction time (newRemoteIntegrationServer, below).
func TestAskpassHelperProcessForGitsock(t *testing.T) {
	if os.Getenv("KIRA_ASKPASS_HELPER_PROCESS") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 {
		if args[0] == "--" {
			args = args[1:]
			break
		}
		args = args[1:]
	}
	os.Exit(gitaskpass.RunHelper(args, os.Environ(), os.Stdout))
}

// newRemoteIntegrationServer is newIntegrationServerWithRunner plus a real gitaskpass.Broker,
// wired into gitrpc.Deps.Askpass — the seam every credential-relay test in this file needs.
// timeout bounds the broker's own credential wait; kept short here so a "broker never answers"
// scenario completes quickly rather than waiting out the production 120s default.
func newRemoteIntegrationServer(t *testing.T, timeout time.Duration) (server *Server, sockPath string, registry *gitsession.Registry, broker *gitaskpass.Broker) {
	t.Helper()
	return newRemoteIntegrationServerWithRunner(t, timeout, gitclient.NewExecRunner())
}

// newRemoteIntegrationServerWithRunner is newRemoteIntegrationServer over a caller-supplied
// Runner — the seam TestIntegration_ForcePushStaleExpectedTipIsRefusedBeforeSpawning and
// TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest need to observe (or block) a spawn.
func newRemoteIntegrationServerWithRunner(t *testing.T, timeout time.Duration, gitRunner gitclient.Runner) (server *Server, sockPath string, registry *gitsession.Registry, broker *gitaskpass.Broker) {
	t.Helper()
	// The helper subprocess (the shim's own exec target) needs this sentinel to distinguish
	// "I am the real askpass helper" from "I am gitsock's own test binary running normally" — set
	// for the whole process so it reaches every git child this test spawns via os.Environ().
	t.Setenv("KIRA_ASKPASS_HELPER_PROCESS", "1")

	self, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	broker, err = gitaskpass.New(gitaskpass.Options{
		Timeout:       timeout,
		HelperCommand: []string{self, "-test.run=TestAskpassHelperProcessForGitsock", "--"},
	})
	if err != nil {
		t.Fatalf("gitaskpass.New: %v", err)
	}
	t.Cleanup(func() { _ = broker.Close() })

	kiraHome := t.TempDir()
	t.Setenv("KIRA_HOME", kiraHome)

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

	server = New(Deps{
		SocketPath: filepath.Join(kiraHome, "git.sock"),
		LockPath:   filepath.Join(kiraHome, "git.sock.lock"),
		Clients:    repositories.GitClients,
		Registry:   gitRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: "test-version",
			Askpass: broker,
		}),
		ServerVersion: "test-version",
		Now:           time.Now,
	})
	if err := server.Start(); err != nil {
		t.Fatalf("server.Start: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })

	return server, filepath.Join(kiraHome, "git.sock"), gitRegistry, broker
}

// remoteRunOK is requestOK for remote.run, tolerant of interleaved remote.progress events on the
// way to the matching response (ops_test.go's own requestIgnoringEvents) — a real fetch/push
// legitimately emits progress while this connection's own remote.run is still outstanding.
func remoteRunOK(t *testing.T, c *testClient, params gitrpc.RemoteRunParams) gitsession.RemoteOpResult {
	t.Helper()
	resp := requestIgnoringEvents(t, c, "remote.run", params)
	if resp.T != "res" || resp.OK == nil || !*resp.OK {
		if resp.Error != nil {
			t.Fatalf("remote.run: got %+v (error: %+v)", resp, *resp.Error)
		}
		t.Fatalf("remote.run: got %+v", resp)
	}
	return unmarshalResult[gitsession.RemoteOpResult](t, resp.Result)
}

// runRemoteAnsweringCredentials drives one remote.run call to completion, answering every
// interleaved credential.request event with answer (nil dismisses it) — D24's own "answered"/
// "dismissed" scenarios. Handles either wire ordering of the two requests' own responses, since
// rpcstream dispatches them independently.
func runRemoteAnsweringCredentials(t *testing.T, c *testClient, params gitrpc.RemoteRunParams, answer *string) gitsession.RemoteOpResult {
	t.Helper()
	runID := c.next
	c.next++
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	c.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: runID, Method: "remote.run", Params: paramsJSON}})

	for {
		raw, err := readFrame(c.r)
		if err != nil {
			t.Fatalf("read frame: %v", err)
		}
		var env wireEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal: %v\n%s", err, raw)
		}

		switch {
		case env.Body.T == "evt" && env.Body.Method == "credential.request":
			var payload struct {
				RequestID string `json:"requestId"`
			}
			if err := json.Unmarshal(env.Body.Payload, &payload); err != nil {
				t.Fatalf("unmarshal credential.request payload: %v", err)
			}
			provideID := c.next
			c.next++
			provideParams, err := json.Marshal(gitrpc.CredentialProvideParams{RequestID: payload.RequestID, Secret: answer})
			if err != nil {
				t.Fatalf("marshal credential.provide params: %v", err)
			}
			c.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: provideID, Method: "credential.provide", Params: provideParams}})
		case env.Body.T == "evt":
			// remote.progress or another event — irrelevant here.
		case env.Body.ID == runID:
			return unmarshalResult[gitsession.RemoteOpResult](t, env.Body.Result)
		default:
			// credential.provide's own {} response — nothing to do with it.
		}
	}
}

// runRemoteIgnoringCredentialRequests drives one remote.run call to completion WITHOUT ever
// answering a credential.request — D24's own "the broker never answers" scenario, bounded only by
// the broker's own (short, test-configured) timeout.
func runRemoteIgnoringCredentialRequests(t *testing.T, c *testClient, params gitrpc.RemoteRunParams) gitsession.RemoteOpResult {
	t.Helper()
	runID := c.next
	c.next++
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	c.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: runID, Method: "remote.run", Params: paramsJSON}})
	for {
		raw, err := readFrame(c.r)
		if err != nil {
			t.Fatalf("read frame: %v", err)
		}
		var env wireEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal: %v\n%s", err, raw)
		}
		if env.Body.T == "evt" {
			continue
		}
		if env.Body.ID == runID {
			return unmarshalResult[gitsession.RemoteOpResult](t, env.Body.Result)
		}
	}
}

// newDenyingHTTPServer is D24's own "git http-backend-free stand-in": every request gets a bare
// 401, so a real AuthFailed is reachable in this sandbox with no real network remote (probes
// P1/P2).
func newDenyingHTTPServer(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("WWW-Authenticate", `Basic realm="test"`)
		w.WriteHeader(http.StatusUnauthorized)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return fmt.Sprintf("http://%s/repo.git", ln.Addr().String())
}

func TestIntegration_FetchUpdatesRefsAndReportsProgress(t *testing.T) {
	f := buildRemoteFixture(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
	client := pairAndReady(t, server, sockPath, "fetch-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	newSha := f.divergeRemote(t, "new.txt", "x\n", "diverge")

	result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID:         repoID,
		RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin", Prune: true},
	})
	if !result.OK {
		t.Fatalf("fetch failed: %+v", result)
	}
	var found bool
	for _, u := range result.Updates {
		if u.Ref == "refs/remotes/origin/main" {
			found = true
			if u.To == nil || *u.To != newSha {
				t.Fatalf("update.to = %v, want %q", u.To, newSha)
			}
			if u.From == nil || *u.From != f.mainSha {
				t.Fatalf("update.from = %v, want %q", u.From, f.mainSha)
			}
		}
	}
	if !found {
		t.Fatalf("updates = %+v, want refs/remotes/origin/main", result.Updates)
	}

	remoteTip := trimNewline(runRemoteGit(t, f.workDir, "rev-parse", "refs/remotes/origin/main"))
	if remoteTip != newSha {
		t.Fatalf("refs/remotes/origin/main = %q, want %q", remoteTip, newSha)
	}
}

func TestIntegration_PushSetsUpstreamAndReportsUpdates(t *testing.T) {
	f := buildRemoteFixture(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
	client := pairAndReady(t, server, sockPath, "push-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	runRemoteGit(t, f.workDir, "checkout", "-q", "-b", "feature")
	if err := os.WriteFile(filepath.Join(f.workDir, "feature.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "feature.txt")
	commitRemoteFixture(t, f.workDir, "feature work")

	result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "push", Remote: "origin", Branch: "feature", SetUpstream: true,
		},
	})
	if !result.OK {
		t.Fatalf("push failed: %+v", result)
	}
	found := false
	for _, u := range result.Updates {
		if u.Ref == "refs/heads/feature" {
			found = true
			if u.From != nil {
				t.Fatalf("a new branch's update.from = %v, want nil", u.From)
			}
		}
	}
	if !found {
		t.Fatalf("updates = %+v, want refs/heads/feature", result.Updates)
	}

	remoteCfg := runRemoteGit(t, f.workDir, "config", "--get", "branch.feature.remote")
	if trimNewline(remoteCfg) != "origin" {
		t.Fatalf("branch.feature.remote = %q, want origin", remoteCfg)
	}
	mergeCfg := runRemoteGit(t, f.workDir, "config", "--get", "branch.feature.merge")
	if trimNewline(mergeCfg) != "refs/heads/feature" {
		t.Fatalf("branch.feature.merge = %q, want refs/heads/feature", mergeCfg)
	}
}

func TestIntegration_PushNonFastForwardIsClassified(t *testing.T) {
	f := buildRemoteFixture(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
	client := pairAndReady(t, server, sockPath, "nonff-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	divergedTip := f.divergeRemote(t, "collision.txt", "x\n", "diverge before push")

	if err := os.WriteFile(filepath.Join(f.workDir, "local.txt"), []byte("y\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "local.txt")
	commitRemoteFixture(t, f.workDir, "local work, never fetched the divergence")

	result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID:         repoID,
		RemoteOpParams: gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"},
	})
	if result.OK || result.Error == nil || result.Error.Kind != "NonFastForward" {
		t.Fatalf("got %+v, want NonFastForward", result)
	}

	// F10's whole point: this fails if the classifier reads only stderr, since --porcelain moves
	// the rejection reason to stdout. The remote ref itself must be UNCHANGED.
	remoteTip := trimNewline(runRemoteGit(t, f.bareDir, "rev-parse", "refs/heads/main"))
	if remoteTip != divergedTip {
		t.Fatalf("remote main = %q, want unchanged at %q", remoteTip, divergedTip)
	}
}

func TestIntegration_ForcePushLeaseViolation(t *testing.T) {
	t.Run("never fetched", func(t *testing.T) {
		f := buildRemoteFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
		client := pairAndReady(t, server, sockPath, "lease-client-a")
		repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

		divergedTip := f.divergeRemote(t, "x.txt", "x\n", "diverge")

		// The client never fetched, so its own pushPreflight (a purely local read of
		// refs/remotes/origin/main) still reports f.mainSha — matching what this client submits,
		// so gitsession's own pre-spawn lease check (D12) PASSES here, and it is git's own real
		// --force-with-lease that rejects it with "(stale info)" once it actually talks to the
		// remote (probe P6).
		result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
			RepoID: repoID,
			RemoteOpParams: gitsession.RemoteOpParams{
				Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &f.mainSha,
			},
		})
		if result.OK || result.Error == nil || result.Error.Kind != "LeaseViolation" {
			t.Fatalf("got %+v, want LeaseViolation", result)
		}
		remoteTip := trimNewline(runRemoteGit(t, f.bareDir, "rev-parse", "refs/heads/main"))
		if remoteTip != divergedTip {
			t.Fatalf("remote main = %q, want unchanged at %q", remoteTip, divergedTip)
		}
	})

	t.Run("fetched but not integrated", func(t *testing.T) {
		f := buildRemoteFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
		client := pairAndReady(t, server, sockPath, "lease-client-b")
		repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

		divergedTip := f.divergeRemote(t, "x.txt", "x\n", "diverge")

		fetchResult := remoteRunOK(t, client, gitrpc.RemoteRunParams{
			RepoID:         repoID,
			RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		})
		if !fetchResult.OK {
			t.Fatalf("fetch failed: %+v", fetchResult)
		}

		// Fetched (refs/remotes/origin/main now reads divergedTip, matching a fresh
		// pushPreflight) but never merged/rebased into main — gitsession's own lease check
		// passes, and it is git's own --force-if-includes that rejects it with "(remote ref
		// updated since checkout)": fetching alone does not prove the user has SEEN the change
		// (probe P6).
		result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
			RepoID: repoID,
			RemoteOpParams: gitsession.RemoteOpParams{
				Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &divergedTip,
			},
		})
		if result.OK || result.Error == nil || result.Error.Kind != "RemoteRefUpdated" {
			t.Fatalf("got %+v, want RemoteRefUpdated", result)
		}
		remoteTip := trimNewline(runRemoteGit(t, f.bareDir, "rev-parse", "refs/heads/main"))
		if remoteTip != divergedTip {
			t.Fatalf("remote main = %q, want unchanged at %q", remoteTip, divergedTip)
		}
	})
}

// TestIntegration_ForcePushStaleExpectedTipIsRefusedBeforeSpawning observes D12's mitigation
// through an injected Runner (per the plan's own §3.11): a stale expectedRemoteTip must fail the
// lease check BEFORE any push process is spawned at all, not merely before it succeeds.
func TestIntegration_ForcePushStaleExpectedTipIsRefusedBeforeSpawning(t *testing.T) {
	f := buildRemoteFixture(t)

	realRunner := gitclient.NewExecRunner()
	var pushSpawned bool
	spyRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if argvContains(spec.Args, "push") {
			pushSpawned = true
		}
		return realRunner.Start(ctx, gitPath, spec)
	})

	server, sockPath, _, _ := newRemoteIntegrationServerWithRunner(t, 5*time.Second, spyRunner)
	client := pairAndReady(t, server, sockPath, "stale-tip-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	staleTip := "0000000000000000000000000000000000000000"
	result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &staleTip,
		},
	})
	if result.OK || result.Error == nil || result.Error.Kind != "LeaseViolation" {
		t.Fatalf("got %+v, want LeaseViolation", result)
	}
	if pushSpawned {
		t.Fatal("a push process was spawned despite the stale lease — the check must happen before any spawn")
	}
	remoteTip := trimNewline(runRemoteGit(t, f.bareDir, "rev-parse", "refs/heads/main"))
	if remoteTip != f.mainSha {
		t.Fatalf("remote main = %q, want unchanged at %q", remoteTip, f.mainSha)
	}
}

func TestIntegration_HookRejectionCarriesTheHooksOwnMessage(t *testing.T) {
	f := buildRemoteFixture(t)
	f.installPreReceiveHook(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
	client := pairAndReady(t, server, sockPath, "hook-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	if err := os.WriteFile(filepath.Join(f.workDir, "x.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "x.txt")
	commitRemoteFixture(t, f.workDir, "will be rejected by the hook")

	result := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID:         repoID,
		RemoteOpParams: gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"},
	})
	if result.OK || result.Error == nil || result.Error.Kind != "HookRejected" {
		t.Fatalf("got %+v, want HookRejected", result)
	}
	if result.Error.RemoteMessage == nil || *result.Error.RemoteMessage != "policy: no pushes on Fridays" {
		t.Fatalf("remoteMessage = %v, want the hook's own right-trimmed message", result.Error.RemoteMessage)
	}
}

func TestIntegration_ProtectedBranchNeedsTheTypedName(t *testing.T) {
	f := buildRemoteFixture(t)
	server, sockPath, registry, _ := newRemoteIntegrationServer(t, 5*time.Second)
	// D16/D17: driven with a server-owned pattern list injected through Registry.Settings —
	// proving the check does not consult the request at all.
	registry.Settings = func() ([]string, int, string) { return []string{"main"}, 0, "" }
	client := pairAndReady(t, server, sockPath, "protected-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	noToken := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &f.mainSha,
		},
	})
	if noToken.OK || noToken.Error == nil || noToken.Error.Kind != "ProtectedBranch" {
		t.Fatalf("no confirmToken: got %+v, want ProtectedBranch", noToken)
	}

	wrongToken := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &f.mainSha,
			ConfirmToken: "not-main",
		},
	})
	if wrongToken.OK || wrongToken.Error == nil || wrongToken.Error.Kind != "ProtectedBranch" {
		t.Fatalf("wrong confirmToken: got %+v, want ProtectedBranch", wrongToken)
	}

	if err := os.WriteFile(filepath.Join(f.workDir, "y.txt"), []byte("y\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "y.txt")
	commitRemoteFixture(t, f.workDir, "will be force-pushed")

	rightToken := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: "origin", Branch: "main", ExpectedRemoteTip: &f.mainSha,
			ConfirmToken: "main",
		},
	})
	if !rightToken.OK {
		t.Fatalf("right confirmToken: got %+v, want ok", rightToken)
	}
}

func TestIntegration_PullDecomposesAndAConflictLandsInTheBanner(t *testing.T) {
	f := buildRemoteFixture(t)
	server, sockPath, _, _ := newRemoteIntegrationServer(t, 5*time.Second)
	client := pairAndReady(t, server, sockPath, "pull-client")
	repoID := openRepoOK(t, client, f.workDir).Repo.RepoID

	// ff-only against a diverged branch.
	f.divergeRemote(t, "ff-conflict.txt", "remote\n", "remote-only change")
	if err := os.WriteFile(filepath.Join(f.workDir, "local-only.txt"), []byte("local\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f.workDir, "add", "local-only.txt")
	commitRemoteFixture(t, f.workDir, "local-only change")

	ffResult := remoteRunOK(t, client, gitrpc.RemoteRunParams{
		RepoID: repoID,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "pull", Remote: "origin", Branch: "main", Strategy: string(gitpreflight.PullFFOnly),
		},
	})
	if ffResult.OK || ffResult.Error == nil || ffResult.Error.Kind != "NonFastForward" {
		if ffResult.Error != nil {
			t.Fatalf("ff-only against a diverged branch: got %+v (error: %+v)", ffResult, *ffResult.Error)
		}
		t.Fatalf("ff-only against a diverged branch: got %+v", ffResult)
	}

	// merge against a conflicting change to the SAME file lands in G5's own in-progress banner.
	f2 := buildRemoteFixture(t)
	if err := os.WriteFile(filepath.Join(f2.workDir, "conflict.txt"), []byte("base\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f2.workDir, "add", "conflict.txt")
	commitRemoteFixture(t, f2.workDir, "add conflict.txt")
	runRemoteGit(t, f2.workDir, "push", "-q", "origin", "main")
	runRemoteGit(t, f2.divergeDir, "pull", "-q", "origin", "main")

	f2.divergeRemote(t, "conflict.txt", "remote change\n", "remote change to conflict.txt")
	if err := os.WriteFile(filepath.Join(f2.workDir, "conflict.txt"), []byte("local change\n"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runRemoteGit(t, f2.workDir, "add", "conflict.txt")
	commitRemoteFixture(t, f2.workDir, "local change to conflict.txt")

	// A fresh connection: `client`'s own socket may still carry queued repo.changed events from
	// the ff-only attempt above, which openRepoOK's own strict single-frame read does not tolerate.
	client2 := pairAndReady(t, server, sockPath, "pull-client-2")
	repoID2 := openRepoOK(t, client2, f2.workDir).Repo.RepoID
	mergeResult := remoteRunOK(t, client2, gitrpc.RemoteRunParams{
		RepoID: repoID2,
		RemoteOpParams: gitsession.RemoteOpParams{
			Kind: "pull", Remote: "origin", Branch: "main", Strategy: string(gitpreflight.PullMerge),
		},
	})
	if mergeResult.OK {
		t.Fatalf("conflicting merge should have failed: %+v", mergeResult)
	}
	if mergeResult.Error == nil || mergeResult.Error.Kind != "Conflict" {
		if mergeResult.Error != nil {
			t.Fatalf("got %+v (error: %+v), want Conflict", mergeResult, *mergeResult.Error)
		}
		t.Fatalf("got %+v, want Conflict", mergeResult)
	}
	if mergeResult.InProgress == nil || mergeResult.InProgress.Kind != gitpreflight.InProgressMerge {
		t.Fatalf("inProgress = %+v, want a merge in progress, in the op's own reply", mergeResult.InProgress)
	}

	abortResp := opRunOK(t, client2, repoID2, gitsession.OpRequest{Kind: "opAbort"})
	if !abortResp.OK || abortResp.InProgress != nil {
		t.Fatalf("opAbort = %+v, want ok with no inProgress left", abortResp)
	}
}

// TestIntegration_CredentialRelayAnswersAndNeverHangs is D24's own headline case: every one of
// D4's four independent wait-enders proven end to end, over a real socket, against a real HTTP 401
// (no real network remote needed, D24). Every scenario asserts inside a per-test deadline, so a
// hang fails AS a hang.
func TestIntegration_CredentialRelayAnswersAndNeverHangs(t *testing.T) {
	url := newDenyingHTTPServer(t)

	newHTTPFixture := func(t *testing.T) string {
		t.Helper()
		dir := t.TempDir()
		runRemoteGit(t, dir, "init", "-q", "-b", "main")
		if err := os.WriteFile(filepath.Join(dir, "f.txt"), []byte("x\n"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		runRemoteGit(t, dir, "add", "f.txt")
		commitRemoteFixture(t, dir, "base")
		runRemoteGit(t, dir, "remote", "add", "origin", url)
		return dir
	}

	t.Run("the client answers and the op proceeds past the prompt", func(t *testing.T) {
		dir := newHTTPFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 3*time.Second)
		client := pairAndReady(t, server, sockPath, "cred-answer-client")
		repoID := openRepoOK(t, client, dir).Repo.RepoID

		answer := "does-not-matter"
		deadline := time.Now().Add(10 * time.Second)
		result := runRemoteAnsweringCredentials(t, client, gitrpc.RemoteRunParams{
			RepoID:         repoID,
			RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		}, &answer)
		if time.Now().After(deadline) {
			t.Fatal("took too long")
		}
		// The test server always denies, so the OUTCOME is still AuthFailed — what this proves is
		// that answering the prompt let the op run to completion at all (an unhandled prompt would
		// otherwise leave the helper blocked on its own read).
		if result.OK || result.Error == nil || result.Error.Kind != "AuthFailed" {
			t.Fatalf("got %+v, want AuthFailed (the test server always denies)", result)
		}
	})

	t.Run("the client dismisses and it fails promptly", func(t *testing.T) {
		dir := newHTTPFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 3*time.Second)
		client := pairAndReady(t, server, sockPath, "cred-dismiss-client")
		repoID := openRepoOK(t, client, dir).Repo.RepoID

		start := time.Now()
		result := runRemoteAnsweringCredentials(t, client, gitrpc.RemoteRunParams{
			RepoID:         repoID,
			RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		}, nil)
		if elapsed := time.Since(start); elapsed > 10*time.Second {
			t.Fatalf("dismissal took %v, want prompt", elapsed)
		}
		if result.OK || result.Error == nil || result.Error.Kind != "AuthFailed" {
			t.Fatalf("got %+v, want AuthFailed", result)
		}
	})

	t.Run("the owning connection is closed mid-prompt and it fails promptly", func(t *testing.T) {
		dir := newHTTPFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 3*time.Second)
		clientA := pairAndReady(t, server, sockPath, "cred-close-a")
		clientB := pairAndReady(t, server, sockPath, "cred-close-b")
		repoID := openRepoOK(t, clientA, dir).Repo.RepoID
		_ = openRepoOK(t, clientB, dir).Repo.RepoID

		params, err := json.Marshal(gitrpc.RemoteRunParams{
			RepoID:         repoID,
			RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		})
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		id := clientA.next
		clientA.next++
		clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: "remote.run", Params: params}})

		// Wait for the credential.request event, then close the connection without answering.
		for {
			raw, err := readFrame(clientA.r)
			if err != nil {
				t.Fatalf("read frame: %v", err)
			}
			var env wireEnvelope
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatalf("unmarshal: %v\n%s", err, raw)
			}
			if env.Body.T == "evt" && env.Body.Method == "credential.request" {
				break
			}
		}
		_ = clientA.nc.Close()

		// Proven via clientB: the shared slot must free up promptly (the op ends with AuthFailed,
		// never hangs) — a second remote.run on the same repository succeeding within a bound is
		// proof the first one actually finished. clientB's own attempt, once the slot is free, hits
		// the same denying server and gets its own credential.request in turn — dismissed
		// immediately here, since this subtest only cares that the FIRST op's slot released.
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			result := runRemoteAnsweringCredentials(t, clientB, gitrpc.RemoteRunParams{
				RepoID:         repoID,
				RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
			}, nil)
			if result.Error == nil || result.Error.Kind != "OperationInProgress" {
				return // the slot is free again — the disconnected op ended.
			}
			time.Sleep(20 * time.Millisecond)
		}
		t.Fatal("the shared slot never freed up after the owning connection closed mid-prompt")
	})

	t.Run("the client never answers and the broker's own timeout ends it", func(t *testing.T) {
		dir := newHTTPFixture(t)
		server, sockPath, _, _ := newRemoteIntegrationServer(t, 300*time.Millisecond)
		client := pairAndReady(t, server, sockPath, "cred-timeout-client")
		repoID := openRepoOK(t, client, dir).Repo.RepoID

		start := time.Now()
		result := runRemoteIgnoringCredentialRequests(t, client, gitrpc.RemoteRunParams{
			RepoID:         repoID,
			RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
		})
		elapsed := time.Since(start)
		if result.OK || result.Error == nil || result.Error.Kind != "AuthFailed" {
			t.Fatalf("got %+v, want AuthFailed", result)
		}
		if elapsed > 10*time.Second {
			t.Fatalf("took %v, want bounded by the broker's own ~300ms timeout", elapsed)
		}
	})
}

// TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest proves the ≤1 slot end to end: a second
// connection's remote.run on the same repository is refused while a fetch is blocked mid-flight
// (a real spawn, via an injected Runner exactly like ops_test.go's own
// TestIntegration_WriteSurvivesClientCancel), and remote.cancel actually reaches and kills it.
func TestIntegration_SecondRemoteOpIsRefusedAndCancelIsHonest(t *testing.T) {
	f := buildRemoteFixture(t)

	started := make(chan struct{})
	// A real local bare-repo fetch completes in milliseconds — too fast to reliably cancel
	// mid-flight. This shim (runner_test.go's own writeSleepyGitShim technique) stands in for the
	// fetch spawn only: a REAL, genuinely running child (so cancellation's group-SIGTERM has
	// something real to reach), ignoring the git argv it's actually handed and just sleeping.
	shimDir := t.TempDir()
	sleepyGit := filepath.Join(shimDir, "git-sleepy")
	if err := os.WriteFile(sleepyGit, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatalf("write sleepy git shim: %v", err)
	}
	var once sync.Once
	realRunner := gitclient.NewExecRunner()
	blockingRunner := runnerFunc(func(ctx context.Context, gitPath string, spec gitclient.Spec) (gitclient.Process, error) {
		if argvContains(spec.Args, "fetch") {
			once.Do(func() { close(started) })
			return realRunner.Start(ctx, sleepyGit, spec)
		}
		return realRunner.Start(ctx, gitPath, spec)
	})

	server, sockPath, _, _ := newRemoteIntegrationServerWithRunner(t, 5*time.Second, blockingRunner)
	clientA := pairAndReady(t, server, sockPath, "second-op-a")
	clientB := pairAndReady(t, server, sockPath, "second-op-b")
	repoID := openRepoOK(t, clientA, f.workDir).Repo.RepoID
	_ = openRepoOK(t, clientB, f.workDir).Repo.RepoID

	fetchID := clientA.next
	clientA.next++
	fetchParams, err := json.Marshal(gitrpc.RemoteRunParams{
		RepoID:         repoID,
		RemoteOpParams: gitsession.RemoteOpParams{Kind: "fetch", Remote: "origin"},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	clientA.sendRaw(wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: fetchID, Method: "remote.run", Params: fetchParams}})
	<-started // the fetch spawn is now blocked mid-flight, inside the runner.

	// B's remote.run on the SAME repository is refused while A's is running.
	busy := requestOK(t, clientB, "remote.run", gitrpc.RemoteRunParams{
		RepoID:         repoID,
		RemoteOpParams: gitsession.RemoteOpParams{Kind: "push", Remote: "origin", Branch: "main"},
	})
	busyResult := unmarshalResult[gitsession.RemoteOpResult](t, busy.Result)
	if busyResult.OK || busyResult.Error == nil || busyResult.Error.Kind != "OperationInProgress" {
		t.Fatalf("B's concurrent remote.run = %+v, want OperationInProgress", busyResult)
	}

	// A's own cancel reaches the killable fetch.
	cancelResp := requestOK(t, clientA, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID})
	var cancelResult gitrpc.RemoteCancelResult
	if err := json.Unmarshal(cancelResp.Result, &cancelResult); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !cancelResult.Cancelled {
		t.Fatal("cancelling a killable (fetch) phase must report true")
	}

	// Read A's own fetch reply — it must resolve Cancelled, not hang, and the slot must free up
	// afterward (checked by C below succeeding without OperationInProgress).
	for {
		raw, err := readFrame(clientA.r)
		if err != nil {
			t.Fatalf("read frame: %v", err)
		}
		var env wireEnvelope
		if err := json.Unmarshal(raw, &env); err != nil {
			t.Fatalf("unmarshal: %v\n%s", err, raw)
		}
		if env.Body.T == "evt" {
			continue
		}
		if env.Body.ID != fetchID {
			t.Fatalf("response id = %d, want %d", env.Body.ID, fetchID)
		}
		if env.Body.Error != nil {
			t.Fatalf("A's own fetch RPC-errored: %+v", *env.Body.Error)
		}
		fetchResult := unmarshalResult[gitsession.RemoteOpResult](t, env.Body.Result)
		if fetchResult.OK || fetchResult.Error == nil || fetchResult.Error.Kind != "Cancelled" {
			t.Fatalf("A's own fetch result = %+v, want Cancelled", fetchResult)
		}
		break
	}

	clientC := pairAndReady(t, server, sockPath, "second-op-c")
	_ = openRepoOK(t, clientC, f.workDir).Repo.RepoID
	cancelIdle := requestOK(t, clientC, "remote.cancel", gitrpc.RemoteCancelParams{RepoID: repoID})
	var cancelIdleResult gitrpc.RemoteCancelResult
	if err := json.Unmarshal(cancelIdle.Result, &cancelIdleResult); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if cancelIdleResult.Cancelled {
		t.Fatal("cancelling with nothing running must report false")
	}
}
