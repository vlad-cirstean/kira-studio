// Package localsock is the mkdtemp-then-unix-socket bootstrap agenthooks.New and gitaskpass.New
// each hand-rolled identically (P107 T2-9): a fresh 0700 temp directory, a unix socket inside it
// named "s" (macOS caps sun_path at 104 bytes, so the filename has to stay short), chmod 0600, and
// a random hex token. Both callers still build their own shim/hooks-document/http.Server on top —
// this package owns only the directory/socket/token, not what serves on it.
package localsock

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
)

// Options configures Listen.
type Options struct {
	// DirPrefix is os.MkdirTemp's own pattern prefix (e.g. "kira-agent-", "kira-askpass-") — kept
	// per caller so a stray temp directory in a bug report is still traceable to which subsystem
	// made it.
	DirPrefix string
	// TokenBytes is RandHex's own byte count (agenthooks and gitaskpass both use 32).
	TokenBytes int
}

// Listener owns a temp directory and the unix socket inside it — Close removes both. It embeds
// net.Listener so a caller that serves its own protocol on top (agenthooks' http.Server.Serve)
// can hand it over directly; Serve below is for a caller that wants a plain accept loop instead
// (gitaskpass's own shape).
type Listener struct {
	net.Listener
	// Dir is the temp directory's own path — callers write a shim script or other files beside the
	// socket inside it.
	Dir string
	// SockPath is the unix socket's own path, inside Dir.
	SockPath string
	// Token is a fresh random hex string, TokenBytes long — a shared secret callers hand to
	// whatever they spawn, checked (constant-time) against every request this socket receives.
	Token string

	wg sync.WaitGroup
}

// Listen creates opts.DirPrefix's own 0700 temp directory, a unix socket named "s" inside it
// (chmod 0600), and a fresh opts.TokenBytes-byte token. A failure at any step cleans up whatever
// it already created.
func Listen(opts Options) (*Listener, error) {
	// POSIX mkdtemp(3) creates the directory 0700 already; os.MkdirTemp is documented to use it —
	// the security boundary both original callers relied on: no other OS user can read the shim,
	// the token or reach the socket.
	dir, err := os.MkdirTemp("", opts.DirPrefix)
	if err != nil {
		return nil, fmt.Errorf("localsock: mkdtemp: %w", err)
	}

	sockPath := filepath.Join(dir, "s")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("localsock: listen: %w", err)
	}
	if err := os.Chmod(sockPath, 0o600); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("localsock: chmod socket: %w", err)
	}

	token, err := RandHex(opts.TokenBytes)
	if err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("localsock: token: %w", err)
	}

	return &Listener{Listener: ln, Dir: dir, SockPath: sockPath, Token: token}, nil
}

// Serve accepts connections until the listener closes, running handle for each in its own
// goroutine — Close waits for every in-flight handle to return before removing Dir. Accept
// returning an error ends the loop unconditionally: the only way either original caller ever stops
// one of these listeners is by closing it themselves, so there is no other error worth
// distinguishing from "closed".
func (l *Listener) Serve(handle func(net.Conn)) {
	for {
		conn, err := l.Accept()
		if err != nil {
			return
		}
		l.wg.Add(1)
		go func() {
			defer l.wg.Done()
			handle(conn)
		}()
	}
}

// Close stops accepting, waits for every Serve handler still in flight, and removes Dir — the
// socket file along with whatever else the caller wrote beside it (a shim script, a generated
// document).
func (l *Listener) Close() error {
	err := l.Listener.Close()
	l.wg.Wait()
	if rmErr := os.RemoveAll(l.Dir); err == nil {
		err = rmErr
	}
	return err
}

// RandHex returns n random bytes, hex-encoded.
func RandHex(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
