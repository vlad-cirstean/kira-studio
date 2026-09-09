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
