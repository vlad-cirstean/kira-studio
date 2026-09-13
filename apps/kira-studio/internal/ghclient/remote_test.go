package ghclient

import "testing"

func TestParseRemote_DocumentedForms(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want Repo
	}{
		{"https", "https://github.com/owner/repo.git", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"https no .git", "https://github.com/owner/repo", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"http", "http://github.example.com/owner/repo.git", Repo{Host: "github.example.com", Owner: "owner", Name: "repo"}},
		{"ssh", "ssh://git@github.com/owner/repo.git", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"ssh with port", "ssh://git@ghe.example.com:2222/owner/repo.git", Repo{Host: "ghe.example.com", Owner: "owner", Name: "repo"}},
		{"scp form", "git@github.com:owner/repo.git", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"scp form no .git", "git@github.com:owner/repo", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"git scheme", "git://github.com/owner/repo.git", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"custom GHES host", "https://git.corp.example/owner/repo.git", Repo{Host: "git.corp.example", Owner: "owner", Name: "repo"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ParseRemote(c.url)
			if !ok {
				t.Fatalf("ParseRemote(%q) reported not-ok, want %+v", c.url, c.want)
			}
			if got != c.want {
				t.Fatalf("ParseRemote(%q) = %+v, want %+v", c.url, got, c.want)
			}
		})
	}
}

// TestParseRemote_SCPFormStripsQueryAndFragment is G31 round-2 architecture/security review,
// finding #6: parseURLForm and parseSSHURLForm both strip a trailing "?..."/"#..." before ever
// splitting into segments, but parseSCPForm (git's scp-like short form) did not — so a remote
// value like "git@github.com:owner/repo?x=1" (or with a "#" fragment) carried the "?x=1" straight
// into Repo.Name, undetected by any of TestParseRemote_DocumentedForms' own scp-form cases (none
// of which include a query or fragment).
func TestParseRemote_SCPFormStripsQueryAndFragment(t *testing.T) {
	cases := []struct {
		name string
		url  string
		want Repo
	}{
		{"query", "git@github.com:owner/repo?x=1", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"fragment", "git@github.com:owner/repo#frag", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
		{"query then .git", "git@github.com:owner/repo.git?x=1", Repo{Host: "github.com", Owner: "owner", Name: "repo"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := ParseRemote(c.url)
			if !ok {
				t.Fatalf("ParseRemote(%q) reported not-ok, want %+v", c.url, c.want)
			}
			if got != c.want {
				t.Fatalf("ParseRemote(%q) = %+v, want %+v (the \"?\"/\"#\" suffix must be stripped, "+
					"not folded into Name)", c.url, got, c.want)
			}
		})
	}
}

// TestRepo_Path_EscapesUnexpectedCharacters is G31 round-2 architecture/security review, finding
// #6: Repo.Path() used to splice Owner/Name into pr.go's `gh api` path strings completely
// unescaped. Those fields are parsed out of a git remote URL rather than validated against
// GitHub's own username/repo-name character set, so a maliciously crafted remote can put a "?" (or
// other URL-special character) into either segment — this proves Path() neutralizes that instead
// of letting it reach `gh api` as a live query-string separator.
func TestRepo_Path_EscapesUnexpectedCharacters(t *testing.T) {
	r := Repo{Host: "github.com", Owner: "owner", Name: "repo?evil=1"}
	got := r.Path()
	want := "owner/repo%3Fevil=1"
	if got != want {
		t.Fatalf("Path() = %q, want %q (the \"?\" must be percent-escaped, not left live)", got, want)
	}
}

func TestParseRemote_RejectsMalformed(t *testing.T) {
	cases := []string{
		"",
		"not a url at all",
		"https://github.com",
		"https://github.com/",
		"https://github.com/onlyowner",
		"https://github.com/group/subgroup/repo",
		"git@github.com",
		"ftp://github.com/owner/repo",
	}
	for _, url := range cases {
		if _, ok := ParseRemote(url); ok {
			t.Fatalf("ParseRemote(%q) reported ok, want rejected", url)
		}
	}
}
