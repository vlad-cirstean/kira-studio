package gitaskpass

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestAskpassHelperProcess is the stdlib os/exec "helper process" idiom (os/exec's own
// TestHelperProcess): a no-op unless KIRA_ASKPASS_HELPER_PROCESS=1 is set, which only this
// package's own tests ever set — so this test contributes nothing when the suite runs normally,
// and becomes the real askpass helper when the shim execs this same test binary with
// "-test.run=TestAskpassHelperProcess --" (helperCommand, below). This is D8's own test seam: the
// whole broker is provable with no app binary at all.
func TestAskpassHelperProcess(t *testing.T) {
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
	os.Exit(RunHelper(args, os.Environ(), os.Stdout))
}

// helperCommand is every test in this file's own Options.HelperCommand.
func helperCommand(t *testing.T) []string {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	return []string{self, "-test.run=TestAskpassHelperProcess", "--"}
}

func newTestBroker(t *testing.T, timeout time.Duration) *Broker {
	t.Helper()
	b, err := New(Options{Timeout: timeout, HelperCommand: helperCommand(t)})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b
}

// runShim execs the broker's shim exactly as a git child would (argv0 = the shim's own path, argv1
// = git's prompt text), with env = the broker's own Env() plus opEnv plus the sentinel that turns
// TestAskpassHelperProcess into the real helper for this one subprocess.
func runShim(t *testing.T, b *Broker, opEnv []string, prompt string) (stdout string, exitCode int) {
	t.Helper()
	env := append([]string{"KIRA_ASKPASS_HELPER_PROCESS=1"}, b.Env()...)
	env = append(env, opEnv...)
	cmd := exec.Command(b.shimPath, prompt)
	cmd.Env = env
	out, err := cmd.Output()
	if err == nil {
		return string(out), 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return string(out), exitErr.ExitCode()
	}
	t.Fatalf("run shim: %v", err)
	return "", -1
}

type fakePrompter struct {
	answer   string
	answered bool
	// connDone, when non-nil, models D4's "the owning Conn's disconnect signal" bound —
	// independent of ctx, exactly as gitsession.Conn.AskCredential selects on both.
	connDone <-chan struct{}
	// block, when true, never returns on its own — only ctx.Done()/connDone ends the wait, proving
	// the broker's/helper's own timeouts are what end it, not the prompter cooperating.
	block bool

	// called/lastReq (F19) record whether Ask was invoked at all, and with what Request — used to
	// prove SSH_ASKPASS_PROMPT=none never contacts the broker at all, and that =confirm's own
	// Request.Confirm/Masked flags reach the Prompter correctly.
	called  bool
	lastReq Request
}

func (p *fakePrompter) Ask(ctx context.Context, req Request) (string, bool) {
	p.called = true
	p.lastReq = req
	if !p.block {
		return p.answer, p.answered
	}
	select {
	case <-ctx.Done():
		return "", false
	case <-p.connDone:
		return "", false
	}
}

func TestBroker_AnswerPathReachesGitAsStdout(t *testing.T) {
	b := newTestBroker(t, 5*time.Second)
	prompter := &fakePrompter{answer: "s3cr3t", answered: true}

	var stdout, exitCode = "", -1
	err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
		stdout, exitCode = runShim(t, b, opEnv, "Password for 'https://alice@example.com': ")
		return nil
	})
	if err != nil {
		t.Fatalf("WithOp: %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("exit code = %d, want 0", exitCode)
	}
	if stdout != "s3cr3t\n" {
		t.Fatalf("stdout = %q, want %q", stdout, "s3cr3t\n")
	}
}

func TestBroker_DismissalExitsNonZeroPromptly(t *testing.T) {
	b := newTestBroker(t, 5*time.Second)
	prompter := &fakePrompter{answered: false}

	deadline := time.Now().Add(3 * time.Second)
	var exitCode = -1
	err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
		_, exitCode = runShim(t, b, opEnv, "Username for 'https://example.com': ")
		return nil
	})
	if err != nil {
		t.Fatalf("WithOp: %v", err)
	}
	if time.Now().After(deadline) {
		t.Fatal("dismissal took longer than the test's own patience")
	}
	if exitCode == 0 {
		t.Fatal("exit code = 0, want non-zero for a dismissed prompt")
	}
}

