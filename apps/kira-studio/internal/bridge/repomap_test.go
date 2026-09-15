package bridge_test

import (
	"context"
	"os/exec"
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// noopEmitter satisfies appcore.Emitter — this test never asserts on emitted events.
type noopEmitter struct{}

func (noopEmitter) Emit(string, any)          {}
func (noopEmitter) EmitTo(string, string, any) {}
func (noopEmitter) EmitFocused(string, any)   {}

// fakeRepoMapInstaller satisfies bridge.RepoMapInstaller — this test never installs into Claude Code.
type fakeRepoMapInstaller struct{}

func (fakeRepoMapInstaller) Status() mcpinstall.Status { return mcpinstall.Status{} }
func (fakeRepoMapInstaller) Install(context.Context, string, string, string) mcpinstall.Result {
	return mcpinstall.Result{}
}

// fakeGitLocator always resolves to the given path — gitclient.NewPlatformLocator's own real
// locator is a deliberate "macOS only" stub everywhere else (discovery.go's own unsupportedLocator,
// "Windows/Linux ... not implemented yet"), so a test that needs Discovery.Status to actually
// resolve "ok" on any CI platform supplies its own Locator over the real git binary instead.
type fakeGitLocator struct{ path string }

func (f fakeGitLocator) Locate(string) (string, []string, bool) {
	return f.path, []string{f.path}, true
}

// notFoundLocator never resolves anything — simulates "git is unavailable" without depending on
// the environment actually lacking git.
type notFoundLocator struct{}

func (notFoundLocator) Locate(string) (string, []string, bool) {
	return "", []string{"nowhere"}, false
}

// newRepoMapServiceForTest opens a real (tmpfile-backed) SQLite database through the real
// migrations and wires a real *bridge.RepoMapService against it — mirrors grpc_test.go's own
// newGrpcServiceForTest. locator drives Discovery.Status directly (fakeGitLocator/notFoundLocator
// above), so a test controls "git is healthy" vs. "git is unavailable" without depending on this
// platform's own git.path/PATH state.
func newRepoMapServiceForTest(t *testing.T, locator gitclient.Locator) (*bridge.RepoMapService, *repos.Repos) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("KIRA_HOME", home)
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	repositories, err := repos.New(db.DB)
	if err != nil {
		t.Fatalf("repos.New: %v", err)
	}

	svc := &bridge.RepoMapService{
		Deps:      appcore.Deps{DB: db.DB, Repos: repositories, Events: noopEmitter{}},
		Installer: fakeRepoMapInstaller{},
		Discovery: gitclient.NewDiscovery(locator, gitclient.NewExecRunner(), gitclient.NewRealClock()),
		Runner:    gitclient.NewExecRunner(),
		Home:      home,
	}
	t.Cleanup(func() { bridge.StopRepoMap(svc) })
	return svc, repositories
}

