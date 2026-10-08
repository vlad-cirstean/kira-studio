package mobileweb

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
)

// setupHandler serves the plain-HTTP setup listener: the setup page and the public CA certificate
// a phone must install before it can trust the HTTPS app. Nothing secret and no API.
func (s *Server) setupHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/setup.html"
		serveAsset(s.cfg.Assets, w, r, false)
	})
	mux.HandleFunc("GET /assets/", func(w http.ResponseWriter, r *http.Request) {
		serveAsset(s.cfg.Assets, w, r, false)
	})
	mux.HandleFunc("GET /kira-space-ca.crt", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		ca := s.ca
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/x-x509-ca-cert")
		w.Header().Set("Content-Disposition", `attachment; filename="kira-space-ca.crt"`)
		_, _ = w.Write(ca.DER())
	})
	mux.HandleFunc("GET /kira-space-ca.mobileconfig", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		ca := s.ca
		s.mu.Unlock()
		w.Header().Set("Content-Type", "application/x-apple-aspen-config")
		w.Header().Set("Content-Disposition", `attachment; filename="kira-space-ca.mobileconfig"`)
		_, _ = w.Write([]byte(mobileConfig(ca)))
	})
	mux.HandleFunc("GET /setup-info", func(w http.ResponseWriter, _ *http.Request) {
		st := s.Status()
		writeJSON(w, http.StatusOK, map[string]any{"fingerprint": st.Fingerprint, "appUrls": st.AppURLs})
	})
	h := securityHeaders(mux)
	return noStore(h)
}

// mobileConfig is an unsigned iOS configuration profile that installs the CA as a root. The
// payload UUIDs derive from the fingerprint, so re-downloading the same CA replaces, not
// duplicates.
func mobileConfig(ca *CA) string {
	fp := ca.Fingerprint()
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("kira-space-ca:"+fp))
	inner := uuid.NewSHA1(uuid.NameSpaceURL, []byte("kira-space-ca-payload:"+fp))
	cert := base64.StdEncoding.EncodeToString(ca.DER())
	var b strings.Builder
	fmt.Fprintf(&b, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadCertificateFileName</key><string>kira-space-ca.cer</string>
<key>PayloadContent</key><data>%s</data>
<key>PayloadDescription</key><string>Trusts the Kira Space local certificate authority.</string>
<key>PayloadDisplayName</key><string>Kira Space local CA</string>
<key>PayloadIdentifier</key><string>app.kira-space.ca.cert</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>%s</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></array>
<key>PayloadDisplayName</key><string>Kira Space local CA</string>
<key>PayloadIdentifier</key><string>app.kira-space.ca</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>%s</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>
`, cert, inner, id)
	return b.String()
}
