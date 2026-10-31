package azure

import (
	"context"
	"net/url"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/githost"
)

func TestParseRemote(t *testing.T) {
	good := githost.Repo{Host: Host, Owner: "acme/Web App", Name: "api"}
	tests := []struct {
		name, raw string
		want      githost.Repo
		ok        bool
	}{
		{"https", "https://dev.azure.com/acme/Web%20App/_git/api", good, true},
		{"https userinfo is the org", "https://acme@dev.azure.com/acme/Web%20App/_git/api", good, true},
		{"https foreign userinfo", "https://eve@dev.azure.com/acme/Web%20App/_git/api", githost.Repo{}, false},
		{"https .git suffix", "https://dev.azure.com/acme/Web%20App/_git/api.git", good, true},
		{"https project-less", "https://dev.azure.com/acme/_git/api", githost.Repo{}, false},
		{"legacy", "https://acme.visualstudio.com/Web%20App/_git/api", good, true},
		{"legacy collection", "https://acme.visualstudio.com/DefaultCollection/Web%20App/_git/api", good, true},
		{"legacy nested host", "https://a.b.visualstudio.com/P/_git/api", githost.Repo{}, false},
		{"scp v3", "git@ssh.dev.azure.com:v3/acme/Web%20App/api", good, true},
		{"scp vs-ssh", "acme@vs-ssh.visualstudio.com:v3/acme/Web%20App/api", good, true},
		{"scp wrong host", "git@github.com:acme/api.git", githost.Repo{}, false},
		{"scp missing project", "git@ssh.dev.azure.com:v3/acme/api", githost.Repo{}, false},
		{"ssh url port 22", "ssh://git@ssh.dev.azure.com:22/v3/acme/Web%20App/api", good, true},
		{"ssh url no port", "ssh://git@ssh.dev.azure.com/v3/acme/Web%20App/api", good, true},
		{"ssh url port 2222", "ssh://git@ssh.dev.azure.com:2222/v3/acme/Web%20App/api", githost.Repo{}, false},
		{"legacy _ssh", "ssh://acme@acme.visualstudio.com:22/Web%20App/_ssh/api", good, true},
		{"raw space", "https://dev.azure.com/acme/Web App/_git/api", githost.Repo{}, false},
		{"backslash", `https://dev.azure.com/acme/Web\App/_git/api`, githost.Repo{}, false},
		{"control char", "https://dev.azure.com/acme/Web%0aApp/_git/api", githost.Repo{}, false},
		{"escaped slash", "https://dev.azure.com/acme/Web%2fApp/_git/api", githost.Repo{}, false},
		{"empty segment", "https://dev.azure.com/acme//_git/api", githost.Repo{}, false},
		{"github", "https://github.com/acme/api", githost.Repo{}, false},
		{"query", "https://dev.azure.com/acme/Web%20App/_git/api?x=1", githost.Repo{}, false},
		{"git scheme", "git://dev.azure.com/acme/Web%20App/_git/api", githost.Repo{}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ParseRemote(tc.raw)
			if ok != tc.ok || got != tc.want {
				t.Fatalf("ParseRemote(%q) = %+v, %v; want %+v, %v", tc.raw, got, ok, tc.want, tc.ok)
			}
		})
	}
}

