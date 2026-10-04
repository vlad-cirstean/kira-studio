package ade

import "testing"

// TestMainDisplay covers a local-only main, a remote-tracking main, and a nested branch name under
// a remote (`a/b`).
func TestMainDisplay(t *testing.T) {
	cases := []struct {
		name, full, wantName, wantRef string
	}{
		{"local", "refs/heads/main", "main", "main"},
		{"remote", "refs/remotes/origin/main", "main", "origin/main"},
		{"remote nested branch", "refs/remotes/origin/a/b", "a/b", "origin/a/b"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gotName, gotRef := mainDisplay(c.full)
			if gotName != c.wantName || gotRef != c.wantRef {
				t.Errorf("mainDisplay(%q) = (%q, %q), want (%q, %q)", c.full, gotName, gotRef, c.wantName, c.wantRef)
			}
		})
	}
}
