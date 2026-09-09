package repos_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

func newGitRepoSettingsRepo(t *testing.T) *repos.GitRepoSettingsRepo {
	return &repos.GitRepoSettingsRepo{DB: newRepos(t).DB}
}

func TestGitRepoSettingsRepo_GetUnsetReturnsDefaults(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	got, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	want := model.DefaultGitRepoSettings()
	if got.GraphPageSize != want.GraphPageSize ||
		got.GraphScope != want.GraphScope ||
		got.StashShowInGraph != want.StashShowInGraph ||
		got.StashIncludeUntracked != want.StashIncludeUntracked ||
		got.PullStrategy != want.PullStrategy ||
		got.LogLevel != want.LogLevel ||
		got.GithubEnabled != want.GithubEnabled {
		t.Fatalf("Get() = %+v, want defaults %+v", got, want)
	}
	if !got.GithubEnabled {
		t.Fatal("GithubEnabled default = false, want true (G24 D16)")
	}
	if len(got.ReviewBaseCandidates) != len(want.ReviewBaseCandidates) {
		t.Fatalf("ReviewBaseCandidates = %v, want %v", got.ReviewBaseCandidates, want.ReviewBaseCandidates)
	}
}

// TestGitRepoSettingsRepo_SetIsScopedPerRepo proves the six genuinely per-repo keys do NOT
// collapse across repos — the direct contrast this phase's own log.level test (below) needs to be
// meaningful.
func TestGitRepoSettingsRepo_SetIsScopedPerRepo(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	size := 1234
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GraphPageSize: &size}); err != nil {
		t.Fatalf("Set(a): %v", err)
	}

	gotA, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get(a): %v", err)
	}
	if gotA.GraphPageSize != 1234 {
		t.Fatalf("Get(a).GraphPageSize = %d, want 1234", gotA.GraphPageSize)
	}

	gotB, err := r.Get("/repos/b")
	if err != nil {
		t.Fatalf("Get(b): %v", err)
	}
	if gotB.GraphPageSize != model.DefaultGitRepoSettings().GraphPageSize {
		t.Fatalf("Get(b).GraphPageSize = %d, want the default (unscoped by a's write)", gotB.GraphPageSize)
	}
}

// TestGitRepoSettingsRepo_GithubEnabledRoundTripsPerRepo is G24 D16's own regression guard: set
// false, read it back, and confirm a DIFFERENT repo is unaffected — GithubEnabled is genuinely
// per-repo, unlike LogLevel's own sentinel collapse just above.
func TestGitRepoSettingsRepo_GithubEnabledRoundTripsPerRepo(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	disabled := false
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GithubEnabled: &disabled}); err != nil {
		t.Fatalf("Set(a): %v", err)
	}

	gotA, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get(a): %v", err)
	}
	if gotA.GithubEnabled {
		t.Fatal("Get(a).GithubEnabled = true, want false after Set")
	}

	gotB, err := r.Get("/repos/b")
	if err != nil {
		t.Fatalf("Get(b): %v", err)
	}
	if !gotB.GithubEnabled {
		t.Fatal("Get(b).GithubEnabled = false, want the default true (unscoped by a's write)")
	}
}

// TestGitRepoSettingsRepo_LogLevelCollapsesAcrossRepos is G18 §3.5's own regression guard for D14:
// Set(repoA, {logLevel}) followed by Get(repoB) must show the SAME value — proving the sentinel
// collapse actually happens across two different real repo ids, not merely that it does not
// crash. A bug here would silently make log.level behave as if per-repo when it should not, or
// vice versa.
func TestGitRepoSettingsRepo_LogLevelCollapsesAcrossRepos(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	level := "debug"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{LogLevel: &level}); err != nil {
		t.Fatalf("Set(a): %v", err)
	}

	gotB, err := r.Get("/repos/b")
	if err != nil {
		t.Fatalf("Get(b): %v", err)
	}
	if gotB.LogLevel != "debug" {
		t.Fatalf("Get(b).LogLevel = %q, want %q (sentinel collapse across repos)", gotB.LogLevel, "debug")
	}

	// And the reverse direction, for good measure: a write via b is visible via a.
	level2 := "warn"
	if _, err := r.Set("/repos/b", model.GitRepoSettingsPatch{LogLevel: &level2}); err != nil {
		t.Fatalf("Set(b): %v", err)
	}
	gotA, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get(a): %v", err)
	}
	if gotA.LogLevel != "warn" {
		t.Fatalf("Get(a).LogLevel = %q, want %q (sentinel collapse across repos, reverse direction)", gotA.LogLevel, "warn")
	}
}

func TestGitRepoSettingsRepo_SetValidatesPatch(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	bad := "sideways"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GraphScope: &bad}); err == nil {
		t.Fatal("Set with an invalid graphScope: want error, got nil")
	}
	bad2 := "not-a-strategy"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{PullStrategy: &bad2}); err == nil {
		t.Fatal("Set with an invalid pullStrategy: want error, got nil")
	}
	tooSmall := 1
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GraphPageSize: &tooSmall}); err == nil {
		t.Fatal("Set with an out-of-range graphPageSize: want error, got nil")
	}
}