func TestParseLinks(t *testing.T) {
	p := New(Options{})
	repo := githost.Repo{Host: Host, Owner: "acme/Web App", Name: "api"}
	ctx := context.Background()

	tests := []struct {
		name, raw string
		link      githost.Link
		linkOK    bool
		branch    githost.BranchLink
		branchOK  bool
	}{
		{
			name: "pull request", raw: "https://dev.azure.com/acme/Web%20App/_git/api/pullrequest/12",
			link: githost.Link{Provider: "azure", Kind: githost.LinkChangeRequest, Ref: "api!12"}, linkOK: true,
			branch: githost.BranchLink{Repo: repo, Number: 12}, branchOK: true,
		},
		{
			name: "pull request files tab and trailing slash", raw: "https://dev.azure.com/acme/Web%20App/_git/api/pullrequest/12/?_a=files",
			link: githost.Link{Provider: "azure", Kind: githost.LinkChangeRequest, Ref: "api!12"}, linkOK: true,
			branch: githost.BranchLink{Repo: repo, Number: 12}, branchOK: true,
		},
		{
			name: "legacy host with collection", raw: "https://acme.visualstudio.com/DefaultCollection/Web%20App/_git/api/pullrequest/7",
			link: githost.Link{Provider: "azure", Kind: githost.LinkChangeRequest, Ref: "api!7"}, linkOK: true,
			branch: githost.BranchLink{Repo: repo, Number: 7}, branchOK: true,
		},
		{
			name: "branch with slash", raw: "https://dev.azure.com/acme/Web%20App/_git/api?version=GBfeature%2Flogin",
			branch: githost.BranchLink{Repo: repo, TreePath: "feature/login"}, branchOK: true,
		},
		{
			name: "branch path param is a file", raw: "https://dev.azure.com/acme/Web%20App/_git/api?path=%2Fsrc%2Fmain.go&version=GBmain",
			branch: githost.BranchLink{Repo: repo, TreePath: "main"}, branchOK: true,
		},
		{name: "tag version", raw: "https://dev.azure.com/acme/Web%20App/_git/api?version=GTv1"},
		{name: "repo without version", raw: "https://dev.azure.com/acme/Web%20App/_git/api"},
		{
			name: "work item", raw: "https://dev.azure.com/acme/Web%20App/_workitems/edit/55?x=1#y",
			link: githost.Link{Provider: "azure", Kind: githost.LinkIssue, Ref: "#55"}, linkOK: true,
			branch: githost.BranchLink{Repo: githost.Repo{Host: Host, Owner: "acme/Web App"}, Number: 55, Issue: true}, branchOK: true,
		},
		{name: "not a number", raw: "https://dev.azure.com/acme/Web%20App/_git/api/pullrequest/x"},
		{name: "http", raw: "http://dev.azure.com/acme/Web%20App/_git/api/pullrequest/12"},
		{name: "other host", raw: "https://github.com/acme/api/pull/12"},
		{name: "junk", raw: "not a url"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			link, ok := p.ParseLink(tc.raw)
			if ok != tc.linkOK || link != tc.link {
				t.Errorf("ParseLink = %+v, %v; want %+v, %v", link, ok, tc.link, tc.linkOK)
			}
			bl, ok := p.ParseBranchLink(ctx, tc.raw)
			if ok != tc.branchOK || bl != tc.branch {
				t.Errorf("ParseBranchLink = %+v, %v; want %+v, %v", bl, ok, tc.branch, tc.branchOK)
			}
		})
	}
}

func TestURLRoundTrip(t *testing.T) {
	p := New(Options{})
	ctx := context.Background()
	for _, repo := range []githost.Repo{
		{Host: Host, Owner: "acme/Web App", Name: "api"},
		{Host: Host, Owner: "acme/Plain", Name: "my repo"},
	} {
		raw := p.ChangeRequestURL(repo, 12)
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if !p.IsChangeRequestURL(ctx, u) {
			t.Errorf("IsChangeRequestURL rejects composed %q", raw)
		}
		bl, ok := p.ParseBranchLink(ctx, raw)
		if !ok || bl.Repo != repo || bl.Number != 12 {
			t.Errorf("ParseBranchLink(%q) = %+v, %v", raw, bl, ok)
		}
		if _, ok := p.ParseLink(raw); !ok {
			t.Errorf("ParseLink rejects composed %q", raw)
		}
		bl, ok = p.ParseBranchLink(ctx, p.BranchURL(repo, "feature/a b"))
		if !ok || bl.Repo != repo || bl.TreePath != "feature/a b" {
			t.Errorf("branch URL round trip = %+v, %v", bl, ok)
		}
		if got, ok := ParseRemote(p.RepoURL(repo)); !ok || got != repo {
			t.Errorf("repo URL is not a remote: %+v, %v", got, ok)
		}
	}
	for _, bad := range []string{
		"https://dev.azure.com.evil/acme/P/_git/api/pullrequest/12",
		"https://dev.azure.com:8443/acme/P/_git/api/pullrequest/12",
		"https://user@dev.azure.com/acme/P/_git/api/pullrequest/12",
		"http://dev.azure.com/acme/P/_git/api/pullrequest/12",
		"https://dev.azure.com/acme/P/_apis/git/repositories/api/pullRequests/12",
		"https://dev.azure.com/acme/P/_git/api/pullrequest/12/extra",
	} {
		u, _ := url.Parse(bad)
		if p.IsChangeRequestURL(ctx, u) {
			t.Errorf("IsChangeRequestURL accepts %q", bad)
		}
	}
}
