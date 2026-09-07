package gitsock

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// §3.8's own M6 support (D11/D15): the helper-process launcher and the /proc-based orphan scan.
// Shared between recovery_test.go and matrix_test.go/revoke_test.go's own countGitProcessesUnder
// (matrix_support_test.go) — this file adds only what THIS tier needs beyond that.

const (
	// envGitsockHelper gates TestHelperProcess_GitsockServer -- unset, it is a silent no-op exactly
	// like TestAskpassHelperProcessForGitsock's own KIRA_ASKPASS_HELPER_PROCESS gate (remote_test.go).
	envGitsockHelper = "KIRA_GITSOCK_HELPER"
	// envGitsockHelperRepo names the fixture repository the helper should repo.open.
	envGitsockHelperRepo = "KIRA_GITSOCK_HELPER_REPO"
)

// isListening reports whether s is actually accepting connections -- Start() returns nil even when
// another instance is already serving (D5's own "never fatal" rule), so a test that needs to know
// which of those two happened must check this, not just Start()'s error.
func isListening(s *Server) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listening
}

// TestHelperProcess_GitsockServer is D11's own helper process, a silent no-op unless
// KIRA_GITSOCK_HELPER=1 -- the same stdlib "helper process" idiom TestAskpassHelperProcessForGitsock
// already establishes in this package (remote_test.go), re-exec'd by launchGitsockHelper below. It
// builds a REAL Server over KIRA_HOME, Start()s it, dials its own socket, pairs, repo.opens the
// repository named by KIRA_GITSOCK_HELPER_REPO and reads one file through it (a persistent cat-file
// pair, the one long-lived child F15 cares about survives past repo.open's own short-lived
// rev-parse spawns), then prints READY on stdout and blocks forever — the parent SIGKILLs it (M6).
func TestHelperProcess_GitsockServer(t *testing.T) {
	if os.Getenv(envGitsockHelper) != "1" {
		return
	}
	kiraHome := os.Getenv("KIRA_HOME")
	repoDir := os.Getenv(envGitsockHelperRepo)
	if kiraHome == "" || repoDir == "" {
		fmt.Fprintln(os.Stderr, "gitsock helper: KIRA_HOME and "+envGitsockHelperRepo+" must both be set")
		os.Exit(1)
	}

	gitRunner := gitclient.NewExecRunner()
	db, err := storage.Open()
	if err != nil {
		fmt.Fprintln(os.Stderr, "gitsock helper: storage.Open:", err)
		os.Exit(1)
	}
	repositories, err := repos.New(db.DB)
	if err != nil {
		fmt.Fprintln(os.Stderr, "gitsock helper: repos.New:", err)
		os.Exit(1)
	}
	gitDiscovery := gitclient.NewDiscovery(lookPathLocator{}, gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)

	server := New(Deps{
		SocketPath: filepath.Join(kiraHome, "git.sock"),
		LockPath:   filepath.Join(kiraHome, "git.sock.lock"),
		Clients:    repositories.GitClients,
		Registry:   gitRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: "helper",
		}),
		ServerVersion: "helper",
		Now:           time.Now,
	})
	if err := server.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "gitsock helper: Start:", err)
		os.Exit(1)
	}
	if !isListening(server) {
		fmt.Fprintln(os.Stderr, "gitsock helper: Start returned but the server is not listening")
		os.Exit(1)
	}

	client := dialTestClient(t, filepath.Join(kiraHome, "git.sock"))
	errCh := make(chan error, 1)
	go approveHead(server, errCh)
	kind, _ := client.hello("gitsock-helper-client", "recovery helper", nil)
	if err := <-errCh; err != nil {
		fmt.Fprintln(os.Stderr, "gitsock helper: approveHead:", err)
		os.Exit(1)
	}
	if kind != "ready" {
		fmt.Fprintln(os.Stderr, "gitsock helper: hello outcome:", kind)
		os.Exit(1)
	}

	openResp := client.request("repo.open", gitrpc.RepoOpenParams{Path: repoDir})
	if openResp.T != "res" || openResp.OK == nil || !*openResp.OK {
		fmt.Fprintf(os.Stderr, "gitsock helper: repo.open failed: %+v\n", openResp)
		os.Exit(1)
	}
	var openResult gitrpc.RepoOpenResult
	if err := json.Unmarshal(openResp.Result, &openResult); err != nil || openResult.Repo == nil {
		fmt.Fprintf(os.Stderr, "gitsock helper: unmarshal repo.open result: %v\n", err)
		os.Exit(1)
	}

	// A real file.read starts the persistent cat-file --batch/--batch-check pair (F15's own "the
	// one long-lived child that outlives repo.open's short-lived rev-parse spawns").
	readResp := client.request("file.read", gitrpc.FileReadParams{RepoID: openResult.Repo.RepoID, Rev: "HEAD", Path: "README.md"})
	if readResp.T != "res" || readResp.OK == nil || !*readResp.OK {
		fmt.Fprintf(os.Stderr, "gitsock helper: file.read failed: %+v\n", readResp)
		os.Exit(1)
	}

	fmt.Println("READY")
	select {} // block forever -- the parent SIGKILLs this process (M6).
}

// launchGitsockHelper starts the helper process (D11) against kiraHome/repoDir and blocks until it
// prints its own READY line -- the proof it really built a live RepoEntry (a watcher, a subscriber
// pump, a persistent cat-file pair) before the caller kills it. Returns the running *exec.Cmd.
func launchGitsockHelper(t *testing.T, kiraHome, repoDir string) *exec.Cmd {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	cmd := exec.Command(self, "-test.run=TestHelperProcess_GitsockServer")
	cmd.Env = append(os.Environ(),
		envGitsockHelper+"=1",
		"KIRA_HOME="+kiraHome,
		envGitsockHelperRepo+"="+repoDir,
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatalf("StdoutPipe: %v", err)
	}
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrBuf
	if err := cmd.Start(); err != nil {
		t.Fatalf("start gitsock helper: %v", err)
	}

	ready := make(chan struct{})
	go func() {
		r := bufio.NewReader(stdout)
		for {
			line, err := r.ReadString('\n')
			if strings.TrimSpace(line) == "READY" {
				select {
				case <-ready:
				default:
					close(ready)
				}
			}
			if err != nil {
				return
			}
		}
	}()

	select {
	case <-ready:
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatalf("gitsock helper never printed READY within the deadline; stderr:\n%s", stderrBuf.String())
	}
	return cmd
}

// killAndReap SIGKILLs cmd (no cleanup runs, exactly like a real crash) and waits for the kernel to
// reap it -- kill(pid, 0) can answer "alive" against a not-yet-reaped zombie for a moment even after
// SIGKILL lands (AGENTS.md's own note on this sandbox's slow init), so this polls rather than
// assuming cmd.Wait() alone is instantaneous.
func killAndReap(t *testing.T, cmd *exec.Cmd) {
	t.Helper()
	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("SIGKILL: %v", err)
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait() // a killed process reports a non-nil error here; expected, not checked.
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("helper process was not reaped within 10s of SIGKILL")
	}
}
