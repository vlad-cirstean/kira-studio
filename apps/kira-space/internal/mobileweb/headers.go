package mobileweb

import (
	"fmt"
	"net/http"
	"regexp"
)

// The policy's connect-src names this request's host with wss: because older WebKit does not
// match a WebSocket against 'self'. The host already passed guard's allowlist; the pattern only
// keeps a malformed value out of a header.
const cspBase = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; connect-src 'self'%s; manifest-src 'self'; worker-src 'self'; " +
	"frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

var cspHostRe = regexp.MustCompile(`^[A-Za-z0-9.\-:\[\]]{1,255}$`)

func contentSecurityPolicy(host string) string {
	extra := ""
	if cspHostRe.MatchString(host) {
		extra = " wss://" + host
	}
	return fmt.Sprintf(cspBase, extra)
}

// securityHeaders sets the hardening headers on every response, errors included.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy(r.Host))
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		next.ServeHTTP(w, r)
	})
}
