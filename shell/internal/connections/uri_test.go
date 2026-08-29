package connections

import "testing"

func strPtr(s string) *string { return &s }

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

func TestInjectURIPassword(t *testing.T) {
	tests := []struct {
		name string
		uri  string
		pass *string
		want string
	}{
		{"nil password is the identity", "postgresql://u@h/db", nil, "postgresql://u@h/db"},
		{"empty password is the identity", "postgresql://u@h/db", strPtr(""), "postgresql://u@h/db"},
		{"injects and encodes", "postgresql://u@h/db", strPtr("p"), "postgresql://u:p@h/db"},
		{"query and fragment untouched", "postgresql://u@h/db?a=b#f", strPtr("p"), "postgresql://u:p@h/db?a=b#f"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := injectURIPassword(tt.uri, tt.pass)
			if got != tt.want {
				t.Errorf("injectURIPassword() = %q, want %q", got, tt.want)
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
