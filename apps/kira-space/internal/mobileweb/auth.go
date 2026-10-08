package mobileweb

import (
	"crypto/sha256"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/tokenauth"
)

// cookieName carries `<deviceId>.<token>`. No __Host- prefix: that requires Secure, which a browser
// never honours over plain HTTP. Cookies are not port-scoped, so another HTTP service on the same
// IP would receive it; HttpOnly, SameSite=Strict and the 30-day expiry bound the exposure.
const (
	cookieName = "kira-space-device"
	// deviceTTL is fixed from pairing; a phone pairs again after it.
	deviceTTL  = 30 * 24 * time.Hour
	touchEvery = time.Minute
)

// Auth failure codes on the wire; the phone branches on them.
const (
	codeUnauthorized = "E_UNAUTHORIZED"
	codeRevoked      = "E_REVOKED"
	codeExpired      = "E_EXPIRED"
	codeRateLimited  = "E_RATE_LIMITED"
	codePairDenied   = "E_PAIRING_DENIED"
)

// dummyHash/dummySalt give an unknown device id something to compare against, so a missing row and
// a wrong token cost the same.
var (
	dummyHash = make([]byte, sha256.Size)
	dummySalt = make([]byte, tokenauth.SaltBytes)
)

type verdict int

const (
	verdictOK verdict = iota
	verdictNoCredential
	verdictInvalid
	verdictExpired
	verdictRevoked
	verdictStoreError
)

func parseCookie(r *http.Request) (deviceID, token string, ok bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return "", "", false
	}
	deviceID, token, ok = strings.Cut(c.Value, ".")
	return deviceID, token, ok && deviceID != "" && token != ""
}

// authenticate checks the device cookie. A presented-but-wrong credential is verdictInvalid and
// still runs one hash comparison; a store failure is verdictStoreError, never a rejection of the
// token (a transient DB error must not log a phone out).
func (s *Server) authenticate(r *http.Request) (repos.MobileDeviceRow, verdict) {
	id, token, ok := parseCookie(r)
	if !ok {
		return repos.MobileDeviceRow{}, verdictNoCredential
	}
	row, found, err := s.cfg.Devices.ByID(id)
	if err != nil {
		slog.Warn("mobileweb: device lookup", "scope", "mobileweb", "device", id, "err", err)
		tokenauth.Verify(token, dummyHash, dummySalt)
		return repos.MobileDeviceRow{}, verdictStoreError
	}
	if !found {
		tokenauth.Verify(token, dummyHash, dummySalt)
		return repos.MobileDeviceRow{}, verdictInvalid
	}
	if !tokenauth.Verify(token, row.TokenHash, row.TokenSalt) {
		return repos.MobileDeviceRow{}, verdictInvalid
	}
	if row.ExpiresAt <= s.cfg.Now().UnixMilli() {
		return row, verdictExpired
	}
	if row.RevokedAt != nil {
		return row, verdictRevoked
	}
	return row, verdictOK
}

// remoteIP is the peer address without port; guard already vetted its shape.
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// withDevice guards a handler behind device authentication. Failed guesses are rate limited per
// remote IP; an authenticated device is rate limited per device id.
func (s *Server) withDevice(h func(http.ResponseWriter, *http.Request, repos.MobileDeviceRow)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := remoteIP(r)
		if s.failedAuth.exhausted(ip) {
			writeRateLimited(w)
			return
		}
		dev, v := s.authenticate(r)
		switch v {
		case verdictOK:
		case verdictNoCredential:
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "not paired")
			return
		case verdictStoreError:
			writeError(w, http.StatusServiceUnavailable, "E_UNAVAILABLE", "device store unavailable")
			return
		case verdictExpired:
			s.failedAuth.allow(ip)
			clearCookie(w)
			writeError(w, http.StatusUnauthorized, codeExpired, "device access expired")
			return
		case verdictRevoked:
			s.failedAuth.allow(ip)
			clearCookie(w)
			writeError(w, http.StatusUnauthorized, codeRevoked, "device revoked")
			return
		default:
			s.failedAuth.allow(ip)
			clearCookie(w)
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "invalid credentials")
			return
		}
		if !s.deviceRate.allow(dev.ID) {
			writeRateLimited(w)
			return
		}
		s.touch(dev.ID, ip)
		h(w, r, dev)
	}
}

// touch records last-seen at most once a minute per device.
func (s *Server) touch(id, ip string) {
	now := s.cfg.Now()
	s.touchMu.Lock()
	last, seen := s.touched[id]
	if seen && now.Sub(last) < touchEvery {
		s.touchMu.Unlock()
		return
	}
	s.touched[id] = now
	s.touchMu.Unlock()
	if err := s.cfg.Devices.TouchLastSeen(id, now.UnixMilli(), ip); err != nil {
		slog.Warn("mobileweb: touch last seen", "scope", "mobileweb", "device", id, "err", err)
	}
}

func setCookie(w http.ResponseWriter, deviceID, token string, maxAge time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: deviceID + "." + token, Path: "/", MaxAge: int(maxAge / time.Second),
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
}

func clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
}

// sameOriginRequest is the CSRF check for every state-changing method: the browser-set Origin
// must be this server's own http origin, and Fetch Metadata, when sent, must say same-origin. The
// cookie is SameSite=Strict as well; this is the second, independent layer.
func sameOriginRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || !strings.EqualFold(u.Host, r.Host) {
		return false
	}
	// Browsers send Fetch Metadata only to trustworthy origins, so it is absent over plain HTTP.
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin"
}

func isSafeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// csrfGuard wraps a route whose method can change state, and every WebSocket upgrade: a GET that
// opens a terminal is as dangerous as a POST, and browsers do not apply CORS to it.
func csrfGuard(rt route, next http.Handler) http.Handler {
	checked := rt.kind == kindUpgrade
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if (checked || !isSafeMethod(r.Method)) && !sameOriginRequest(r) {
			writeError(w, http.StatusForbidden, "E_FORBIDDEN", "cross-origin request refused")
			return
		}
		next.ServeHTTP(w, r)
	})
}
