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
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/elazarl/goproxy"
)

// Allowlist says whether a CONNECT target host may be reached.
type Allowlist func(host string) bool

// ProxyAllowlist is the Claude API host set: anthropic.com, claude.ai and claude.com with their
// subdomains, the hosts of the base-URL variables, and the cloud providers' suffixes when the
// matching CLAUDE_CODE_USE_* switch is on.
func ProxyAllowlist(getenv func(string) string) Allowlist {
	exact := map[string]bool{}
	for _, k := range []string{"ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL"} {
		if u, err := url.Parse(getenv(k)); err == nil && u.Hostname() != "" {
			exact[strings.ToLower(u.Hostname())] = true
		}
	}
	suffixes := []string{"anthropic.com", "claude.ai", "claude.com"}
	if getenv("CLAUDE_CODE_USE_BEDROCK") == "1" {
		suffixes = append(suffixes, "amazonaws.com")
	}
	if getenv("CLAUDE_CODE_USE_VERTEX") == "1" {
		suffixes = append(suffixes, "googleapis.com")
	}
	return func(host string) bool {
		host = strings.ToLower(host)
		if exact[host] {
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
	tokens map[string]string // token -> run id
}

// StartProxy listens on a loopback port. Upstream is Kira's own HTTPS_PROXY when set.
func StartProxy(h *hub, allow Allowlist) (*Proxy, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &Proxy{addr: ln.Addr().String(), tokens: map[string]string{}}
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
		runID, ok := p.runFor(ctx.Req.Header.Get("Proxy-Authorization"))
		if !ok {
			return reject()
		}
		name, port, err := net.SplitHostPort(host)
		if err != nil || port != "443" || !allow(name) {
			h.emit(runID, Denial{At: time.Now(), Op: "network", Target: host, Process: "proxy"})
			return reject()
		}
		return goproxy.OkConnect, host
	})
	// Plain HTTP carries no CONNECT, so the allowlist never sees it: refuse every such request.
	gp.OnRequest().DoFunc(func(req *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
		if runID, ok := p.runFor(req.Header.Get("Proxy-Authorization")); ok {
			h.emit(runID, Denial{At: time.Now(), Op: "network", Target: req.URL.Host, Process: "proxy"})
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
func (p *Proxy) Register(runID string) string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	tok := hex.EncodeToString(b)
	p.mu.Lock()
	p.tokens[tok] = runID
	p.mu.Unlock()
	return "http://kira:" + tok + "@" + p.addr
}

func (p *Proxy) runFor(header string) (string, bool) {
	raw, found := strings.CutPrefix(header, "Basic ")
	if !found {
		return "", false
	}
	dec, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", false
	}
	_, tok, found := strings.Cut(string(dec), ":")
	if !found {
		return "", false
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for t, run := range p.tokens {
		if subtle.ConstantTimeCompare([]byte(t), []byte(tok)) == 1 {
			return run, true
		}
	}
	return "", false
}

func (p *Proxy) release(runID string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for t, run := range p.tokens {
		if run == runID {
			delete(p.tokens, t)
		}
	}
}
