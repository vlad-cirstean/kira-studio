// Package appsettings is P103 Part 4 (§7.1)'s hoist of the settings sections that were
// byte-identical, field for field and tag for tag, in both apps' own storage/model/settings.go:
// AppearanceSettings (7 fields), GitSettings (4 fields), and the one leaf AdvancedSettings shares,
// GitLogLevel. Each app's own Settings composes Appearance/Git here alongside its own per-app
// sections (Kira Studio's Data/Cache/Api/DbMcp/ClaudeCode; Kira Space has none), and each app's own
// AdvancedSettings embeds AdvancedCore for the one leaf that's genuinely shared.
package appsettings

import "fmt"

// Appearance mirrors both apps' own former AppearanceSettings verbatim.
type Appearance struct {
	FontFamily  string `json:"fontFamily"`
	FontSize    int    `json:"fontSize"`
	RowDensity  string `json:"rowDensity"`
	WordWrap    bool   `json:"wordWrap"`
	RowColoring bool   `json:"rowColoring"`
	// InlineBlame is P62's git-blame annotation toggle in the repo file viewer.
	InlineBlame bool `json:"inlineBlame"`
	// DateFormat is P72 §9.1's relative-vs-absolute commit timestamp preference, moved here from
	// the per-repo RepoSettingsDialog.vue/PersistedViewState.
	DateFormat string `json:"dateFormat"`
}

// Git mirrors G7 D16's two server-owned git leaves: two windows disagreeing about either is a
// correctness/safety issue (a force-push confirmation that only one window enforces, an
// auto-fetch cadence that differs per viewer), so both live here rather than as VS Code settings.
type Git struct {
	ProtectedBranches []string `json:"protectedBranches"`
	// FetchAutoIntervalMinutes is minutes between automatic background fetches; 0 disables it.
	FetchAutoIntervalMinutes int `json:"fetchAutoIntervalMinutes"`
	// GitPath is G18 D15's fix: this leaf was always classified server-owned but its wiring was
	// dead (Discovery.Status(ctx, "") hardcoded at every call site) until this phase. Empty means
	// "auto-discover" — gitclient.Discovery's own existing contract, unvalidated beyond "is a
	// string" (a bad path is tolerated the same way Discovery's own probe already falls through
	// its classified-error states rather than pre-validating).
	GitPath string `json:"gitPath"`
	// GraphFontSize is P92 item 9's git-graph font size, in whole pixels; 0 means "follow
	// appearance.fontSize" — see settings.ts's own doc comment for the propagation path
	// (--kira-graph-font-size -> --vscode-font-size, git-ui's only consumer of that token).
	GraphFontSize int `json:"graphFontSize"`
}

// AdvancedCore is the one Advanced leaf both apps share — GitLogLevel is P72 §9.2's genuinely
// app-wide replacement for the per-repo kiraSpace.log.level (renamed from kiraVersion.log.level,
// P100 Part 3); internal/logging.SetLevel is its actual mechanism. Each app's own AdvancedSettings
// embeds this for the leaf, alongside whatever other leaves are genuinely per-app (Kira Studio's
// OpLogRetentionDays/ExpensiveQueryRows; Kira Space has none).
type AdvancedCore struct {
	GitLogLevel string `json:"gitLogLevel"`
}

// AppearancePatch mirrors Appearance's own `.partial()` shape — every leaf optional, present only
// when the caller means to change it (D15: SettingsRepo.Set writes only the leaves actually
// patched).
type AppearancePatch struct {
	FontFamily  *string `json:"fontFamily,omitempty"`
	FontSize    *int    `json:"fontSize,omitempty"`
	RowDensity  *string `json:"rowDensity,omitempty"`
	WordWrap    *bool   `json:"wordWrap,omitempty"`
	RowColoring *bool   `json:"rowColoring,omitempty"`
	InlineBlame *bool   `json:"inlineBlame,omitempty"`
	DateFormat  *string `json:"dateFormat,omitempty"`
}

