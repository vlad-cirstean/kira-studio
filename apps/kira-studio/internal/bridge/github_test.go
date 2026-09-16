package bridge

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// fakeGhAuthRunner answers `gh --version`/`gh auth status --hostname <host>` as always-ok for any
// host — this file's own minimal stand-in for ghclient.Runner (F13: no real `gh` in this
// container), mirroring gitsession's own countingGhRunner/fakeGhLocator without importing them
// across the package boundary (they are unexported _test.go fakes of a different package).
type fakeGhAuthRunner struct{}

func (fakeGhAuthRunner) Run(_ context.Context, _ string, _ ghclient.Spec) (ghclient.Result, error) {
	return ghclient.Result{ExitCode: 0, Stdout: []byte("gh version 2.42.0 (2024-01-08)\n")}, nil
}

type fakeGhLocator struct{}

func (fakeGhLocator) Locate() (string, []string, bool) {
	return "/usr/local/bin/gh", []string{"/usr/local/bin/gh"}, true
}

type fakeBrowser struct {
	opened string
	calls  int
}

func (b *fakeBrowser) OpenURL(url string) error {
	b.opened = url
	b.calls++
	return nil
}

// registryKnowing returns a *gitsession.Registry whose Gh has already probed every host in hosts
// successfully (Discovery.Status, called directly — the same seeding gitsession's own gh_test.go
// achieves indirectly through a full RepoEntry resolve, done here without one since this test only
// needs Client.Hosts to report them).
func registryKnowing(hosts ...string) *gitsession.Registry {
	disc := ghclient.NewDiscovery(fakeGhLocator{}, fakeGhAuthRunner{}, ghclient.NewRealClock())
	for _, h := range hosts {
		disc.Status(context.Background(), h)
	}
	return &gitsession.Registry{Gh: ghclient.NewClient(disc, fakeGhAuthRunner{})}
}

func TestGitHubService_OpenPullRequestURL(t *testing.T) {
	tests := []struct {
		name    string
		deps    appcore.Deps
		url     string
		wantErr bool
	}{
		{
			name: "github.com accepted with no registry wired",
			url:  "https://github.com/owner/repo/pull/42",
		},
		{
			name:    "unknown host rejected with no registry wired",
			url:     "https://ghe.example.com/owner/repo/pull/42",
			wantErr: true,
		},
		{
			name: "GHES host accepted once the registry has authenticated against it",
			deps: appcore.Deps{GitRegistry: registryKnowing("ghe.example.com")},
			url:  "https://ghe.example.com/owner/repo/pull/42",
		},
		{
			name:    "a host absent from the registry's known hosts is still rejected",
			deps:    appcore.Deps{GitRegistry: registryKnowing("ghe.example.com")},
			url:     "https://evil.example.com/owner/repo/pull/42",
			wantErr: true,
		},
		{
			name:    "non-https scheme rejected",
			deps:    appcore.Deps{GitRegistry: registryKnowing("ghe.example.com")},
			url:     "http://ghe.example.com/owner/repo/pull/42",
			wantErr: true,
		},
		{
			name:    "malformed pull-request path rejected",
			deps:    appcore.Deps{GitRegistry: registryKnowing("ghe.example.com")},
			url:     "https://ghe.example.com/owner/repo/issues/42",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			browser := &fakeBrowser{}
			svc := &GitHubService{Deps: tt.deps, Browser: browser}
			err := svc.OpenPullRequestURL(GitHubOpenPullRequestURLArgs{URL: tt.url})
			if tt.wantErr {
				if err == nil {
					t.Fatalf("OpenPullRequestURL(%q) = nil error, want one", tt.url)
				}
				if browser.calls != 0 {
					t.Fatalf("OpenPullRequestURL(%q): browser.OpenURL called on a rejected URL", tt.url)
				}
				return
			}
			if err != nil {
				t.Fatalf("OpenPullRequestURL(%q): %v", tt.url, err)
			}
			if browser.opened != tt.url {
				t.Fatalf("browser.opened = %q, want %q", browser.opened, tt.url)
			}
		})
	}
}
