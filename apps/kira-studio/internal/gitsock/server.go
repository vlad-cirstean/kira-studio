package gitsock

import (
	"fmt"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge/rpcstream"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Deps is everything Server needs to listen and serve. SocketPath/LockPath are the two files under
// ${KIRA_HOME} (F5's already-0700 directory); Now is injected so the pairing broker's deadlines are
// testable without a real clock (main.go passes time.Now).
type Deps struct {
	SocketPath    string
	LockPath      string
	Clients       TrustStore
	Handlers      gitrpc.Handlers
	ServerVersion string
	Now           func() time.Time
}

// Server owns the listener, the flock, the pairing broker and the live-connection registry that
// backs revocation (D18). Its zero value is not usable; construct with New.
type Server struct {
	deps   Deps
	broker *Broker

	mu        sync.Mutex
	listening bool
	listener  net.Listener
	lockFile  *os.File
	closeCh   chan struct{}
	conns     map[string][]net.Conn // clientID -> its live connections

	clientsChanged notify.Emitter[[]model.GitClient]

	wg sync.WaitGroup
}

func New(deps Deps) *Server {
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return &Server{deps: deps, broker: NewBroker(deps.Now), conns: map[string][]net.Conn{}}
}

// Broker exposes the pairing broker to bridge.GitClientsService (§3.6) — Approve/Deny/Pending/
// Subscribe all live on it.
func (s *Server) Broker() *Broker { return s.broker }

// OnPairingChanged and OnClientsChanged are bridge/events.go's Sources.Git seam (§3.6) — Server
// is the one thing main.go wires as Sources.Git, so both live here rather than splitting the
// subscription across Server and Broker.
func (s *Server) OnPairingChanged(fn func(PairingSnapshot)) (unsubscribe func()) {
	return s.broker.Subscribe(fn)
}

func (s *Server) OnClientsChanged(fn func([]model.GitClient)) (unsubscribe func()) {
	return s.clientsChanged.Subscribe(fn)
}

// notifyClientsChanged re-reads the trust store and fans it out — called after every write
// (a fresh pairing, a revoke) rather than patching the in-memory list, since G1's volumes make a
// full re-read cheap and it can never drift from what's actually stored.
func (s *Server) notifyClientsChanged() {
	clients, err := s.deps.Clients.List()
	if err != nil {
		slog.Warn("gitsock: list clients for change notification", "scope", "gitsock", "err", err)
		return
	}
	s.clientsChanged.Emit(clients)
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

	s.wg.Add(2)
	go s.acceptLoop()
	go s.expireLoop()
	return nil
}

// expireLoop is the real-time driver behind Broker.ExpireOverdue (D8): a queued request whose
// deadline is measured from enqueue can otherwise only be noticed by whoever next calls Approve/
// Deny, which may be nobody for a lone, unattended request. pairing_test.go drives ExpireOverdue
// directly against an injected clock instead of this loop.
func (s *Server) expireLoop() {
	defer s.wg.Done()
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			s.broker.ExpireOverdue()
		case <-s.closeCh:
			return
		}
	}
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

// handleConn runs the handshake (§3.1.1) and, once it reaches "ready", hands the connection to
// rpcstream.Serve for the rest of its life. The connection is registered under its client id for
// D18's Revoke only after the handshake accepts it — a connection still mid-pairing has no
// identity to revoke yet.
func (s *Server) handleConn(nc net.Conn) {
	defer nc.Close()
	c := newConn(nc)
	clientID, ok := runHandshake(c, handshakeDeps{
		Clients:        s.deps.Clients,
		Broker:         s.broker,
		ServerVersion:  s.deps.ServerVersion,
		Now:            s.deps.Now,
		ClientsChanged: s.notifyClientsChanged,
	})
	if !ok {
		return
	}

	s.addConn(clientID, nc)
	defer s.removeConn(clientID, nc)

	rpcstream.Serve(c, rpcstream.Handlers{
		ContractVersion: gitrpc.ContractVersion,
		Request:         s.deps.Handlers.Request,
		Stream:          s.deps.Handlers.Stream,
	})
}

func (s *Server) addConn(clientID string, nc net.Conn) {
	s.mu.Lock()
	s.conns[clientID] = append(s.conns[clientID], nc)
	s.mu.Unlock()
}

func (s *Server) removeConn(clientID string, nc net.Conn) {
	s.mu.Lock()
	list := s.conns[clientID]
	for i, c := range list {
		if c == nc {
			list = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(list) == 0 {
		delete(s.conns, clientID)
	} else {
		s.conns[clientID] = list
	}
	s.mu.Unlock()
}

// Revoke implements D18's ordering: revoked_at is written first, then every live connection
// holding clientID is closed. The reverse order leaves a window where a connection that just
// reconnected on its still-valid token is silently re-admitted before the write lands.
func (s *Server) Revoke(clientID string) error {
	now := s.deps.Now().UnixMilli()
	if err := s.deps.Clients.Revoke(clientID, now); err != nil {
		return err
	}
	s.mu.Lock()
	live := s.conns[clientID]
	delete(s.conns, clientID)
	s.mu.Unlock()
	for _, nc := range live {
		_ = nc.Close()
	}
	s.notifyClientsChanged()
	return nil
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
