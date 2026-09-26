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

// TestSettingsRepo_GitLogLevelDefault is the code review's own regression guard (finding 1):
// advanced.gitLogLevel was added to the zod schema and the Settings dialog but never wired into
// GetAll/Set/DefaultSettings — a patch silently dropped the write. Unset, it must read back
// settings.ts's own default. dateFormat's own case moved to Kira Space (P120: appearance.dateFormat
// is that app's own git-module leaf now, not Studio's).
func TestSettingsRepo_GitLogLevelDefault(t *testing.T) {
	r := newSettingsRepo(t)
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if got.Advanced.GitLogLevel != "info" {
		t.Fatalf("Advanced.GitLogLevel = %q, want %q", got.Advanced.GitLogLevel, "info")
	}
}

func TestSettingsRepo_GitLogLevelRoundTrip(t *testing.T) {
	r := newSettingsRepo(t)
	gitLogLevel := "debug"
	if _, err := r.Set(model.SettingsPatch{
		Advanced: &model.AdvancedPatch{AdvancedCorePatch: appsettings.AdvancedCorePatch{GitLogLevel: &gitLogLevel}},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if got.Advanced.GitLogLevel != "debug" {
		t.Fatalf("Advanced.GitLogLevel = %q, want %q", got.Advanced.GitLogLevel, "debug")
	}
}

func TestSettingsRepo_GitLogLevelRejectInvalid(t *testing.T) {
	r := newSettingsRepo(t)
	bad := "sideways"
	if _, err := r.Set(model.SettingsPatch{Advanced: &model.AdvancedPatch{AdvancedCorePatch: appsettings.AdvancedCorePatch{GitLogLevel: &bad}}}); err == nil {
		t.Fatal("Set(gitLogLevel: \"sideways\") = nil error, want a validation error")
	}
}
