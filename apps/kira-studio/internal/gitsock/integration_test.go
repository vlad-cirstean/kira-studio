package gitsock

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
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
	T      string          `json:"t"`
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	OK     *bool           `json:"ok,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *wireErr        `json:"error,omitempty"`
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

func newIntegrationServer(t *testing.T) (*Server, string, *repos.GitClientsRepo) {
	t.Helper()
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

	gitCli := &gitclient.Client{
		Runner:    gitclient.NewExecRunner(),
		Discovery: gitclient.NewDiscovery(lookPathLocator{}, gitclient.NewExecRunner(), gitclient.NewRealClock()),
		Registry:  gitclient.NewRegistry(gitclient.NewExecRunner()),
	}

	server := New(Deps{
		SocketPath:    filepath.Join(kiraHome, "git.sock"),
		LockPath:      filepath.Join(kiraHome, "git.sock.lock"),
		Clients:       repositories.GitClients,
		Handlers:      gitrpc.New(gitrpc.Deps{Client: gitCli, ServerVersion: "test-version"}),
		ServerVersion: "test-version",
		Now:           time.Now,
	})
	if err := server.Start(); err != nil {
		t.Fatalf("server.Start: %v", err)
	}
	t.Cleanup(func() { _ = server.Close() })

	return server, filepath.Join(kiraHome, "git.sock"), repositories.GitClients
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
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
	server, sockPath, clientsRepo := newIntegrationServer(t)
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
	var openResult gitclient.RepoOpenResult
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
	second := New(Deps{
		SocketPath: sockPath,
		LockPath:   filepath.Join(filepath.Dir(sockPath), "git.sock.lock"),
		Clients:    clientsRepo,
		Handlers:   gitrpc.New(gitrpc.Deps{Client: &gitclient.Client{}, ServerVersion: "second"}),
		Now:        time.Now,
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
