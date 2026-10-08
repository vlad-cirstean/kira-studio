package mobileweb

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sync/singleflight"
	"golang.org/x/time/rate"
)

// Config wires the server to the services it reads and the narrow Writer it writes through.
type Config struct {
	Reader Reader
	// Writer, Terminals and AgentInputEnabled are optional: without them the matching routes answer
	// 503 (Writer, Terminals) or refuse agent input (AgentInputEnabled).
	Writer            Writer
	Terminals         TerminalBroker
	AgentInputEnabled func() bool
	AgentSessions     func() any
	Devices           DeviceStore
	Hub               *Hub
	// Broker outlives the server: the desktop approval dialog stays subscribed across restarts.
	Broker *Broker
	// Assets is the mobile build (index.html, setup.html, assets/, sw.js, manifest).
	Assets fs.FS
	// CADir holds ca.key and ca.crt.
	CADir     string
	HTTPSPort int
	SetupPort int
	// Now, Addrs and OnDevicesChanged are optional (defaults: time.Now, PrivateAddrs, none).
	Now              func() time.Time
	Addrs            func() ([]net.IP, error)
	OnDevicesChanged func()
}

// Status is what the desktop pane shows.
type Status struct {
	Running       bool
	AppURLs       []string
	SetupURLs     []string
	Fingerprint   string
	LeafExpiresAt int64
}

// Server is the mobile web server: one HTTPS listener per bound address for the app and
// API, and one plain-HTTP listener per address for the setup page.
type Server struct {
	cfg Config

	failedAuth *limiterSet
	deviceRate *limiterSet
	pairRate   *limiterSet
	writeRate  *limiterSet
	attachRate *limiterSet
	idem       *idemStore
	flight     singleflight.Group

	touchMu sync.Mutex
	touched map[string]time.Time

	mu          sync.Mutex
	running     bool
	ca          *CA
	certs       CertHolder
	bound       []net.IP
	mdns        string
	leafExpires time.Time
	servers     []*http.Server
	baseCancel  context.CancelFunc
	stop        chan struct{}
	wg          sync.WaitGroup
}

func New(cfg Config) *Server {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Addrs == nil {
		cfg.Addrs = PrivateAddrs
	}
	return &Server{
		cfg:        cfg,
		failedAuth: newLimiterSet(rate.Every(time.Minute), 10, cfg.Now),
		deviceRate: newLimiterSet(20, 40, cfg.Now),
		pairRate:   newLimiterSet(rate.Every(10*time.Second), 3, cfg.Now),
		writeRate:  newLimiterSet(1, 10, cfg.Now),
		attachRate: newLimiterSet(rate.Every(2*time.Second), 3, cfg.Now),
		idem:       newIdemStore(idemTTL),
		touched:    map[string]time.Time{},
	}
}

// Start binds every listener or none: a failure closes what already opened.
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return nil
	}
	ca, err := LoadOrCreateCA(s.cfg.CADir)
	if err != nil {
		return err
	}
	ips, err := s.cfg.Addrs()
	if err != nil {
		return err
	}
	mdns := mdnsName()
	var names []string
	if mdns != "" {
		names = []string{mdns}
	}
	leaf, expires, err := ca.IssueLeaf(ips, names, s.cfg.Now())
	if err != nil {
		return err
	}
	s.ca, s.bound, s.mdns, s.leafExpires = ca, ips, mdns, expires
	s.certs.Set(leaf)

	tlsConf := &tls.Config{
		MinVersion: tls.VersionTLS12, GetCertificate: s.certs.GetCertificate, NextProtos: []string{"http/1.1"},
	}
	baseCtx, cancel := context.WithCancel(context.Background())
	appHandler := s.guard(securityHeaders(s.appMux()))
	setupHandler := s.guard(s.setupHandler())

	var listeners []net.Listener
	var servers []*http.Server
	closeAll := func() {
		cancel()
		for _, l := range listeners {
			_ = l.Close()
		}
	}
	for _, ip := range ips {
		for _, p := range []struct {
			port    int
			handler http.Handler
			tls     bool
		}{{s.cfg.HTTPSPort, appHandler, true}, {s.cfg.SetupPort, setupHandler, false}} {
			ln, err := net.Listen("tcp4", net.JoinHostPort(ip.String(), strconv.Itoa(p.port)))
			if err != nil {
				closeAll()
				return listenError(ip, p.port, err)
			}
			listeners = append(listeners, ln)
			if p.tls {
				ln = tls.NewListener(ln, tlsConf)
			}
			servers = append(servers, &http.Server{
				Handler: p.handler, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second,
				MaxHeaderBytes: 16 << 10, BaseContext: func(net.Listener) context.Context { return baseCtx },
			})
			listeners[len(listeners)-1] = ln
		}
	}
	s.servers, s.baseCancel, s.stop, s.running = servers, cancel, make(chan struct{}), true
	for i, srv := range servers {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			if err := srv.Serve(listeners[i]); err != nil && !errors.Is(err, http.ErrServerClosed) {
				slog.Warn("mobileweb: serve", "scope", "mobileweb", "err", err)
			}
		}()
	}
	s.wg.Add(1)
	go s.maintain(s.stop)
	return nil
}