// GitPatch mirrors Git's own `.partial()` shape (G7 D16).
type GitPatch struct {
	ProtectedBranches        *[]string `json:"protectedBranches,omitempty"`
	FetchAutoIntervalMinutes *int      `json:"fetchAutoIntervalMinutes,omitempty"`
	GitPath                  *string   `json:"gitPath,omitempty"`
	GraphFontSize            *int      `json:"graphFontSize,omitempty"`
}

// AdvancedCorePatch mirrors AdvancedCore's own `.partial()` shape — each app's own AdvancedPatch
// embeds this for the one leaf it patches through the shared mechanism.
type AdvancedCorePatch struct {
	GitLogLevel *string `json:"gitLogLevel,omitempty"`
}

// DefaultAppearance mirrors packages/shared/domain/settings.ts's defaultSettings.appearance.
func DefaultAppearance() Appearance {
	return Appearance{
		FontFamily:  "Menlo, monospace",
		FontSize:    12,
		RowDensity:  "comfortable",
		WordWrap:    true,
		RowColoring: true,
		InlineBlame: true,
		DateFormat:  "relative",
	}
}

// DefaultGit mirrors docs/v1.3/plans/G7 D16's own default: the same three-pattern default
// upstream's own kiraVersion.protectedBranches carried, before that phase moved it server-side.
func DefaultGit() Git {
	return Git{
		ProtectedBranches:        []string{"main", "master", "release/*"},
		FetchAutoIntervalMinutes: 0,
		GitPath:                  "",
		GraphFontSize:            0,
	}
}

// ValidRowDensity mirrors settings.ts's rowDensitySchema.
func ValidRowDensity(v string) bool {
	return v == "compact" || v == "comfortable"
}

// ValidDateFormat mirrors settings.ts's appearanceSettingsSchema.dateFormat enum.
func ValidDateFormat(v string) bool {
	return v == "relative" || v == "absolute"
}

// ValidLogLevel mirrors settings.ts's gitLogLevelSchema enum (kiraSpace.log.level before P100
// Part 3's rename to advanced.gitLogLevel). Also the validator behind Kira Space's own per-repo
// GitRepoSettings.LogLevel leaf — the same enum, genuinely reused, not merely parallel.
func ValidLogLevel(v string) bool {
	switch v {
	case "off", "error", "warn", "info", "debug":
		return true
	default:
		return false
	}
}

// InRange returns a predicate matching settings.ts's z.number().int().min(lo).max(hi).
func InRange(lo, hi int) func(int) bool {
	return func(v int) bool { return v >= lo && v <= hi }
}

var (
	validFetchAutoIntervalMinutes = InRange(0, 1440)
	// P92 item 9: settings.ts's own FONT_SIZE_RANGE, floored at 0 (the "follow the app" sentinel)
	// rather than FONT_SIZE_RANGE.min — the schema's own comment states why.
	validGraphFontSize = InRange(0, 24)
)

// ValidateAppearance mirrors upsertAppearanceSection's own leaf list (repo.go) — same set, so the
// two stay in step as one commit.
func ValidateAppearance(a *AppearancePatch) error {
	if a == nil {
		return nil
	}
	if a.RowDensity != nil && !ValidRowDensity(*a.RowDensity) {
		return fmt.Errorf("appsettings: appearance.rowDensity: invalid value %q", *a.RowDensity)
	}
	if a.DateFormat != nil && !ValidDateFormat(*a.DateFormat) {
		return fmt.Errorf("appsettings: appearance.dateFormat: invalid value %q", *a.DateFormat)
	}
	return nil
}

// ValidateGit mirrors upsertGitSection's own leaf list (repo.go).
func ValidateGit(g *GitPatch) error {
	if g == nil {
		return nil
	}
	if g.FetchAutoIntervalMinutes != nil && !validFetchAutoIntervalMinutes(*g.FetchAutoIntervalMinutes) {
		return fmt.Errorf("appsettings: git.fetchAutoIntervalMinutes: out of range value %d", *g.FetchAutoIntervalMinutes)
	}
	if g.GraphFontSize != nil && !validGraphFontSize(*g.GraphFontSize) {
		return fmt.Errorf("appsettings: git.graphFontSize: out of range value %d", *g.GraphFontSize)
	}
	return nil
}
