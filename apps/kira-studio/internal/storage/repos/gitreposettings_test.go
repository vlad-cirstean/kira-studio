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
// per-repo, same as LogLevel now (P72 §9.2, below).
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

// TestGitRepoSettingsRepo_LogLevelIsScopedPerRepo is P72 §9.2's own regression guard, the mirror
// image of the G18 §3.5 test this replaces: Set(repoA, {logLevel}) must NOT be visible from
// Get(repoB) any more — the sentinel-row collapse D14 gave this one leaf is deleted (Kira Studio's
// own equivalent is now the independent, genuinely app-wide advanced.gitLogLevel), so LogLevel is
// an ordinary per-repo leaf like GraphPageSize/GithubEnabled above.
func TestGitRepoSettingsRepo_LogLevelIsScopedPerRepo(t *testing.T) {
	r := newGitRepoSettingsRepo(t)
	level := "debug"
	if _, err := r.Set("/repos/a", model.GitRepoSettingsPatch{LogLevel: &level}); err != nil {
		t.Fatalf("Set(a): %v", err)
	}

	gotA, err := r.Get("/repos/a")
	if err != nil {
		t.Fatalf("Get(a): %v", err)
	}
	if gotA.LogLevel != "debug" {
		t.Fatalf("Get(a).LogLevel = %q, want %q", gotA.LogLevel, "debug")
	}

	gotB, err := r.Get("/repos/b")
	if err != nil {
		t.Fatalf("Get(b): %v", err)
	}
	if gotB.LogLevel != model.DefaultGitRepoSettings().LogLevel {
		t.Fatalf("Get(b).LogLevel = %q, want the default (unscoped by a's write)", gotB.LogLevel)
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