// TestRunHelper_SSHAskPassPromptNone_NeverContactsTheBroker is F19's own regression guard: OpenSSH
// sets SSH_ASKPASS_PROMPT=none for a FIDO/security-key touch notification, where no text answer is
// ever expected — the old design still relayed this through the broker as an ordinary masked text
// prompt, leaving a stale, meaningless prompt on screen. The helper must exit 0 without ever
// reaching the Prompter at all.
func TestRunHelper_SSHAskPassPromptNone_NeverContactsTheBroker(t *testing.T) {
	b := newTestBroker(t, 5*time.Second)
	prompter := &fakePrompter{answer: "should never be used", answered: true}

	var stdout, exitCode = "", -1
	err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
		env := append(append([]string{}, opEnv...), "SSH_ASKPASS_PROMPT=none")
		stdout, exitCode = runShim(t, b, env, "Confirm user presence for key ED25519 SHA256:abc")
		return nil
	})
	if err != nil {
		t.Fatalf("WithOp: %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("exit code = %d, want 0", exitCode)
	}
	if stdout != "" {
		t.Fatalf("stdout = %q, want empty", stdout)
	}
	if prompter.called {
		t.Fatal("Prompter.Ask was called — SSH_ASKPASS_PROMPT=none must never contact the broker at all")
	}
}

// TestRunHelper_SSHAskPassPromptConfirm_AnswerNeverPrintedExitCodeCarriesTheDecision is F19's own
// regression guard for OpenSSH's yes/no variant: the Request reaching the Prompter must say
// Confirm (so a real UI shows Yes/No, not a masked text field) and Masked=false (a yes/no question
// is not itself a secret), and the helper's own exit code — never printed stdout — must carry the
// decision: 0 for confirmed, non-zero for declined/unanswered.
func TestRunHelper_SSHAskPassPromptConfirm_AnswerNeverPrintedExitCodeCarriesTheDecision(t *testing.T) {
	t.Run("confirmed", func(t *testing.T) {
		b := newTestBroker(t, 5*time.Second)
		prompter := &fakePrompter{answer: "yes", answered: true}

		var stdout, exitCode = "", -1
		err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
			env := append(append([]string{}, opEnv...), "SSH_ASKPASS_PROMPT=confirm")
			stdout, exitCode = runShim(t, b, env, "Allow user@host to reset the passphrase?")
			return nil
		})
		if err != nil {
			t.Fatalf("WithOp: %v", err)
		}
		if exitCode != 0 {
			t.Fatalf("exit code = %d, want 0 for a confirmed prompt", exitCode)
		}
		if stdout != "" {
			t.Fatalf("stdout = %q, want empty — a confirm prompt's own answer text must never be printed", stdout)
		}
		if !prompter.called || !prompter.lastReq.Confirm {
			t.Fatalf("Request.Confirm = %v (called=%v), want true", prompter.lastReq.Confirm, prompter.called)
		}
		if prompter.lastReq.Masked {
			t.Fatal("Request.Masked = true, want false for a yes/no confirm prompt")
		}
	})

	t.Run("declined", func(t *testing.T) {
		b := newTestBroker(t, 5*time.Second)
		prompter := &fakePrompter{answered: false}

		var exitCode = -1
		err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
			env := append(append([]string{}, opEnv...), "SSH_ASKPASS_PROMPT=confirm")
			_, exitCode = runShim(t, b, env, "Allow user@host to reset the passphrase?")
			return nil
		})
		if err != nil {
			t.Fatalf("WithOp: %v", err)
		}
		if exitCode == 0 {
			t.Fatal("exit code = 0, want non-zero for a declined confirm prompt")
		}
	})
}

// TestBroker_BrokerTimeoutEndsTheWait is the exit criterion's own headline case: a prompter that
// never answers on its own still ends with the helper exiting non-zero, bounded by the broker's own
// (millisecond) timeout rather than the helper's much longer fallback.
func TestBroker_BrokerTimeoutEndsTheWait(t *testing.T) {
	b := newTestBroker(t, 100*time.Millisecond)
	blocked := make(chan struct{}) // never closed — this prompter answers only via ctx.
	prompter := &fakePrompter{block: true, connDone: blocked}

	start := time.Now()
	var exitCode = -1
	err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
		_, exitCode = runShim(t, b, opEnv, "Password: ")
		return nil
	})
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("WithOp: %v", err)
	}
	if exitCode == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
	if elapsed > 3*time.Second {
		t.Fatalf("took %v, want well under the helper's own much larger fallback timeout", elapsed)
	}
}

