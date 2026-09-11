package gitsock

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// §8.1(b): the real socket, the real git, a real fixture repository. The only production-code
// seam this test uses differently from main.go is the Locator (F13) — exec.LookPath("git")
// instead of the darwin-only platform locator, so app.init's "ok" branch is provable on Linux.
type lookPathLocator struct{}

func (lookPathLocator) Locate(configuredPath string) (path string, probed []string, found bool) {
	if configuredPath != "" {
		if p, err := exec.LookPath(configuredPath); err == nil {
			return p, []string{configuredPath}, true
		}
		return "", []string{configuredPath}, false
	}
	p, err := exec.LookPath("git")
	if err != nil {
		return "", []string{"git"}, false
	}
	return p, []string{"git"}, true
}

// wireFrame/wireEnvelope mirror rpcstream's own unexported frame/envelope shape (frame.go) —
// duplicated here because a real end-to-end test has to speak the wire as an actual client would,
// not call into the server's internals.
type wireFrame struct {
	T       string          `json:"t"`
	ID      int             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	OK      *bool           `json:"ok,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *wireErr        `json:"error,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"` // evt frames only (repo.changed, D20).
	Seq     int             `json:"seq,omitempty"`     // chunk frames only (G3 D5).
	Chunk   json.RawMessage `json:"chunk,omitempty"`   // chunk frames only.
	N       int             `json:"n,omitempty"`       // credit frames only.
}

type wireErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type wireEnvelope struct {
	Version int       `json:"version"`
	Body    wireFrame `json:"body"`
}

// testClient is a minimal, real socket client — the same framing gitsock/frame.go implements,
// spoken independently so this test genuinely exercises the wire rather than the server's own
// helpers.
type testClient struct {
	t    *testing.T
	nc   net.Conn
	r    *bufio.Reader
	next int
}

func dialTestClient(t *testing.T, path string) *testClient {
	t.Helper()
	nc, err := net.Dial("unix", path)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = nc.Close() })
	return &testClient{t: t, nc: nc, r: bufio.NewReader(nc), next: 1}
}

func (c *testClient) sendRaw(v any) {
	c.t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		c.t.Fatalf("marshal: %v", err)
	}
	if err := writeFrame(c.nc, b); err != nil {
		c.t.Fatalf("write frame: %v", err)
	}
}

func (c *testClient) recvHandshake() handshakeResponse {
	c.t.Helper()
	raw, err := readFrame(c.r)
	if err != nil {
		c.t.Fatalf("read frame: %v", err)
	}
	var resp handshakeResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		c.t.Fatalf("unmarshal handshake response: %v\n%s", err, raw)
	}
	return resp
}

// hello sends hello with token (nil for a fresh pairing dial) and returns the handshake outcome
// after following it to completion: ready (token, possibly ""), or a terminal non-ready kind.
func (c *testClient) hello(clientID, label string, token *string) (kind string, sessionToken string) {
	c.t.Helper()
	c.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: clientID, Label: label, PID: os.Getpid(), AppVersion: "test"},
		Token:  token,
	})
	resp := c.recvHandshake()
	if resp.Kind == "pairingRequired" {
		// The next frame is whatever the broker eventually answers with (§3.1.2) — "paired" then
		// "ready", or a terminal "pairingDenied".
		resp = c.recvHandshake()
	}
	switch resp.Kind {
	case "ready":
		return "ready", ""
	case "paired":
		ready := c.recvHandshake()
		if ready.Kind != "ready" {
			c.t.Fatalf("expected ready after paired, got %+v", ready)
		}
		return "ready", resp.Token
	default:
		return resp.Kind, ""
	}
}

func (c *testClient) request(method string, params any) wireFrame {
	c.t.Helper()
	id := c.next
	c.next++
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		c.t.Fatalf("marshal params: %v", err)
	}
	env := wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "req", ID: id, Method: method, Params: paramsJSON}}
	c.sendRaw(env)

	raw, err := readFrame(c.r)
	if err != nil {
		c.t.Fatalf("read response: %v", err)
	}
	var respEnv wireEnvelope
	if err := json.Unmarshal(raw, &respEnv); err != nil {
		c.t.Fatalf("unmarshal response: %v\n%s", err, raw)
	}
	if respEnv.Body.ID != id {
		c.t.Fatalf("response id %d, want %d", respEnv.Body.ID, id)
	}
	return respEnv.Body
}

// openStream sends an 'open' frame for method and returns its id — the caller grants credit and
// reads chunk/end frames itself (streamFrame, below).
func (c *testClient) openStream(method string, params any) int {
	c.t.Helper()
	id := c.next
	c.next++
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		c.t.Fatalf("marshal params: %v", err)
	}
	env := wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "open", ID: id, Method: method, Params: paramsJSON}}
	c.sendRaw(env)
	return id
}

func (c *testClient) sendCredit(id, n int) {
	c.t.Helper()
	env := wireEnvelope{Version: gitrpc.ContractVersion, Body: wireFrame{T: "credit", ID: id, N: n}}
	c.sendRaw(env)
}

// streamFrame is one decoded chunk/end frame — Blob is non-nil only for a chunk frame that
// carried D4's out-of-band bytes.
type streamFrame struct {
	Body wireFrame
	Blob []byte
}

// readStreamFrame reads exactly one frame off the wire, recognising D4's blob-frame body
// (0x00 | uint32BE headerLen | headerJSON | blob) itself — a real client's own framing, not a
// helper the server provides.
func (c *testClient) readStreamFrame() streamFrame {
	c.t.Helper()
	raw, err := readFrame(c.r)
	if err != nil {
		c.t.Fatalf("read stream frame: %v", err)
	}
	if len(raw) > 0 && raw[0] == 0x00 {
		if len(raw) < 5 {
			c.t.Fatalf("blob frame too short: %d bytes", len(raw))
		}
		headerLen := binary.BigEndian.Uint32(raw[1:5])
		if 5+int(headerLen) > len(raw) {
			c.t.Fatalf("blob frame header length %d exceeds frame (%d bytes)", headerLen, len(raw))
		}
		header := raw[5 : 5+int(headerLen)]
		blob := raw[5+int(headerLen):]
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
	return streamFrame{Body: env.Body}
}

// repoChangedPayload is repo.changed's wire payload (D20).
type repoChangedPayload struct {
	RepoID string `json:"repoId"`
	Kind   string `json:"kind"`
}

// recvEvent reads one frame and requires it to be an 'evt' frame for method, decoding its payload
// — used only at points in a test where no request() is outstanding on the same client, so there
// is no risk of an event interleaving with a response this test is also waiting on.
func (c *testClient) recvEvent(method string) repoChangedPayload {
	c.t.Helper()
	raw, err := readFrame(c.r)
	if err != nil {
		c.t.Fatalf("read event: %v", err)
	}
	var env wireEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		c.t.Fatalf("unmarshal event: %v\n%s", err, raw)
	}
	if env.Body.T != "evt" || env.Body.Method != method {
		c.t.Fatalf("frame = %+v, want an evt frame for %s", env.Body, method)
	}
	var payload repoChangedPayload
	if err := json.Unmarshal(env.Body.Payload, &payload); err != nil {
		c.t.Fatalf("unmarshal payload: %v\n%s", err, env.Body.Payload)
	}
	return payload
}

// newIntegrationServer is the full-blown harness §8.1(c)'s own tests build on. registry is
// returned too (not just server/sockPath/clientsRepo) so a test can shorten LingerFor or inject a
// counting NewWatcher before any repo.open runs — gitsession.Registry's own exported seam (§3.9),
// needing no production-only accessor.
func newIntegrationServer(t *testing.T) (server *Server, sockPath string, clientsRepo *repos.GitClientsRepo, registry *gitsession.Registry) {
	t.Helper()
	return newIntegrationServerWithRunner(t, gitclient.NewExecRunner())
}

// newIntegrationServerWithRunner is newIntegrationServer, over a caller-supplied Runner — the
// seam TestIntegration_GraphStreamResumesFromCache needs to count `git log` spawns.
func newIntegrationServerWithRunner(t *testing.T, gitRunner gitclient.Runner) (server *Server, sockPath string, clientsRepo *repos.GitClientsRepo, registry *gitsession.Registry) {
	t.Helper()
	kiraHome := t.TempDir()

	db, err := storage.OpenAt(kiraHome)
	if err != nil {
		t.Fatalf("storage.OpenAt: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}
	t.Cleanup(func() { _ = repositories.Close() })

	gitDiscovery := gitclient.NewDiscovery(lookPathLocator{}, gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
	// G18 D8: wired to the real, per-test SQLite database above (main.go's own wiring, restated)
	// so a test that never overrides these closures itself still exercises the real storage path
	// for repoSettings.get/set, rather than silently falling back to NewRegistry's own in-memory,
	// never-persisted defaults.
	gitRegistry.RepoSettingsGet = repositories.GitRepoSettings.Get
	gitRegistry.RepoSettingsSet = repositories.GitRepoSettings.Set

	server = New(Deps{
		SocketPath: filepath.Join(kiraHome, "git.sock"),
		LockPath:   filepath.Join(kiraHome, "git.sock.lock"),
		Clients:    repositories.GitClients,
		Registry:   gitRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: "test-version",
		}),
		ServerVersion: "test-version",
		Now:           time.Now,
	})
	if err := server.Start(); err != nil {
		t.Fatalf("server.Start: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })

	return server, filepath.Join(kiraHome, "git.sock"), repositories.GitClients, gitRegistry
}

func initFixtureRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write fixture file: %v", err)
	}
	run("add", "README.md")
	run("commit", "-q", "-m", "initial commit")
	return dir
}

// approveHead runs on its own goroutine (the client's hello() blocks waiting for the resolution),
// so it reports failure through errCh rather than calling t.Fatal directly — (*testing.T).Fatal
// from a non-test goroutine only unwinds that goroutine, not the test (go vet's own "non-test
// goroutine" check).
func approveHead(server *Server, errCh chan<- error) {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		snap := server.Broker().Pending()
		if snap.Pending != nil {
			if got := server.Broker().Approve(snap.Pending.RequestID); got != PairingActionResolved {
				errCh <- fmt.Errorf("approve: got %v", got)
				return
			}
			errCh <- nil
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	errCh <- errors.New("no pairing request appeared to approve")
}

func TestIntegration_FullPairingAndRPCLifecycle(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, clientsRepo, _ := newIntegrationServer(t)
	repoDir := initFixtureRepo(t)

	// --- 1. hello with no token -> pairingRequired; approve -> paired -> ready.
	client := dialTestClient(t, sockPath)
	approveErr := make(chan error, 1)
	go approveHead(server, approveErr)
	kind, token := client.hello("client-1", "integration test", nil)
	if err := <-approveErr; err != nil {
		t.Fatalf("approveHead: %v", err)
	}
	if kind != "ready" {
		t.Fatalf("hello outcome: got %q", kind)
	}
	if token == "" {
		t.Fatal("expected a token to come back from pairing")
	}
	row, found, err := clientsRepo.ByID("client-1")
	if err != nil || !found {
		t.Fatalf("client-1 row: found=%v err=%v", found, err)
	}
	if row.RevokedAt != nil {
		t.Fatalf("freshly paired client is already revoked: %+v", row)
	}

	// --- 2. app.init over rpcstream's real frames.
	initResp := client.request("app.init", struct{}{})
	if initResp.T != "res" || initResp.OK == nil || !*initResp.OK {
		t.Fatalf("app.init: got %+v", initResp)
	}
	var initResult gitrpc.AppInitResult
	if err := json.Unmarshal(initResp.Result, &initResult); err != nil {
		t.Fatalf("unmarshal app.init result: %v", err)
	}
	if initResult.Git.Kind != "ok" {
		t.Fatalf("app.init git.kind: got %q, probed %v", initResult.Git.Kind, initResult.Git.Probed)
	}
	if initResult.Git.Version == "" {
		t.Fatal("app.init git.version is empty")
	}

	// --- 3. repo.open against the fixture repo.
	openResp := client.request("repo.open", gitrpc.RepoOpenParams{Path: repoDir})
	if openResp.T != "res" || openResp.OK == nil || !*openResp.OK {
		t.Fatalf("repo.open: got %+v", openResp)
	}
	var openResult gitrpc.RepoOpenResult
	if err := json.Unmarshal(openResp.Result, &openResult); err != nil {
		t.Fatalf("unmarshal repo.open result: %v", err)
	}
	if openResult.Kind != "ok" || openResult.Repo == nil {
		t.Fatalf("repo.open kind: got %+v", openResult)
	}
	summary := *openResult.Repo
	if summary.Head.Kind != "branch" {
		t.Fatalf("repo.open head kind: got %+v", summary.Head)
	}
	if summary.IsBare {
		t.Fatal("fixture repo reported bare")
	}
	if summary.IsLinkedWorktree {
		t.Fatal("fixture repo reported a linked worktree")
	}
	if summary.GitDir != summary.CommonDir {
		t.Fatalf("gitDir %q != commonDir %q for a non-worktree repo", summary.GitDir, summary.CommonDir)
	}

	// --- 4. repo.close, twice (idempotent).
	closeResp := client.request("repo.close", gitrpc.RepoCloseParams{RepoID: summary.RepoID})
	if closeResp.T != "res" || closeResp.OK == nil || !*closeResp.OK {
		t.Fatalf("repo.close: got %+v", closeResp)
	}
	closeResp2 := client.request("repo.close", gitrpc.RepoCloseParams{RepoID: summary.RepoID})
	if closeResp2.T != "res" || closeResp2.OK == nil || !*closeResp2.OK {
		t.Fatalf("second repo.close: got %+v", closeResp2)
	}

	// --- 5. reconnect with the stored token -> straight to ready, no pairingRequired.
	client2 := dialTestClient(t, sockPath)
	kind2, _ := client2.hello("client-1", "integration test", &token)
	if kind2 != "ready" {
		t.Fatalf("reconnect with stored token: got %q", kind2)
	}

	// --- 6. Revoke -> the live connection's next read errors; a re-dial with the same token gets
	// tokenRejected; a re-dial with no token gets pairingRequired again.
	if err := server.Revoke("client-1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := readFrame(bufio.NewReader(client2.nc)); err == nil {
		t.Fatal("expected the revoked connection's read to error")
	}

	client3 := dialTestClient(t, sockPath)
	kind3, _ := client3.hello("client-1", "integration test", &token)
	if kind3 != "tokenRejected" {
		t.Fatalf("revoked client with old token: got %q", kind3)
	}

	client4 := dialTestClient(t, sockPath)
	client4.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "client-1", Label: "integration test", PID: os.Getpid(), AppVersion: "test"},
		Token:  nil,
	})
	resp4 := client4.recvHandshake()
	if resp4.Kind != "pairingRequired" {
		t.Fatalf("revoked client reconnecting with no token: got %q", resp4.Kind)
	}
	if got := server.Broker().Deny(resp4.RequestID); got != PairingActionResolved {
		t.Fatalf("deny: got %v", got)
	}

	// --- 7. a second Server.Start() against the same KIRA_HOME does not listen, does not error,
	// and does not disturb the first one's socket.
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

	// The first server's socket must still answer — proof the second instance didn't unlink it.
	// Checked directly (not via the blocking hello() helper): client-2 has never paired, so this
	// deliberately parks in the broker until denied below, rather than waiting for a resolution.
	client5 := dialTestClient(t, sockPath)
	client5.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "client-2", Label: "still-first-server", PID: os.Getpid(), AppVersion: "test"},
		Token:  nil,
	})
	resp5 := client5.recvHandshake()
	if resp5.Kind != "pairingRequired" {
		t.Fatalf("first server after a second Start: got %q", resp5.Kind)
	}
	if got := server.Broker().Deny(resp5.RequestID); got != PairingActionResolved {
		t.Fatalf("deny client-2: got %v", got)
	}
}

// pairAndReady dials a fresh client and drives it through a fresh pairing to "ready" — the same
// flow TestIntegration_FullPairingAndRPCLifecycle drives inline, factored out here since the two
// tests below each need it more than once.
func pairAndReady(t *testing.T, server *Server, sockPath, clientID string) *testClient {
	t.Helper()
	c := dialTestClient(t, sockPath)
	errCh := make(chan error, 1)
	go approveHead(server, errCh)
	kind, _ := c.hello(clientID, "integration test", nil)
	if err := <-errCh; err != nil {
		t.Fatalf("approveHead: %v", err)
	}
	if kind != "ready" {
		t.Fatalf("hello outcome for %s: got %q", clientID, kind)
	}
	return c
}

func runGitIn(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func openRepoOK(t *testing.T, c *testClient, repoDir string) gitrpc.RepoOpenResult {
	t.Helper()
	resp := c.request("repo.open", gitrpc.RepoOpenParams{Path: repoDir})
	if resp.T != "res" || resp.OK == nil || !*resp.OK {
		t.Fatalf("repo.open: got %+v", resp)
	}
	var result gitrpc.RepoOpenResult
	if err := json.Unmarshal(resp.Result, &result); err != nil {
		t.Fatalf("unmarshal repo.open result: %v", err)
	}
	if result.Kind != "ok" || result.Repo == nil {
		t.Fatalf("repo.open kind: got %+v", result)
	}
	return result
}

// TestIntegration_RepoChangedReachesEveryHolder is the phase's real proof (§8.1(c)): repo.changed
// reaches EVERY connection holding a repository, not just the one that triggered it, with the
// contract's exact payload.
func TestIntegration_RepoChangedReachesEveryHolder(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)
	repoDir := initFixtureRepo(t)

	clientA := pairAndReady(t, server, sockPath, "client-a")
	clientB := pairAndReady(t, server, sockPath, "client-b")

	resultA := openRepoOK(t, clientA, repoDir)
	resultB := openRepoOK(t, clientB, repoDir)
	repoID := resultA.Repo.RepoID
	if resultB.Repo.RepoID != repoID {
		t.Fatalf("client B got a different repoId: %s vs %s", resultB.Repo.RepoID, repoID)
	}

	runGitIn(t, repoDir, "commit", "--allow-empty", "-q", "-m", "second")
	for _, c := range []*testClient{clientA, clientB} {
		ev := c.recvEvent("repo.changed")
		if ev.RepoID != repoID || ev.Kind != "refsChanged" {
			t.Fatalf("event = %+v, want {%s refsChanged}", ev, repoID)
		}
	}

	if err := os.WriteFile(filepath.Join(repoDir, "new-file.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGitIn(t, repoDir, "add", "new-file.txt")
	for _, c := range []*testClient{clientA, clientB} {
		ev := c.recvEvent("repo.changed")
		if ev.RepoID != repoID || ev.Kind != "worktreeChanged" {
			t.Fatalf("event = %+v, want {%s worktreeChanged}", ev, repoID)
		}
	}
}

// TestIntegration_RefcountAndDisconnectTeardown proves F7's bug fixed (a repo.close from one
// connection must not evict the repo for another), and D12/D19's refcount+linger+disconnect
// teardown chain end to end. Watcher construction is counted (registry.NewWatcher, §3.9's own
// "no production accessor that exists only for a test" seam) rather than reaching into the
// registry's own state from a different package.
func TestIntegration_RefcountAndDisconnectTeardown(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, registry := newIntegrationServer(t)
	registry.LingerFor = 50 * time.Millisecond
	var watcherConstructions int32
	realNewWatcher := registry.NewWatcher
	registry.NewWatcher = func(s gitclient.RepoSummary) (gitsession.Watcher, error) {
		atomic.AddInt32(&watcherConstructions, 1)
		return realNewWatcher(s)
	}
	repoDir := initFixtureRepo(t)

	clientA := pairAndReady(t, server, sockPath, "client-a")
	clientB := pairAndReady(t, server, sockPath, "client-b")

	resultA := openRepoOK(t, clientA, repoDir)
	_ = openRepoOK(t, clientB, repoDir)
	repoID := resultA.Repo.RepoID
	if got := atomic.LoadInt32(&watcherConstructions); got != 1 {
		t.Fatalf("watcher constructions after two opens of the same repo = %d, want 1", got)
	}

	closeResp := clientA.request("repo.close", gitrpc.RepoCloseParams{RepoID: repoID})
	if closeResp.T != "res" || closeResp.OK == nil || !*closeResp.OK {
		t.Fatalf("client A repo.close: %+v", closeResp)
	}

	// F7, provably fixed: A's repo.close must not have evicted the repo for B.
	runGitIn(t, repoDir, "commit", "--allow-empty", "-q", "-m", "second")
	ev := clientB.recvEvent("repo.changed")
	if ev.RepoID != repoID || ev.Kind != "refsChanged" {
		t.Fatalf("client B event = %+v, want {%s refsChanged}", ev, repoID)
	}

	// Disconnect B from the test side — its own deferred gconn.Close() (D19) must release its ref
	// too, taking refcount to zero and arming the (deliberately short) linger timer.
	_ = clientB.nc.Close()
	time.Sleep(500 * time.Millisecond) // comfortably past disconnect-detection + LingerFor(50ms).

	clientC := pairAndReady(t, server, sockPath, "client-c")
	_ = openRepoOK(t, clientC, repoDir)
	if got := atomic.LoadInt32(&watcherConstructions); got != 2 {
		t.Fatalf("watcher constructions after expiry+re-open = %d, want 2 (a fresh RepoEntry, not the torn-down one reused)", got)
	}
}

// TestIntegration_RevokeThenRepairReachesReady is G12 D3/D17's permanent form of F2's probe: a
// revoked client id must be able to pair again. Before D3, GitClientsRepo.Insert died on the
// still-present primary key and finishPairing answered pairingDenied — this asserts "ready"
// instead, and that the Connected editors list shows exactly one, un-revoked row afterward.
func TestIntegration_RevokeThenRepairReachesReady(t *testing.T) {
	t.Parallel()
	server, sockPath, clientsRepo, _ := newIntegrationServer(t)

	_, firstToken := pairFreshWithToken(t, server, sockPath, "repair-1")

	rows, err := clientsRepo.List()
	if err != nil || len(rows) != 1 {
		t.Fatalf("client list after first pairing: rows=%+v err=%v, want exactly one row", rows, err)
	}

	if err := server.Revoke("repair-1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// Re-dialing with the now-revoked token must be rejected (SPEC §3.3).
	revokedDial := dialTestClient(t, sockPath)
	kind, _ := revokedDial.hello("repair-1", "revoke test", &firstToken)
	if kind != "tokenRejected" {
		t.Fatalf("re-dial with the revoked token = %q, want tokenRejected", kind)
	}

	// Re-dialing with no token prompts again; approving it must reach "ready", not "pairingDenied".
	repairDial := dialTestClient(t, sockPath)
	approveErr := make(chan error, 1)
	go approveHead(server, approveErr)
	kind, newToken := repairDial.hello("repair-1", "revoke test", nil)
	if err := <-approveErr; err != nil {
		t.Fatalf("approveHead: %v", err)
	}
	if kind != "ready" {
		t.Fatalf("re-pair after approval = %q, want ready (a UNIQUE-constraint insert failure regresses to pairingDenied)", kind)
	}
	if newToken == "" {
		t.Fatal("expected a fresh token from the re-pair")
	}

	rows, err = clientsRepo.List()
	if err != nil || len(rows) != 1 {
		t.Fatalf("client list after re-pair: rows=%+v err=%v, want exactly one row", rows, err)
	}
	if rows[0].RevokedAt != nil {
		t.Fatalf("client row still revoked after re-pair: %+v", rows[0])
	}
}

// TestServer_Close_ReturnsPromptlyWithAPendingPairingRequest is G32 round-3 architecture/security
// review finding #1's own regression proof: a pairing request still sitting unanswered — exactly
// what a pending prompt on screen when the app quits looks like — used to hang Server.Close()
// forever. Broker.Request blocks on a plain channel receive, not on any I/O a closed net.Conn
// would unblock, so this specifically exercises the Broker.Shutdown() half of the fix, not just
// the allConns half (TestServer_Close_ReturnsPromptlyWithASilentConnection covers that one).
func TestServer_Close_ReturnsPromptlyWithAPendingPairingRequest(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)

	// Sends hello directly rather than through testClient.hello (which t.Fatalf's on any read
	// error): once Close() below tears this connection down mid-handshake, the client sees EOF or
	// a reset rather than a clean "pairingDenied" frame -- an acceptable, expected shape for "the
	// server is going away right now," not a protocol bug this test is about.
	client := dialTestClient(t, sockPath)
	client.sendRaw(helloFrame{
		Kind: "hello", Protocol: gitrpc.Protocol, ContractVersion: gitrpc.ContractVersion,
		Client: helloClient{ID: "pending-client", Label: "pending window", PID: os.Getpid(), AppVersion: "test"},
		Token:  nil,
	})
	helloDone := make(chan struct{})
	go func() {
		defer close(helloDone)
		_, _ = readFrame(client.r)
		_, _ = readFrame(client.r)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && server.Broker().Pending().Pending == nil {
		time.Sleep(5 * time.Millisecond)
	}
	if server.Broker().Pending().Pending == nil {
		t.Fatal("pairing request never reached the broker's queue")
	}

	closeDone := make(chan error, 1)
	go func() { closeDone <- server.Close() }()

	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close() did not return within 5s -- hung behind the still-pending pairing request")
	}

	select {
	case <-helloDone:
	case <-time.After(2 * time.Second):
		t.Fatal("hello()'s own goroutine never unblocked after Close()")
	}
}

// TestServer_Close_ReturnsPromptlyWithASilentConnection is the same finding's other scenario: a
// connection that dials but never sends a single byte (the handshake's own first read blocks
// forever with no deadline) — the allConns half of the fix, closing it directly, unlike the
// pairing-broker case above.
func TestServer_Close_ReturnsPromptlyWithASilentConnection(t *testing.T) {
	t.Parallel()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, _, _ := newIntegrationServer(t)

	nc, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = nc.Close() })
	// Never write anything -- runHandshake's first Receive() blocks indefinitely.

	closeDone := make(chan error, 1)
	go func() { closeDone <- server.Close() }()

	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close() did not return within 5s -- hung behind the silent, never-handshaked connection")
	}
}
