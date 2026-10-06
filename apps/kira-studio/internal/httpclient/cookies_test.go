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
