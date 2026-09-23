package connections

import (
	"testing"

	"github.com/kirathecat/kira-studio/internal/testx"
)

func strPtr(s string) *string { return &s }

// TestStripURIPassword covers the userinfo surgery's interacting rules: find the authority (which
// ends at the first /, ? or #), split at the LAST '@' and the FIRST ':' inside it, percent-decode
// what is left, and drop the '@' entirely when the username is empty — all without touching a
// byte outside the authority.
func TestStripURIPassword(t *testing.T) {
	tests := []struct {
		name     string
		uri      string
		wantURI  string
		wantPass *string
	}{
		{"userinfo with port", "postgresql://u:p@h:5432/db", "postgresql://u@h:5432/db", strPtr("p")},
		{"no password", "postgresql://u@h/db", "postgresql://u@h/db", nil},
		{"empty username", "postgresql://:p@h/db", "postgresql://h/db", strPtr("p")},
		{"percent-encoded password", "postgres://u:p%40x@h/db", "postgres://u@h/db", strPtr("p@x")},
		{"not a uri", "not a uri", "not a uri", nil},
		{"query and fragment untouched", "postgresql://u:p@h/db?a=b#f", "postgresql://u@h/db?a=b#f", strPtr("p")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotURI, gotPass := stripURIPassword(tt.uri)
			if gotURI != tt.wantURI {
				t.Errorf("uri = %q, want %q", gotURI, tt.wantURI)
			}
			if (gotPass == nil) != (tt.wantPass == nil) || (gotPass != nil && *gotPass != *tt.wantPass) {
				t.Errorf("password = %v, want %v", derefOrNil(gotPass), derefOrNil(tt.wantPass))
			}
		})
	}
}

// derefOrNil is testx.DerefOrNil (P107 I2-28).
var derefOrNil = testx.DerefOrNil

// TestURIHasAmbiguousPassword is F3 (P108 Part 3): findAuthority ends the authority at the first
// /, ? or # after "://", so an unencoded one of those inside a password truncates the detected
// authority before the real '@' — stripURIPassword then reports no password at all, and the raw
// URI (password included) would be stored and returned as-is. This is the guard that rejects
// that shape at validateMode instead.
func TestURIHasAmbiguousPassword(t *testing.T) {
	tests := []struct {
		name string
		uri  string
		want bool
	}{
		{"raw slash in password", "postgres://u:pa/ss@h/db", true},
		{"raw question mark in password", "postgres://u:pa?ss@h/db", true},
		{"raw hash in password", "postgres://u:pa#ss@h/db", true},
		{"well-formed, no delimiter before the real @", "postgres://u:pass@h/db", false},
		{"well-formed with query string", "postgres://u:pass@h/db?sslmode=require", false},
		{"percent-encoded slash in password", "mysql://root:my%2Fpass@h/db", false},
		{"host:port, no userinfo at all", "postgres://h:5432/db", false},
		{"host:port with an unrelated later @ in the path", "postgres://h:5432/db@extra", false},
		{"no scheme separator", "not a uri", false},
		{"no delimiter after the authority at all", "postgres://u:pa/ss@h", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := uriHasAmbiguousPassword(tt.uri); got != tt.want {
				t.Errorf("uriHasAmbiguousPassword(%q) = %v, want %v", tt.uri, got, tt.want)
			}
		})
	}
}

func TestURIPasswordRoundTripSurvivesSpecialCharacters(t *testing.T) {
	// A password containing '@' and ':' must survive an inject-then-strip round trip: inject
	// percent-encodes it, so the '@'/':' inside it never gets mistaken for userinfo/authority
	// delimiters when stripped back out.
	const original = "p@ss:w0rd"
	uri := injectURIPassword("postgresql://u@h/db", strPtr(original))
	strippedURI, got := stripURIPassword(uri)
	if strippedURI != "postgresql://u@h/db" {
		t.Errorf("stripped uri = %q, want postgresql://u@h/db", strippedURI)
	}
	if got == nil || *got != original {
		t.Errorf("round-tripped password = %v, want %q", derefOrNil(got), original)
	}
}