func listenError(ip net.IP, port int, err error) error {
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("mobileweb: port %d is in use on %s; choose another port in Settings", port, ip)
	}
	return fmt.Errorf("mobileweb: listen on %s:%d: %w", ip, port, err)
}

// maintain sweeps idle limiter entries and renews the leaf before it expires.
func (s *Server) maintain(stop <-chan struct{}) {
	defer s.wg.Done()
	sweep := time.NewTicker(time.Minute)
	defer sweep.Stop()
	renew := time.NewTicker(24 * time.Hour)
	defer renew.Stop()
	for {
		select {
		case <-sweep.C:
			s.failedAuth.sweep()
			s.deviceRate.sweep()
			s.pairRate.sweep()
			s.writeRate.sweep()
			s.attachRate.sweep()
			s.sweepTouched()
		case <-renew.C:
			s.renewLeaf()
		case <-stop:
			return
		}
	}
}

func (s *Server) sweepTouched() {
	cutoff := s.cfg.Now().Add(-touchEvery)
	s.touchMu.Lock()
	defer s.touchMu.Unlock()
	for id, at := range s.touched {
		if at.Before(cutoff) {
			delete(s.touched, id)
		}
	}
}

func (s *Server) renewLeaf() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running || s.leafExpires.Sub(s.cfg.Now()) > 30*24*time.Hour {
		return
	}
	var names []string
	if s.mdns != "" {
		names = []string{s.mdns}
	}
	leaf, expires, err := s.ca.IssueLeaf(s.bound, names, s.cfg.Now())
	if err != nil {
		slog.Warn("mobileweb: renew certificate", "scope", "mobileweb", "err", err)
		return
	}
	s.certs.Set(leaf)
	s.leafExpires = expires
}

// guard refuses a peer outside loopback/RFC 1918 and a Host header that names anything but a bound
// address, this machine's .local name or localhost (DNS-rebinding guard).
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		bound, mdns := s.bound, s.mdns
		s.mu.Unlock()
		if !allowedRemote(r.RemoteAddr) || !hostAllowed(r.Host, bound, mdns) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Close stops accepting, releases parked pairing requests and open streams, then drains with a 5s
// grace before forcing connections shut. Safe to call when stopped.
func (s *Server) Close() error {
	s.mu.Lock()
	if !s.running {
		s.mu.Unlock()
		return nil
	}
	s.running = false
	servers, cancel, stop := s.servers, s.baseCancel, s.stop
	s.servers = nil
	s.mu.Unlock()

	// Cancelling the base context fires each parked pair request's AfterFunc, so Shutdown does not
	// wait out the 120s approval window.
	cancel()
	close(stop)
	s.cfg.Hub.CloseAll()
	if s.cfg.Terminals != nil {
		s.cfg.Terminals.ReleaseAll("server stopped")
	}
	ctx, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	var firstErr error
	for _, srv := range servers {
		if err := srv.Shutdown(ctx); err != nil {
			_ = srv.Close()
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	s.wg.Wait()
	return firstErr
}

// Status reports the running state and the URLs a phone opens.
func (s *Server) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{Running: s.running}
	if s.ca != nil {
		st.Fingerprint = s.ca.Fingerprint()
	}
	if !s.running {
		return st
	}
	st.LeafExpiresAt = s.leafExpires.UnixMilli()
	hosts := make([]string, 0, len(s.bound)+1)
	for _, ip := range s.bound {
		hosts = append(hosts, ip.String())
	}
	if s.mdns != "" {
		hosts = append(hosts, s.mdns)
	}
	for _, h := range hosts {
		st.AppURLs = append(st.AppURLs, "https://"+net.JoinHostPort(h, strconv.Itoa(s.cfg.HTTPSPort))+"/")
		st.SetupURLs = append(st.SetupURLs, "http://"+net.JoinHostPort(h, strconv.Itoa(s.cfg.SetupPort))+"/")
	}
	return st
}

// CA returns the running server's authority (nil before the first Start).
func (s *Server) CA() *CA {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ca
}

// Revoke marks the device revoked, then ends its streams. The store write comes first so a
// reconnect racing the disconnect is already refused.
func (s *Server) Revoke(id string) error {
	if err := s.cfg.Devices.Revoke(id, s.cfg.Now().UnixMilli()); err != nil {
		return err
	}
	s.cfg.Hub.DisconnectDevice(id)
	if s.cfg.Terminals != nil {
		s.cfg.Terminals.ReleaseDevice(id)
	}
	return nil
}

// PermissionsChanged ends a device's terminals when its agent input flag is off. The desktop
// calls it after storing new flags.
func (s *Server) PermissionsChanged(id string) {
	if s.cfg.Terminals == nil {
		return
	}
	row, found, err := s.cfg.Devices.ByID(id)
	if err != nil {
		slog.Warn("mobileweb: device lookup", "scope", "mobileweb", "device", id, "err", err)
		return
	}
	if !found || row.RevokedAt != nil || !row.CanAgentInput {
		s.cfg.Terminals.ReleaseDevice(id)
	}
}
