package model

import (
	"fmt"

	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// Kira Space's own trimmed Settings model (P100 Part 1). Appearance and Git are
// appsettings.Appearance/appsettings.Git (P103 Part 4 §7.1) — both are genuinely used by the git
// module: appearance drives the graph/file-viewer rendering, Git is G7 D16's own server-owned git
// leaves. Advanced embeds appsettings.AdvancedCore for the one leaf this app owns, GitLogLevel —
// Kira Studio's own OpLogRetentionDays/ExpensiveQueryRows are query-log concerns this app has none
// of. Data/Cache/Api/DbMcp/ClaudeCode are dropped entirely: all five are DB-client-only concerns
// (page sizes, the query cache budget, HTTP client tuning, the embedded DB MCP server, Claude Code
// hooks) Kira Space has no use for.

type AdvancedSettings struct {
	appsettings.AdvancedCore
}

type Settings struct {
	Appearance appsettings.Appearance `json:"appearance"`
	Advanced   AdvancedSettings       `json:"advanced"`
	Git        appsettings.Git        `json:"git"`
}

// DefaultSettings mirrors the Appearance/Advanced/Git slice of
// packages/shared/domain/settings.ts's defaultSettings.
func DefaultSettings() Settings {
	return Settings{
		Appearance: appsettings.DefaultAppearance(),
		Advanced:   AdvancedSettings{AdvancedCore: appsettings.AdvancedCore{GitLogLevel: "info"}},
		Git:        appsettings.DefaultGit(),
	}
}

// AdvancedPatch embeds appsettings.AdvancedCorePatch for the one leaf this app patches through the
// shared mechanism (GitLogLevel). Appearance/Git's own patch shapes are appsettings.
// AppearancePatch/appsettings.GitPatch directly (P103 Part 4 §7.1).
type AdvancedPatch struct {
	appsettings.AdvancedCorePatch
}

type SettingsPatch struct {
	Appearance *appsettings.AppearancePatch `json:"appearance,omitempty"`
	Advanced   *AdvancedPatch               `json:"advanced,omitempty"`
	Git        *appsettings.GitPatch        `json:"git,omitempty"`
}

func validateAdvancedSection(a *AdvancedPatch) error {
	if a == nil {
		return nil
	}
	if a.GitLogLevel != nil && !appsettings.ValidLogLevel(*a.GitLogLevel) {
		return fmt.Errorf("model: advanced.gitLogLevel: invalid value %q", *a.GitLogLevel)
	}
	return nil
}

// Validate checks every leaf the caller actually patched against settings.ts's bounds, naming the
// offending leaf in the error — fontFamily and fontSize have no bounds in the TS schema either, so
// they are accepted as-is.
func (p SettingsPatch) Validate() error {
	if err := appsettings.ValidateAppearance(p.Appearance); err != nil {
		return err
	}
	if err := validateAdvancedSection(p.Advanced); err != nil {
		return err
	}
	if err := appsettings.ValidateGit(p.Git); err != nil {
		return err
	}
	return nil
}
