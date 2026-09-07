package gitsock

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"
)

// Deps is everything Server needs to listen and serve. SocketPath/LockPath are the two files under
// ${KIRA_HOME} (F5's already-0700 directory); Now is injected so the pairing broker's deadlines are
// testable without a real clock (main.go passes time.Now).
type Deps struct {
	SocketPath string
	LockPath   string
	Now        func() time.Time
}

// Server owns the listener, the flock and the live-connection registry that backs revocation
// (D18). Its zero value is not usable; construct with New.
type Server struct {
	deps Deps

	mu        sync.Mutex
	listening bool
	listener  net.Listener
	lockFile  *os.File
	closeCh   chan struct{}
	conns     map[string][]net.Conn // clientID -> its live connections

	wg sync.WaitGroup
}

func New(deps Deps) *Server {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return &Server{deps: deps, conns: map[string][]net.Conn{}}
}

// Start performs D5's five-step sequence. A failure to acquire the lock, or any other startup
// error, is returned but never fatal to the caller (main.go logs and continues booting) — the app
// must never fail to start because the git socket could not (D5).
func (s *Server) Start() error {
	lockFile, acquired, err := acquireLock(s.deps.LockPath)
	if err != nil {
		return fmt.Errorf("gitsock: acquire lock: %w", err)
	}
	if !acquired {
		slog.Info("git socket: another instance is already serving", "scope", "gitsock")
		return nil
	}

	if err := os.Remove(s.deps.SocketPath); err != nil && !os.IsNotExist(err) {
		_ = lockFile.Close()
		return fmt.Errorf("gitsock: remove stale socket: %w", err)
	}
	ln, err := net.Listen("unix", s.deps.SocketPath)
	if err != nil {
		_ = lockFile.Close()
		return fmt.Errorf("gitsock: listen: %w", err)
	}
	// The 0700 parent (F5) is the real boundary; Go applies the process umask to the socket inode,
	// so the mode is set explicitly here as defence in depth rather than assumed.
	if err := os.Chmod(s.deps.SocketPath, 0o600); err != nil {
		_ = ln.Close()
		_ = lockFile.Close()
		return fmt.Errorf("gitsock: chmod socket: %w", err)
	}

	s.mu.Lock()
	s.listener = ln
	s.lockFile = lockFile
	s.listening = true
	s.closeCh = make(chan struct{})
	s.mu.Unlock()

	s.wg.Add(1)
	go s.acceptLoop()
	return nil
}

func (s *Server) acceptLoop() {
	defer s.wg.Done()
	for {
		nc, err := s.listener.Accept()
		if err != nil {
			return // listener closed by Close() — normal shutdown.
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.handleConn(nc)
		}()
	}
}

// handleConn is filled in once the handshake exists (C5); until then every accepted connection is
// simply closed, which is a complete and honest intermediate state (§7 C3).
func (s *Server) handleConn(nc net.Conn) {
	_ = nc.Close()
}

// Close unlinks the socket (net.UnixListener's default on Close), closes every live connection,
// then releases the lock. Safe to call on a Server that never listened (another instance was
// serving, or Start failed).
func (s *Server) Close() error {
	s.mu.Lock()
	if !s.listening {
		s.mu.Unlock()
		return nil
	}
	s.listening = false
	ln := s.listener
	lockFile := s.lockFile
	close(s.closeCh)
	var live []net.Conn
	for _, cs := range s.conns {
		live = append(live, cs...)
	}
	s.conns = map[string][]net.Conn{}
	s.mu.Unlock()

	for _, nc := range live {
		_ = nc.Close()
	}
	var err error
	if ln != nil {
		err = ln.Close()
	}
	s.wg.Wait()
	if lockFile != nil {
		_ = lockFile.Close()
	}
	return err
}
