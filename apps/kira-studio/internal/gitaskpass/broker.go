package gitaskpass

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultTimeout is the broker's own bound on one credential wait (D4's table) — long enough for a
// human to actually type a passphrase, short enough that a broker-side bug can never hang a remote
// op forever. Mirrored to the helper via KIRA_ASKPASS_TIMEOUT_MS (WithOp) so the helper's own
// independent deadline agrees with the broker's.
const DefaultTimeout = 120 * time.Second

// Options configures a Broker. HelperCommand is the test seam (D8): defaulted in production to
// {os.Executable(), "askpass"}; gitaskpass's own tests and gitsock's integration tier set it to
// the stdlib os/exec "helper process" idiom instead, so the whole broker is provable with no app
// binary at all.
type Options struct {
	// Timeout bounds one credential wait. Zero uses DefaultTimeout.
	Timeout time.Duration
	// HelperCommand is the shim's own fixed argv, before git's prompt argument. Empty selects the
	// production default: this binary's own resolved path plus "askpass".
	HelperCommand []string
}

// opEntry is one in-flight remote op's registration (D4/D21): the ctx WithOp was called with, and
// the Prompter to relay a prompt to.
type opEntry struct {
	ctx      context.Context
	prompter Prompter
}

// Broker owns the shim file, the private socket and every in-flight op's registration. One per
// process (main.go constructs it once); Close removes its temp directory.
type Broker struct {
	dir      string
	shimPath string
	sockPath string
	token    string
	timeout  time.Duration

	listener net.Listener

	mu  sync.Mutex
	ops map[string]*opEntry

	wg sync.WaitGroup
}

// New constructs the broker's 0700 temp directory, writes the shim, opens the private socket
// (0600) and starts accepting connections. A failure here is never fatal to the caller (D8/D10's
// own "a broker that fails to start... every remote op then runs with no interposition" — a nil
// *Broker is main.go's own already-supported path, not built here).
func New(opts Options) (*Broker, error) {
	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}

	helperCommand := opts.HelperCommand
	if len(helperCommand) == 0 {
		exe, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("gitaskpass: resolve executable: %w", err)
		}
		helperCommand = []string{exe, "askpass"}
	}
	shimBody, err := buildShim(helperCommand)
	if err != nil {
		return nil, err
	}

	// POSIX mkdtemp(3) creates the directory 0700 already; os.MkdirTemp is documented to use it —
	// D8's whole security boundary starts here: no other OS user can read the shim or reach the
	// socket.
	dir, err := os.MkdirTemp("", "kira-askpass-")
	if err != nil {
		return nil, fmt.Errorf("gitaskpass: mkdtemp: %w", err)
	}

	shimPath := filepath.Join(dir, "shim")
	if err := os.WriteFile(shimPath, []byte(shimBody), 0o700); err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("gitaskpass: write shim: %w", err)
	}

	// Named "s" (D8/P14): macOS caps sun_path at 104 bytes and $TMPDIR there is already ~50, so the
	// socket's own filename has to stay short.
	sockPath := filepath.Join(dir, "s")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("gitaskpass: listen: %w", err)
	}
	if err := os.Chmod(sockPath, 0o600); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("gitaskpass: chmod socket: %w", err)
	}

	token, err := randHex(32)
	if err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("gitaskpass: token: %w", err)
	}

	b := &Broker{
		dir: dir, shimPath: shimPath, sockPath: sockPath, token: token, timeout: timeout,
		listener: ln, ops: make(map[string]*opEntry),
	}
	b.wg.Add(1)
	go b.acceptLoop()
	return b, nil
}

// buildShim renders the shim script (D8): one `exec` of helperCommand's own argv, each element
// double-quoted, followed by "$1" (git's own prompt argument) also double-quoted. Refuses — a hard
// error, never a best-effort escape — an element containing a double quote or a newline: a path
// that cannot be quoted safely this way is a hard error, not a best-effort escape.
func buildShim(helperCommand []string) (string, error) {
	var b strings.Builder
	b.WriteString("#!/bin/sh\nexec")
	for _, arg := range helperCommand {
		if strings.ContainsAny(arg, "\"\n") {
			return "", fmt.Errorf("gitaskpass: helper command argument cannot be safely quoted: %q", arg)
		}
		b.WriteString(` "`)
		b.WriteString(arg)
		b.WriteString(`"`)
	}
	b.WriteString(` "$1"` + "\n")
	return b.String(), nil
}

func randHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// Env returns the constant env every remote-op spawn needs to reach this broker (D8): GIT_ASKPASS/
// SSH_ASKPASS point at the shim, SSH_ASKPASS_REQUIRE=force is what makes OpenSSH >= 8.4 use
// SSH_ASKPASS unconditionally (probed against 9.6, P4), and the session socket/token are constant
// for this broker's whole lifetime — WithOp layers the per-op id and timeout on top.
func (b *Broker) Env() []string {
	return []string{
		"GIT_ASKPASS=" + b.shimPath,
		"SSH_ASKPASS=" + b.shimPath,
		"SSH_ASKPASS_REQUIRE=force",
		"KIRA_ASKPASS_SOCK=" + b.sockPath,
		"KIRA_ASKPASS_TOKEN=" + b.token,
	}
}

// WithOp registers prompter for one op (a fresh, unguessable 16-byte op id), runs fn with the
// per-op env it needs (KIRA_ASKPASS_OPID, KIRA_ASKPASS_TIMEOUT_MS), and unregisters the prompter on
// every exit path — a Prompter never outlives the op it was supplied for. ctx bounds every prompt
// this op's spawn might trigger; D4's table names the other three bounds (dismissal, the broker's
// own timer, Conn's own disconnect signal) as Prompter.Ask's own responsibility.
func (b *Broker) WithOp(ctx context.Context, prompter Prompter, fn func(opEnv []string) error) error {
	opID, err := randHex(16)
	if err != nil {
		return err
	}
	b.mu.Lock()
	b.ops[opID] = &opEntry{ctx: ctx, prompter: prompter}
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.ops, opID)
		b.mu.Unlock()
	}()

	opEnv := []string{
		"KIRA_ASKPASS_OPID=" + opID,
		"KIRA_ASKPASS_TIMEOUT_MS=" + strconv.FormatInt(b.timeout.Milliseconds(), 10),
	}
	return fn(opEnv)
}

// Close stops accepting new connections, waits for every in-flight one to finish, and removes the
// broker's temp directory (the shim and the socket file along with it).
func (b *Broker) Close() error {
	err := b.listener.Close()
	b.wg.Wait()
	if rmErr := os.RemoveAll(b.dir); err == nil {
		err = rmErr
	}
	return err
}

func (b *Broker) acceptLoop() {
	defer b.wg.Done()
	for {
		conn, err := b.listener.Accept()
		if err != nil {
			return // listener closed by Close() — normal shutdown.
		}
		b.wg.Add(1)
		go func() {
			defer b.wg.Done()
			b.handleConn(conn)
		}()
	}
}

// handleConn answers exactly one request-response round trip (D8's protocol) — bounded by
// b.timeout plus a small grace so a slow-to-connect helper's own read never races the broker
// closing the connection out from under it. The op-scoped context additionally bounds
// Prompter.Ask below (WithOp's ctx) so this op's own cancellation ends the wait promptly, and a
// derived per-call timeout gives every wait the broker's own bound independent of that ctx.
func (b *Broker) handleConn(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(b.timeout + 5*time.Second))

	line, err := bufio.NewReader(conn).ReadString('\n')
	if err != nil {
		return
	}
	var req socketRequest
	if err := json.Unmarshal([]byte(line), &req); err != nil {
		writeResponse(conn, socketResponse{OK: false})
		return
	}

	if subtle.ConstantTimeCompare([]byte(req.Token), []byte(b.token)) != 1 {
		writeResponse(conn, socketResponse{OK: false})
		return
	}

	b.mu.Lock()
	entry, ok := b.ops[req.OpID]
	b.mu.Unlock()
	if !ok {
		writeResponse(conn, socketResponse{OK: false})
		return
	}

	askCtx, cancel := context.WithTimeout(entry.ctx, b.timeout)
	defer cancel()
	answer, answered := entry.prompter.Ask(askCtx, Request{Prompt: req.Prompt, Masked: DeriveMasked(req.Prompt)})
	if !answered {
		writeResponse(conn, socketResponse{OK: false})
		return
	}
	writeResponse(conn, socketResponse{OK: true, Answer: answer})
}

func writeResponse(conn net.Conn, resp socketResponse) {
	b, err := json.Marshal(resp)
	if err != nil {
		return
	}
	b = append(b, '\n')
	_, _ = conn.Write(b)
}
