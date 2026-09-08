package gitrpc

import (
	"context"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
)

// recordingLocator is a gitclient.Locator fake that records every configuredPath it was asked to
// resolve — this test's only interest is proving that value reached Discovery.Status at all, not
// what a real probe would do with it, so it always reports "not found" (the cheapest honest
// answer that still exercises probe()'s own configuredPath argument, discovery.go:249).
type recordingLocator struct {
	got []string
}

func (r *recordingLocator) Locate(configuredPath string) (string, []string, bool) {
	r.got = append(r.got, configuredPath)
	return "", nil, false
}

// TestHandleAppInit_UsesConfiguredGitPath is G18 §3.19's own regression guard for D15: app.init's
// `git` field must be resolved against a real, configured git.path — via Registry.Settings' own
// widened three-value closure — rather than always calling Discovery.Status(ctx, "").
func TestHandleAppInit_UsesConfiguredGitPath(t *testing.T) {
	loc := &recordingLocator{}
	discovery := gitclient.NewDiscovery(loc, nil, gitclient.NewRealClock())

	reg := gitsession.NewRegistry(nil)
	reg.Settings = func() ([]string, int, string) { return nil, 0, "/opt/configured/git" }

	router := New(Deps{Discovery: discovery, Registry: reg, ServerVersion: "test"})
	result := router.handleAppInit(context.Background())

	if len(loc.got) != 1 || loc.got[0] != "/opt/configured/git" {
		t.Fatalf("Discovery.Status was resolved against %v, want exactly [\"/opt/configured/git\"]", loc.got)
	}
	if result.Git.Kind != "notFound" {
		t.Fatalf("Git.Kind = %q, want %q (recordingLocator always reports not found)", result.Git.Kind, "notFound")
	}
}

// TestHandleRepoOpen_UsesConfiguredGitPath is the same guard for repo.open's own Discovery.Status
// call site (handlers.go:196).
func TestHandleRepoOpen_UsesConfiguredGitPath(t *testing.T) {
	loc := &recordingLocator{}
	discovery := gitclient.NewDiscovery(loc, nil, gitclient.NewRealClock())

	reg := gitsession.NewRegistry(nil)
	reg.Settings = func() ([]string, int, string) { return nil, 0, "/opt/configured/git" }

	router := New(Deps{Discovery: discovery, Registry: reg, ServerVersion: "test"})
	conn := gitsession.NewConn("conn-1", "client-1", "label", nil)
	t.Cleanup(conn.Close)

	result, err := router.handleRepoOpen(context.Background(), conn, []byte(`{"path":"/tmp/some/repo"}`))
	if err != nil {
		t.Fatalf("handleRepoOpen: %v", err)
	}
	opened, ok := result.(RepoOpenResult)
	if !ok {
		t.Fatalf("handleRepoOpen result = %T, want RepoOpenResult", result)
	}
	if opened.Kind != "gitUnavailable" || opened.Git == nil || opened.Git.Kind != "notFound" {
		t.Fatalf("handleRepoOpen result = %+v, want gitUnavailable/notFound", opened)
	}
	if len(loc.got) != 1 || loc.got[0] != "/opt/configured/git" {
		t.Fatalf("Discovery.Status was resolved against %v, want exactly [\"/opt/configured/git\"]", loc.got)
	}
}
