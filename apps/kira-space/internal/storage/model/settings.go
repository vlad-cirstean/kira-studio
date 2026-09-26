package model

import (
	"fmt"

	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// Kira Space's own trimmed Settings model (P100 Part 1). Data/Cache/Api/DbMcp/ClaudeCode are
// dropped entirely: all five are DB-client-only concerns (page sizes, the query cache budget, HTTP
// client tuning, the embedded DB MCP server, Claude Code hooks) Kira Space has no use for.
// Appearance/Advanced/Git are this app's own (P120): the only app with a git module, so the two
// appearance leaves only the git module uses (InlineBlame/DateFormat), its own diagnostic-log leaf
// (GitLogLevel — Kira Studio's own is a same-shaped but separately named/keyed advanced.logLevel,
// not a shared struct any more) and the server-owned git leaves (G7 D16) all live here rather than
// in the shared appsettings package.
type AdvancedSettings struct {
	// GitLogLevel is P72 §9.2's genuinely app-wide replacement for the per-repo kiraSpace.log.level
	// (renamed from kiraVersion.log.level, P100 Part 3); internal/logging.SetLevel is its actual
	// mechanism. Validated against the shared appsettings.ValidLogLevel enum.
	GitLogLevel string `json:"gitLogLevel"`
}

// Appearance embeds appsettings.Appearance for the five leaves both apps share, plus the two only
// this app's git module uses: InlineBlame (P62's git-blame annotation toggle in the repo file
// viewer) and DateFormat (P72 §9.1's relative-vs-absolute commit timestamp preference). The
// embedding flattens on the wire — encoding/json promotes an embedded struct's fields on both
// marshal and unmarshal.
type Appearance struct {
	appsettings.Appearance
	InlineBlame bool   `json:"inlineBlame"`
	DateFormat  string `json:"dateFormat"`
}

// GitSettings mirrors G7 D16's two server-owned git leaves: two windows disagreeing about either
// is a correctness/safety issue (a force-push confirmation that only one window enforces, an
// auto-fetch cadence that differs per viewer), so both live here rather than as VS Code settings.
type GitSettings struct {
	ProtectedBranches []string `json:"protectedBranches"`
	// FetchAutoIntervalMinutes is minutes between automatic background fetches; 0 disables it.
	FetchAutoIntervalMinutes int `json:"fetchAutoIntervalMinutes"`
	// GitPath is G18 D15's fix: this leaf was always classified server-owned but its wiring was
	// dead (Discovery.Status(ctx, "") hardcoded at every call site) until that phase. Empty means
	// "auto-discover" — gitclient.Discovery's own existing contract, unvalidated beyond "is a
	// string" (a bad path is tolerated the same way Discovery's own probe already falls through
	// its classified-error states rather than pre-validating).
	GitPath string `json:"gitPath"`
	// GraphFontSize is P92 item 9's git-graph font size, in whole pixels; 0 means "follow
	// appearance.fontSize" — see settingsDomain.ts's own doc comment for the propagation path
	// (--kira-graph-font-size -> --vscode-font-size, git-ui's only consumer of that token).
	GraphFontSize int `json:"graphFontSize"`
}

type Settings struct {
	Appearance Appearance       `json:"appearance"`
	Advanced   AdvancedSettings `json:"advanced"`
	Git        GitSettings      `json:"git"`
}

// DefaultGitSettings mirrors docs/v1.3/plans/G7 D16's own default: the same three-pattern default
// upstream's own kiraVersion.protectedBranches carried, before that phase moved it server-side.
func DefaultGitSettings() GitSettings {
	return GitSettings{
		ProtectedBranches:        []string{"main", "master", "release/*"},
		FetchAutoIntervalMinutes: 0,
		GitPath:                  "",
		GraphFontSize:            0,
	}
}

// DefaultSettings mirrors the Appearance/Advanced/Git slice of
// packages/shared/domain/settings.ts's defaultSettings.
func DefaultSettings() Settings {
	return Settings{
		Appearance: Appearance{
			Appearance:  appsettings.DefaultAppearance(),
			InlineBlame: true,
			DateFormat:  "relative",
		},
		Advanced: AdvancedSettings{GitLogLevel: "info"},
		Git:      DefaultGitSettings(),
	}
}

// AdvancedPatch mirrors AdvancedSettings' own `.partial()` shape.
type AdvancedPatch struct {
	GitLogLevel *string `json:"gitLogLevel,omitempty"`
}

// AppearancePatch embeds appsettings.AppearancePatch for the five leaves both apps share, plus this
// app's own two (InlineBlame/DateFormat) — same embedding AdvancedPatch uses.
type AppearancePatch struct {
	appsettings.AppearancePatch
	InlineBlame *bool   `json:"inlineBlame,omitempty"`
	DateFormat  *string `json:"dateFormat,omitempty"`
}

// ValidDateFormat mirrors settingsDomain.ts's appearanceSettingsSchema.dateFormat enum (P120: only
// this app's git module has a dateFormat leaf).
func ValidDateFormat(v string) bool {
	return v == "relative" || v == "absolute"
}

// GitPatch mirrors GitSettings' own `.partial()` shape (G7 D16).
type GitPatch struct {
	ProtectedBranches        *[]string `json:"protectedBranches,omitempty"`
	FetchAutoIntervalMinutes *int      `json:"fetchAutoIntervalMinutes,omitempty"`
	GitPath                  *string   `json:"gitPath,omitempty"`
	GraphFontSize            *int      `json:"graphFontSize,omitempty"`
}

type SettingsPatch struct {
	Appearance *AppearancePatch `json:"appearance,omitempty"`
	Advanced   *AdvancedPatch   `json:"advanced,omitempty"`
	Git        *GitPatch        `json:"git,omitempty"`
}

// validateAppearanceSection mirrors upsertAppearance's own leaf list (repos/settings.go).
func validateAppearanceSection(a *AppearancePatch) error {
	if a == nil {
		return nil
	}
	if err := appsettings.ValidateAppearance(&a.AppearancePatch); err != nil {
		return err
	}
	if a.DateFormat != nil && !ValidDateFormat(*a.DateFormat) {
		return fmt.Errorf("model: appearance.dateFormat: invalid value %q", *a.DateFormat)
	}
	return nil
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

// ValidFetchAutoIntervalMinutes and ValidGraphFontSize are exported (not just used by
// validateGitSection below): repos/settings.go's own readGit needs the identical bound to filter a
// stored leaf on read, the same way the former appsettings.ReadGit did in one package with its own
// validators.
var (
	ValidFetchAutoIntervalMinutes = appsettings.InRange(0, 1440)
	// P92 item 9: settingsDomain.ts's own FONT_SIZE_RANGE, floored at 0 (the "follow the app"
	// sentinel) rather than FONT_SIZE_RANGE.min — the schema's own comment states why.
	ValidGraphFontSize = appsettings.InRange(0, 24)
)

// validateGitSection mirrors upsertGit's own leaf list (repos/settings.go).
func validateGitSection(g *GitPatch) error {
	if g == nil {
		return nil
	}
	if g.FetchAutoIntervalMinutes != nil && !ValidFetchAutoIntervalMinutes(*g.FetchAutoIntervalMinutes) {
		return fmt.Errorf("model: git.fetchAutoIntervalMinutes: out of range value %d", *g.FetchAutoIntervalMinutes)
	}
	if g.GraphFontSize != nil && !ValidGraphFontSize(*g.GraphFontSize) {
		return fmt.Errorf("model: git.graphFontSize: out of range value %d", *g.GraphFontSize)
	}
	return nil
}

// Validate checks every leaf the caller actually patched against settings.ts's bounds, naming the
// offending leaf in the error — fontFamily and fontSize have no bounds in the TS schema either, so
// they are accepted as-is.
func (p SettingsPatch) Validate() error {
	if err := validateAppearanceSection(p.Appearance); err != nil {
		return err
	}
	if err := validateAdvancedSection(p.Advanced); err != nil {
		return err
	}
	if err := validateGitSection(p.Git); err != nil {
		return err
	}
	return nil
}
