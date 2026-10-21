package agentsandbox

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"io"
	"log"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/elazarl/goproxy"
)

// Allowlist says whether a CONNECT target host may be reached.
type Allowlist func(host string) bool

// HostAllowlist allows the exact hosts and every domain suffix with its subdomains.
func HostAllowlist(exact, suffixes []string) Allowlist {
	return func(host string) bool {
		host = strings.ToLower(host)
		if slices.Contains(exact, host) {
			return true
		}
		for _, s := range suffixes {
			if host == s || strings.HasSuffix(host, "."+s) {
				return true
			}
		}
		return false
	}
}

// Proxy is the loopback CONNECT-only proxy a network-off run reaches the model API through.
type Proxy struct {
	addr   string
	srv    *http.Server
	mu     sync.Mutex
	tokens map[string]proxyRun // token -> run
}

type proxyRun struct {
	id    string
	allow Allowlist
}

// StartProxy listens on a loopback port. Upstream is Kira's own HTTPS_PROXY when set. Each run
// registers its own allowlist.
func StartProxy(h *hub) (*Proxy, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &Proxy{addr: ln.Addr().String(), tokens: map[string]proxyRun{}}
	gp := goproxy.NewProxyHttpServer()
	gp.Logger = log.New(io.Discard, "", 0)
	for _, k := range []string{"HTTPS_PROXY", "https_proxy"} {
		if v := osGetenv(k); v != "" {
			gp.ConnectDial = gp.NewConnectDialToProxy(v)
			break
		}
	}
	gp.OnRequest().HandleConnectFunc(func(host string, ctx *goproxy.ProxyCtx) (*goproxy.ConnectAction, string) {
		reject := func() (*goproxy.ConnectAction, string) {
			ctx.Resp = goproxy.NewResponse(ctx.Req, goproxy.ContentTypeText, http.StatusForbidden, "blocked by the Kira sandbox") //nolint:bodyclose // goproxy writes and closes it
			return goproxy.RejectConnect, host
		}
		run, ok := p.runFor(ctx.Req.Header.Get("Proxy-Authorization"))
		if !ok {
			return reject()
		}
		name, port, err := net.SplitHostPort(host)
		if err != nil || port != "443" || !run.allow(name) {
			h.emit(run.id, Denial{At: time.Now(), Op: "network", Target: host, Process: "proxy"})
			return reject()
		}
		return goproxy.OkConnect, host
	})
	// Plain HTTP carries no CONNECT, so the allowlist never sees it: refuse every such request.
	gp.OnRequest().DoFunc(func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		if run, ok := p.runFor(req.Header.Get("Proxy-Authorization")); ok {
			h.emit(run.id, Denial{At: time.Now(), Op: "network", Target: req.URL.Host, Process: "proxy"})
		}
		return req, goproxy.NewResponse(req, goproxy.ContentTypeText, http.StatusForbidden, "blocked by the Kira sandbox")
	})
	p.srv = &http.Server{Handler: gp, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = p.srv.Serve(ln) }()
	return p, nil
}

// Port is the proxy's loopback port.
func (p *Proxy) Port() int {
	_, port, _ := net.SplitHostPort(p.addr)
	n := 0
	for _, c := range port {
		n = n*10 + int(c-'0')
	}
	return n
}

// Register gives a run its own proxy URL; the token attributes refusals to the run.
func (p *Proxy) Register(runID string, allow Allowlist) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	p.mu.Lock()
	p.tokens[tok] = proxyRun{id: runID, allow: allow}
	p.mu.Unlock()
	return "http://kira:" + tok + "@" + p.addr
}

func (p *Proxy) runFor(header string) (proxyRun, bool) {
	raw, found := strings.CutPrefix(header, "Basic ")
	if !found {
		return proxyRun{}, false
	}
	dec, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return proxyRun{}, false
	}
	_, tok, found := strings.Cut(string(dec), ":")
	if !found {
		return proxyRun{}, false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for t, run := range p.tokens {
		if subtle.ConstantTimeCompare([]byte(t), []byte(tok)) == 1 {
			return run, true
		}
	}
	return proxyRun{}, false
}

func (p *Proxy) release(runID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for t, run := range p.tokens {
		if run.id == runID {
			delete(p.tokens, t)
		}
	}
}