func importCodeRepoForTest(t *testing.T, repositories *repos.Repos, id, name, repoID string) model.CodeRepo {
	t.Helper()
	rec, err := repositories.CodeRepos.Create(model.CodeRepo{
		ID: id, Name: name, Root: t.TempDir(), RepoID: repoID, CreatedAt: "2026-01-01T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("CodeRepos.Create(%s): %v", name, err)
	}
	return rec
}

// statusFor pulls one repository's own status row out of a RepoMapStatus, or nil if absent.
func statusFor(status bridge.RepoMapStatus, id string) *bridge.RepoMapRepoStatus {
	for i := range status.Repos {
		if status.Repos[i].ID == id {
			return &status.Repos[i]
		}
	}
	return nil
}

// TestSetRepoEnabled_KeyDerivationStableAcrossGrantOrder is P68 code review Group 1's own regression
// coverage (findings 1a/1b). Repo A "Kira Studio" and repo B "kira-studio" normalize to the identical
// key ("kira-studio") — imported in that order (A first), so A owns the bare key by CodeRepos.List's
// own stable order, B the "-2" suffix, regardless of which one is GRANTED first.
//
// Before the fix: repoKeys was derived over the granted subset only (1a), so granting B alone gave
// it the bare key (nothing else was granted yet); and Attach ran before an incumbent was rekeyed
// onto its freed-up suffix (1b), so granting A afterward collided with B's already-live bare key,
// failed to attach, and was never retried. This test proves both repositories end up attached, each
// on the key a fresh boot with both granted from the start would have produced.
func TestSetRepoEnabled_KeyDerivationStableAcrossGrantOrder(t *testing.T) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git on PATH in this environment")
	}
	svc, repositories := newRepoMapServiceForTest(t, fakeGitLocator{path: gitPath})

	if _, err := svc.SetEnabled(bridge.RepoMapSetEnabledArgs{Enabled: true}); err != nil {
		t.Fatalf("SetEnabled(true): %v", err)
	}

	repoA := importCodeRepoForTest(t, repositories, "id-a", "Kira Studio", "repoid-a")
	repoB := importCodeRepoForTest(t, repositories, "id-b", "kira-studio", "repoid-b")

	// Grant B first — the order the original bug depended on.
	if _, err := svc.SetRepoEnabled(bridge.RepoMapSetRepoEnabledArgs{ID: repoB.ID, Enabled: true}); err != nil {
		t.Fatalf("SetRepoEnabled(B, true): %v", err)
	}
	if _, err := svc.SetRepoEnabled(bridge.RepoMapSetRepoEnabledArgs{ID: repoA.ID, Enabled: true}); err != nil {
		t.Fatalf("SetRepoEnabled(A, true): %v", err)
	}

	status := svc.Status()
	gotA := statusFor(status, repoA.ID)
	gotB := statusFor(status, repoB.ID)
	if gotA == nil || gotB == nil {
		t.Fatalf("Status().Repos missing an expected row: %+v", status.Repos)
	}

	if !gotA.Serving || gotA.Error != "" {
		t.Errorf("repo A (granted second) = %+v, want Serving with no error — this is 1b's bug: an "+
			"incumbent's key must be freed BEFORE a colliding new attach is attempted", gotA)
	}
	if !gotB.Serving || gotB.Error != "" {
		t.Errorf("repo B = %+v, want Serving with no error", gotB)
	}
	if gotA.Key != "kira-studio" {
		t.Errorf("repo A key = %q, want the bare key %q (1a: derived from the full imported list's "+
			"own stable order, not the grant order)", gotA.Key, "kira-studio")
	}
	if gotB.Key != "kira-studio-2" {
		t.Errorf("repo B key = %q, want the deduped suffix %q", gotB.Key, "kira-studio-2")
	}
}

// TestSetRepoEnabled_RevokeClearsStaleAttachErrEvenNeverAttached is 1c's own regression coverage:
// a repository that never successfully attached (git unavailable at grant time) still has its
// attachErrs entry cleared on revoke, even though it was never in s.keys — the old code only cleared
// attachErrs inside the `s.keys` branch, so this entry used to survive the revoke and render forever
// next to an unchecked checkbox.
func TestSetRepoEnabled_RevokeClearsStaleAttachErrEvenNeverAttached(t *testing.T) {
	svc, repositories := newRepoMapServiceForTest(t, notFoundLocator{})

	if _, err := svc.SetEnabled(bridge.RepoMapSetEnabledArgs{Enabled: true}); err != nil {
		t.Fatalf("SetEnabled(true): %v", err)
	}

	repo := importCodeRepoForTest(t, repositories, "id-c", "broken", "repoid-c")

	if _, err := svc.SetRepoEnabled(bridge.RepoMapSetRepoEnabledArgs{ID: repo.ID, Enabled: true}); err != nil {
		t.Fatalf("SetRepoEnabled(grant): %v", err)
	}
	granted := statusFor(svc.Status(), repo.ID)
	if granted == nil || granted.Serving || granted.Error == "" {
		t.Fatalf("repo after granting with git unavailable = %+v, want an attach error and Serving=false", granted)
	}

	if _, err := svc.SetRepoEnabled(bridge.RepoMapSetRepoEnabledArgs{ID: repo.ID, Enabled: false}); err != nil {
		t.Fatalf("SetRepoEnabled(revoke): %v", err)
	}
	revoked := statusFor(svc.Status(), repo.ID)
	if revoked == nil {
		t.Fatal("repo missing from status after revoke")
	}
	if revoked.Error != "" {
		t.Errorf("repo error after revoke = %q, want \"\" — a repository that never attached must not "+
			"keep displaying a stale attach error forever (1c)", revoked.Error)
	}
}