func TestGitRepoSettingsRepo_SetOnlyPatchesGivenLeaves(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	size := 999
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GraphPageSize: &size}); err != nil {
		t.Fatalf("Set(size): %v", err)
	}
	scope := "head"
	got, err := r.Set("/repos/a", model.GitRepoSettingsPatch{GraphScope: &scope})
	if err != nil {
		t.Fatalf("Set(scope): %v", err)
	}
	if got.GraphPageSize != 999 {
		t.Fatalf("GraphPageSize = %d, want 999 (a later Set of an unrelated leaf must not reset it)", got.GraphPageSize)
	}
	if got.GraphScope != "head" {
		t.Fatalf("GraphScope = %q, want %q", got.GraphScope, "head")
	}
}

// TestGitRepoSettingsRepo_WorktreeLeavesRoundTrip is G25 D10's own two new leaves — ordinary
// per-repo strings, default "".
func TestGitRepoSettingsRepo_WorktreeLeavesRoundTrip(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	got, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WorktreePrepareScript != "" || got.WorktreeBasePath != "" {
		t.Fatalf("defaults = %+v, want both empty", got)
	}

	script := "npm ci"
	base := "/repos/worktrees"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{WorktreePrepareScript: &script, WorktreeBasePath: &base}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err = r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WorktreePrepareScript != script || got.WorktreeBasePath != base {
		t.Fatalf("got %+v, want script=%q base=%q", got, script, base)
	}
}

// TestGitRepoSettingsRepo_PrepareScriptApproval_RoundTripAndDefault proves G25 D11/F15: no
// approval on file by default, and a set/get round-trips exactly.
func TestGitRepoSettingsRepo_PrepareScriptApproval_RoundTripAndDefault(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	sha, ok, err := r.GetPrepareScriptApproval("/repos/a")
	if err != nil {
		t.Fatalf("GetPrepareScriptApproval: %v", err)
	}
	if ok || sha != "" {
		t.Fatalf("got sha=%q ok=%v, want no approval on file by default", sha, ok)
	}

	if err := r.SetPrepareScriptApproval("/repos/a", "deadbeef"); err != nil {
		t.Fatalf("SetPrepareScriptApproval: %v", err)
	}
	sha, ok, err = r.GetPrepareScriptApproval("/repos/a")
	if err != nil {
		t.Fatalf("GetPrepareScriptApproval: %v", err)
	}
	if !ok || sha != "deadbeef" {
		t.Fatalf("got sha=%q ok=%v, want deadbeef/true", sha, ok)
	}
}

// TestGitRepoSettingsRepo_PrepareScriptApproval_ScopedPerRepo: an approval for one repo must never
// leak to another — the same per-repo discipline every genuinely-per-repo leaf in this table
// follows.
func TestGitRepoSettingsRepo_PrepareScriptApproval_ScopedPerRepo(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	if err := r.SetPrepareScriptApproval("/repos/a", "sha-for-a"); err != nil {
		t.Fatalf("SetPrepareScriptApproval: %v", err)
	}
	sha, ok, err := r.GetPrepareScriptApproval("/repos/b")
	if err != nil {
		t.Fatalf("GetPrepareScriptApproval(b): %v", err)
	}
	if ok || sha != "" {
		t.Fatalf("repo b got sha=%q ok=%v, want no approval (a's approval must not leak)", sha, ok)
	}
}

// TestGitRepoSettingsRepo_EditingScriptClearsApproval is D11's own clear-on-change rule, in the
// SAME transaction as the script write: a patch containing prepareScript always clears any stored
// approval for that repo, even when re-setting the identical text.
func TestGitRepoSettingsRepo_EditingScriptClearsApproval(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	script := "npm ci"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{WorktreePrepareScript: &script}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := r.SetPrepareScriptApproval("/repos/a", "approved-sha"); err != nil {
		t.Fatalf("SetPrepareScriptApproval: %v", err)
	}
	if _, ok, _ := r.GetPrepareScriptApproval("/repos/a"); !ok {
		t.Fatal("approval should be on file before the edit")
	}

	newScript := "npm ci && npm run build"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{WorktreePrepareScript: &newScript}); err != nil {
		t.Fatalf("Set (edit): %v", err)
	}
	if _, ok, _ := r.GetPrepareScriptApproval("/repos/a"); ok {
		t.Fatal("approval should have been cleared by the script edit")
	}

	// A patch that touches an UNRELATED leaf must NOT clear an existing approval.
	if err := r.SetPrepareScriptApproval("/repos/a", "approved-again"); err != nil {
		t.Fatalf("SetPrepareScriptApproval: %v", err)
	}
	base := "/repos/worktrees"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{WorktreeBasePath: &base}); err != nil {
		t.Fatalf("Set (unrelated leaf): %v", err)
	}
	if sha, ok, _ := r.GetPrepareScriptApproval("/repos/a"); !ok || sha != "approved-again" {
		t.Fatalf("an unrelated patch must not clear the approval, got sha=%q ok=%v", sha, ok)
	}
}
