package httpclient

import (
	"net/http"
	"net/url"
	"testing"
)

// TestDeleteJarCookieRemovesPathAndDomainScopedCookies guards P168 Part 6 F12: a bare expiring Set
// keys on the URL's host and directory and silently misses Path=/ and parent-Domain cookies.
func TestDeleteJarCookieRemovesPathAndDomainScopedCookies(t *testing.T) {
	cases := []struct {
		name   string
		setURL string
		cookie http.Cookie
	}{
		{"root path from deep url", "https://api.example.com/login", http.Cookie{Name: "sid", Value: "1", Path: "/"}},
		{"parent domain", "https://api.example.com/login", http.Cookie{Name: "sid", Value: "1", Domain: "example.com", Path: "/"}},
		{"intermediate path", "https://api.example.com/api/x", http.Cookie{Name: "sid", Value: "1", Path: "/api"}},
		{"host only default path", "https://api.example.com/api/v1/users", http.Cookie{Name: "sid", Value: "1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			old := currentJar()
			ClearJar()
			t.Cleanup(func() { jarMu.Lock(); sharedJar = old; jarMu.Unlock() })

			setU, _ := url.Parse(tc.setURL)
			c := tc.cookie
			currentJar().SetCookies(setU, []*http.Cookie{&c, {Name: "keep", Value: "2", Path: "/"}})

			target := "https://api.example.com/api/v1/users"
			if err := DeleteJarCookie(target, "sid"); err != nil {
				t.Fatalf("DeleteJarCookie: %v", err)
			}
			got, _ := JarCookies(target)
			if len(got) != 1 || got[0].Name != "keep" {
				t.Fatalf("cookies after delete = %+v, want only keep", got)
			}
		})
	}
}

// TestDeleteJarCookieCanonicalisesHost guards P168 Part 7 F3/F4: the jar rejects a non-canonical
// Domain attribute, and Send defaults a scheme-less URL to https.
func TestDeleteJarCookieCanonicalisesHost(t *testing.T) {
	cases := []struct {
		name, setURL, domain, target string
	}{
		{"idn host", "https://a.xn--bcher-kva.example/x", "xn--bcher-kva.example", "https://a.bücher.example/x"},
		{"trailing dot", "https://a.example.com/x", "example.com", "https://a.example.com./x"},
		{"scheme-less", "https://a.example.com/x", "example.com", "a.example.com/x"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			old := currentJar()
			ClearJar()
			t.Cleanup(func() { jarMu.Lock(); sharedJar = old; jarMu.Unlock() })

			setU, _ := url.Parse(tc.setURL)
			currentJar().SetCookies(setU, []*http.Cookie{{Name: "sid", Value: "1", Domain: tc.domain, Path: "/"}})
			if got, _ := JarCookies(tc.target); len(got) != 1 {
				t.Fatalf("cookies before delete = %+v, want sid", got)
			}
			if err := DeleteJarCookie(tc.target, "sid"); err != nil {
				t.Fatalf("DeleteJarCookie: %v", err)
			}
			if got, _ := JarCookies(tc.target); len(got) != 0 {
				t.Fatalf("cookies after delete = %+v, want none", got)
			}
		})
	}
}