// TestBroker_OwningConnectionDiesEndsTheWait models D4's third bound directly: the prompter's own
// connDone closing (Conn.Close(), on this package's terms) ends the wait even though ctx itself is
// never cancelled and the broker's timeout is generous.
func TestBroker_OwningConnectionDiesEndsTheWait(t *testing.T) {
	b := newTestBroker(t, 30*time.Second)
	connDone := make(chan struct{})
	prompter := &fakePrompter{block: true, connDone: connDone}

	started := make(chan struct{})
	finished := make(chan struct{})
	var exitCode = -1
	go func() {
		_ = b.WithOp(context.Background(), prompter, func(opEnv []string) error {
			close(started)
			_, exitCode = runShim(t, b, opEnv, "Password: ")
			close(finished)
			return nil
		})
	}()
	<-started
	time.Sleep(50 * time.Millisecond) // let the shim actually connect and register its request.
	close(connDone)

	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("the wait did not end when the owning connection died")
	}
	if exitCode == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
}

// TestBroker_OpCancellationEndsTheWait is D4's fourth bound: the op's own ctx (remote.cancel, on
// gitsession's terms) ending the wait.
func TestBroker_OpCancellationEndsTheWait(t *testing.T) {
	b := newTestBroker(t, 30*time.Second)
	prompter := &fakePrompter{block: true, connDone: make(chan struct{})}
	opCtx, cancel := context.WithCancel(context.Background())

	started := make(chan struct{})
	finished := make(chan struct{})
	var exitCode = -1
	go func() {
		_ = b.WithOp(opCtx, prompter, func(opEnv []string) error {
			close(started)
			_, exitCode = runShim(t, b, opEnv, "Password: ")
			close(finished)
			return nil
		})
	}()
	<-started
	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("the wait did not end when the op was cancelled")
	}
	if exitCode == 0 {
		t.Fatal("exit code = 0, want non-zero")
	}
}

