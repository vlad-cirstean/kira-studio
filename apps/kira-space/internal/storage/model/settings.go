package model

import "fmt"

// Kira Space's own trimmed Settings model (P100 Part 1) — Appearance and Git carried over
// verbatim from Kira Studio's own model/settings.go (both are genuinely used by the git module:
// appearance drives the graph/file-viewer rendering, Git is G7 D16's own server-owned git leaves).
// Advanced is trimmed to just GitLogLevel — Kira Studio's own OpLogRetentionDays/
// ExpensiveQueryRows are query-log concerns this app has none of. Data/Cache/Api/DbMcp/ClaudeCode
// are dropped entirely: all five are DB-client-only concerns (page sizes, the query cache budget,
// HTTP client tuning, the embedded DB MCP server, Claude Code hooks) Kira Space has no use for.

type AppearanceSettings struct {
	FontFamily  string `json:"fontFamily"`
	FontSize    int    `json:"fontSize"`
	RowDensity  string `json:"rowDensity"`
	WordWrap    bool   `json:"wordWrap"`
	RowColoring bool   `json:"rowColoring"`
	// InlineBlame is P62's git-blame annotation toggle in the repo file viewer.
	InlineBlame bool `json:"inlineBlame"`
	// DateFormat is P72 §9.1's relative-vs-absolute commit timestamp preference.
	DateFormat string `json:"dateFormat"`
}

type AdvancedSettings struct {
	// GitLogLevel is P72 §9.2's genuinely app-wide replacement for the per-repo
	// kiraSpace.log.level — internal/logging.SetLevel is its actual mechanism.
	GitLogLevel string `json:"gitLogLevel"`
}

// GitSettings mirrors G7 D16's two server-owned git leaves: two windows disagreeing about either
// is a correctness/safety issue (a force-push confirmation that only one window enforces, an
// auto-fetch cadence that differs per viewer), so both live here rather than as VS Code settings.
type GitSettings struct {
	ProtectedBranches []string `json:"protectedBranches"`
	// FetchAutoIntervalMinutes is minutes between automatic background fetches; 0 disables it.
	FetchAutoIntervalMinutes int `json:"fetchAutoIntervalMinutes"`
	// GitPath is G18 D15's fix: this leaf was always classified server-owned but its wiring was
	// dead until that phase. Empty means "auto-discover" — gitclient.Discovery's own existing
	// contract, unvalidated beyond "is a string".
	GitPath string `json:"gitPath"`
	// GraphFontSize is P92 item 9's git-graph font size, in whole pixels; 0 means "follow
	// appearance.fontSize".
	GraphFontSize int `json:"graphFontSize"`
}

type Settings struct {
	Appearance AppearanceSettings `json:"appearance"`
	Advanced   AdvancedSettings   `json:"advanced"`
	Git        GitSettings        `json:"git"`
}

// DefaultSettings mirrors the Appearance/Advanced/Git slice of
// packages/shared/domain/settings.ts's defaultSettings.
func DefaultSettings() Settings {
	return Settings{
		Appearance: AppearanceSettings{
			FontFamily:  "Menlo, monospace",
			FontSize:    12,
			RowDensity:  "comfortable",
			WordWrap:    true,
			RowColoring: true,
			InlineBlame: true,
			DateFormat:  "relative",
		},
		Advanced: AdvancedSettings{
			GitLogLevel: "info",
		},
		Git: GitSettings{
			ProtectedBranches:        []string{"main", "master", "release/*"},
			FetchAutoIntervalMinutes: 0,
			GitPath:                  "",
			GraphFontSize:            0,
		},
	}
}

// AppearancePatch/AdvancedPatch/GitPatch mirror settings.ts's `.partial()` per-section patch
// shapes — every leaf is optional, present only when the caller means to change it.
type AppearancePatch struct {
	FontFamily  *string `json:"fontFamily,omitempty"`
	FontSize    *int    `json:"fontSize,omitempty"`
	RowDensity  *string `json:"rowDensity,omitempty"`
	WordWrap    *bool   `json:"wordWrap,omitempty"`
	RowColoring *bool   `json:"rowColoring,omitempty"`
	InlineBlame *bool   `json:"inlineBlame,omitempty"`
	DateFormat  *string `json:"dateFormat,omitempty"`
}

type AdvancedPatch struct {
	GitLogLevel *string `json:"gitLogLevel,omitempty"`
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

// ValidRowDensity mirrors settings.ts's rowDensitySchema.
func ValidRowDensity(v string) bool {
	return v == "compact" || v == "comfortable"
}

// ValidDateFormat mirrors settings.ts's appearanceSettingsSchema.dateFormat enum.
func ValidDateFormat(v string) bool {
	return v == "relative" || v == "absolute"
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

// validateAppearanceSection mirrors upsertAppearanceSection's section (repos/settings.go) — same
// leaf list, so the two stay in step as one commit.
func validateAppearanceSection(a *AppearancePatch) error {
	if a == nil {
		return nil
	}
	if a.RowDensity != nil && !ValidRowDensity(*a.RowDensity) {
		return fmt.Errorf("model: appearance.rowDensity: invalid value %q", *a.RowDensity)
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
	if a.GitLogLevel != nil && !ValidLogLevel(*a.GitLogLevel) {
		return fmt.Errorf("model: advanced.gitLogLevel: invalid value %q", *a.GitLogLevel)
	}
	return nil
}

func validateGitSection(g *GitPatch) error {
	if g == nil {
		return nil
	}
	if g.FetchAutoIntervalMinutes != nil && !validFetchAutoIntervalMinutes(*g.FetchAutoIntervalMinutes) {
		return fmt.Errorf("model: git.fetchAutoIntervalMinutes: out of range value %d", *g.FetchAutoIntervalMinutes)
	}
	if g.GraphFontSize != nil && !validGraphFontSize(*g.GraphFontSize) {
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
