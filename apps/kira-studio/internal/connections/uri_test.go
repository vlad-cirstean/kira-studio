package connections

import "testing"

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

func derefOrNil(s *string) any {
	if s == nil {
		return nil
	}
	return *s
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
