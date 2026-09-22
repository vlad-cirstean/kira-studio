package repos_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/appsettings"
)

func newSettingsRepo(t *testing.T) *repos.SettingsRepo {
	return &repos.SettingsRepo{DB: newRepos(t).DB}
}

// TestSettingsRepo_DateFormatAndGitLogLevelDefault is the code review's own regression guard
// (finding 1): appearance.dateFormat and advanced.gitLogLevel were added to the zod schema and
// the Settings dialog but never wired into GetAll/Set/DefaultSettings — a patch to either leaf
// silently dropped the write. Unset, both must read back settings.ts's own defaults.
func TestSettingsRepo_DateFormatAndGitLogLevelDefault(t *testing.T) {
	r := newSettingsRepo(t)
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if got.Appearance.DateFormat != "relative" {
		t.Fatalf("Appearance.DateFormat = %q, want %q", got.Appearance.DateFormat, "relative")
	}
	if got.Advanced.GitLogLevel != "info" {
		t.Fatalf("Advanced.GitLogLevel = %q, want %q", got.Advanced.GitLogLevel, "info")
	}
}

func TestSettingsRepo_DateFormatAndGitLogLevelRoundTrip(t *testing.T) {
	r := newSettingsRepo(t)
	dateFormat := "absolute"
	gitLogLevel := "debug"
	if _, err := r.Set(model.SettingsPatch{
		Appearance: &appsettings.AppearancePatch{DateFormat: &dateFormat},
		Advanced:   &model.AdvancedPatch{AdvancedCorePatch: appsettings.AdvancedCorePatch{GitLogLevel: &gitLogLevel}},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if got.Appearance.DateFormat != "absolute" {
		t.Fatalf("Appearance.DateFormat = %q, want %q", got.Appearance.DateFormat, "absolute")
	}
	if got.Advanced.GitLogLevel != "debug" {
		t.Fatalf("Advanced.GitLogLevel = %q, want %q", got.Advanced.GitLogLevel, "debug")
	}
}

func TestSettingsRepo_DateFormatAndGitLogLevelRejectInvalid(t *testing.T) {
	r := newSettingsRepo(t)
	bad := "sideways"
	if _, err := r.Set(model.SettingsPatch{Appearance: &appsettings.AppearancePatch{DateFormat: &bad}}); err == nil {
		t.Fatal("Set(dateFormat: \"sideways\") = nil error, want a validation error")
	}
	if _, err := r.Set(model.SettingsPatch{Advanced: &model.AdvancedPatch{AdvancedCorePatch: appsettings.AdvancedCorePatch{GitLogLevel: &bad}}}); err == nil {
		t.Fatal("Set(gitLogLevel: \"sideways\") = nil error, want a validation error")
	}
}