func TestBroker_WrongTokenIsRefused(t *testing.T) {
	b := newTestBroker(t, 5*time.Second)
	prompter := &fakePrompter{answer: "x", answered: true}

	err := b.WithOp(context.Background(), prompter, func(opEnv []string) error {
		opID := ""
		for _, e := range opEnv {
			if v, ok := strings.CutPrefix(e, "KIRA_ASKPASS_OPID="); ok {
				opID = v
			}
		}
		resp := dialAndRequest(t, b, "not-the-real-token", opID, "Password: ")
		if resp.OK {
			t.Fatal("wrong token: want ok:false")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("WithOp: %v", err)
	}
}

func TestBroker_StaleOpIDIsRefused(t *testing.T) {
	b := newTestBroker(t, 5*time.Second)
	resp := dialAndRequest(t, b, b.ln.Token, "0000000000000000000000000000000", "Password: ")
	if resp.OK {
		t.Fatal("stale op id: want ok:false")
	}
}

// dialAndRequest speaks D8's socket protocol directly, bypassing the shim/helper entirely — the
// seam TestBroker_WrongTokenIsRefused/TestBroker_StaleOpIDIsRefused need to send a request the real
// helper would never construct.
func dialAndRequest(t *testing.T, b *Broker, token, opID, prompt string) socketResponse {
	t.Helper()
	conn, err := net.Dial("unix", b.ln.SockPath)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	req, err := json.Marshal(socketRequest{Token: token, OpID: opID, Prompt: prompt})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req = append(req, '\n')
	if _, err := conn.Write(req); err != nil {
		t.Fatalf("write: %v", err)
	}
	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var resp socketResponse
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return resp
}

func TestRunHelper_MissingEnvExitsOne(t *testing.T) {
	code := RunHelper([]string{"Password: "}, nil, new(strings.Builder))
	if code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
}

func TestRunHelper_MissingPromptArgExitsOne(t *testing.T) {
	env := []string{"KIRA_ASKPASS_SOCK=/nonexistent", "KIRA_ASKPASS_TOKEN=t", "KIRA_ASKPASS_OPID=o"}
	code := RunHelper(nil, env, new(strings.Builder))
	if code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
}

// TestRunHelper_BrokerNeverAnswersExitsOneWithinItsOwnTimeout is the helper's own independent
// bound (D4's last row: "the broker never answers at all" -> the helper's OWN timeout, not the
// broker's, since a broken broker cannot be trusted to honour its own).
func TestRunHelper_BrokerNeverAnswersExitsOneWithinItsOwnTimeout(t *testing.T) {
	dir := t.TempDir()
	sockPath := dir + "/s"
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		// Accept the connection, read the request, then never answer at all.
		_, _ = bufio.NewReader(conn).ReadString('\n')
		<-time.After(5 * time.Second)
	}()

	env := []string{
		"KIRA_ASKPASS_SOCK=" + sockPath, "KIRA_ASKPASS_TOKEN=t", "KIRA_ASKPASS_OPID=o",
		"KIRA_ASKPASS_TIMEOUT_MS=100",
	}
	start := time.Now()
	code := RunHelper([]string{"Password: "}, env, new(strings.Builder))
	elapsed := time.Since(start)
	if code != 1 {
		t.Fatalf("code = %d, want 1", code)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("took %v, want bounded by the helper's own ~100ms timeout", elapsed)
	}
}

// TestBuildShim_NoCharacterNeedsRefusing is F13's own regression guard for the OLD design's own
// refusal list: single-quoting (below) has no special character at all except the quote itself,
// so none of these — a double quote, a newline, or any of the shell metacharacters double-quoting
// used to leave live ($, backtick, \) — needs erroring out any more.
func TestBuildShim_NoCharacterNeedsRefusing(t *testing.T) {
	args := []string{
		`has a "quote"`,
		"has\na newline",
		"has a $ dollar and ` backtick and \\ backslash",
		"has an embedded ' single quote",
	}
	if _, err := buildShim(args); err != nil {
		t.Fatalf("buildShim: %v, want no error for any of these", err)
	}
}

// TestBuildShim_ShellMetacharactersDoNotExpand is F13's own security regression guard: the OLD
// design double-quoted each helper-command element, and double quotes still let the shell expand
// $var, $(...) and backticks inside them — an executable path containing one of these ran
// arbitrary commands, or resolved to the wrong path, before the shim ever execed anything.
// Single-quoting closes this: proven here by planting a canary file inside a command
// substitution and confirming it is never created (the shim's own exec necessarily fails, since
// the literal string is not a real executable — that failure is expected, only the canary matters).
func TestBuildShim_ShellMetacharactersDoNotExpand(t *testing.T) {
	cases := []string{"dollar-paren", "backtick"}
	for _, kind := range cases {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			canary := filepath.Join(dir, "pwned")
			var evil string
			if kind == "dollar-paren" {
				evil = "$(touch " + canary + ")"
			} else {
				evil = "`touch " + canary + "`"
			}

			shimBody, err := buildShim([]string{evil})
			if err != nil {
				t.Fatalf("buildShim: %v", err)
			}
			shimPath := filepath.Join(dir, "shim")
			if err := os.WriteFile(shimPath, []byte(shimBody), 0o700); err != nil {
				t.Fatalf("write shim: %v", err)
			}
			_ = exec.Command(shimPath, "prompt").Run() // expected to fail; the canary is what matters.
			if _, statErr := os.Stat(canary); statErr == nil {
				t.Fatalf("shell metacharacters in %q were expanded — command substitution ran and created the canary file", evil)
			}
		})
	}
}

func TestDeriveMasked(t *testing.T) {
	cases := []struct {
		prompt string
		masked bool
	}{
		{"Username for 'https://github.com': ", false},
		{"username for 'https://github.com': ", false}, // case-insensitive.
		{"Password for 'https://alice@github.com': ", true},
		{"Enter passphrase for /home/kira/.ssh/id_ed25519: ", true},
		{"", true}, // unrecognised -> masked, never the reverse.
	}
	for _, c := range cases {
		if got := DeriveMasked(c.prompt); got != c.masked {
			t.Errorf("DeriveMasked(%q) = %v, want %v", c.prompt, got, c.masked)
		}
	}
}

func TestShouldInterpose(t *testing.T) {
	cases := []struct {
		coreAskPass, inherited string
		want                   bool
	}{
		{"", "", true},
		{"/usr/bin/true", "", false},
		{"", "/some/other/askpass", false},
		{"/usr/bin/true", "/some/other/askpass", false},
	}
	for _, c := range cases {
		if got := ShouldInterpose(c.coreAskPass, c.inherited); got != c.want {
			t.Errorf("ShouldInterpose(%q, %q) = %v, want %v", c.coreAskPass, c.inherited, got, c.want)
		}
	}
}
