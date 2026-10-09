package model

import (
	"fmt"
	"regexp"

	"github.com/kirathecat/kira-studio/internal/appsettings"
)

// Kira Space's own trimmed Settings model (P100 Part 1). Data/Cache/Api/DbMcp are dropped
// entirely: all four are DB-client-only concerns (page sizes, the query cache budget, HTTP client
// tuning, the embedded DB MCP server) Kira Space has no use for. ClaudeCode is P188's own leaf.
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

// AdeSettings is P129 Part 2 §7's own UiPrefs-as-settings-leaves: Part 3's queue-board layout and
// planning-horizon preferences, persisted so they survive a relaunch. No UI reads them yet.
type AdeSettings struct {
	// PanelWidth is the queue side panel's own width in px; 0 means "half the window" (Part 3's own
	// layout default) rather than a literal zero-width panel.
	PanelWidth      int      `json:"panelWidth"`
	HorizonDays     int      `json:"horizonDays"`
	HistoryDays     int      `json:"historyDays"`
	ExtraDays       []string `json:"extraDays"`
	OffDays         []string `json:"offDays"`
	WorkWeekendDays []string `json:"workWeekendDays"`
	WorkdayHours    float64  `json:"workdayHours"`
	SpanDayShare    float64  `json:"spanDayShare"`
	// HeadlessSettingSources is the claude -p --setting-sources scope: "all" (user, project, local)
	// or "user" (ignore repo-committed settings).
	HeadlessSettingSources string `json:"headlessSettingSources"`
}

// ClaudeCodeSettings is P188's keep-awake-with-agents leaf: on, this Mac stays awake while any
// Claude Code session runs (a terminal agent tab or a running headless ade session), independent of
// the title bar's own keep-awake toggle. Off by default — an OS power assertion is opt-in.
type ClaudeCodeSettings struct {
	KeepAwakeWithAgents bool `json:"keepAwakeWithAgents"`
	// Notify* are P238's desktop-notification leaves, all on by default: NotifyEnabled is the master
	// switch, the next three pick which events notify, NotifyIncludeMessage puts the reply text in
	// the body.
	NotifyEnabled        bool `json:"notifyEnabled"`
	NotifyOnFinished     bool `json:"notifyOnFinished"`
	NotifyOnNeedsInput   bool `json:"notifyOnNeedsInput"`
	NotifyOnRunEnded     bool `json:"notifyOnRunEnded"`
	NotifyIncludeMessage bool `json:"notifyIncludeMessage"`
}

// DefaultClaudeCodeSettings mirrors settingsDomain.ts's claudeCodeSettingsSchema defaults.
func DefaultClaudeCodeSettings() ClaudeCodeSettings {
	return ClaudeCodeSettings{
		NotifyEnabled: true, NotifyOnFinished: true, NotifyOnNeedsInput: true, NotifyOnRunEnded: true,
		NotifyIncludeMessage: true,
	}
}

// MobileSettings is P212's mobile agents web server: off until enabled, with its one plain-HTTP
// listener port. Changed through bridge.MobileAccessService, which restarts the server when it is
// running.
type MobileSettings struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
	// AgentInput is the global switch for phones replying to agents and attaching to their
	// terminals; a device also needs its own can_agent_input flag.
	AgentInput bool `json:"agentInput"`
}

type Settings struct {
	Appearance Appearance         `json:"appearance"`
	Advanced   AdvancedSettings   `json:"advanced"`
	Git        GitSettings        `json:"git"`
	Ade        AdeSettings        `json:"ade"`
	ClaudeCode ClaudeCodeSettings `json:"claudeCode"`
	Mobile     MobileSettings     `json:"mobile"`
}

// DefaultMobileSettings mirrors settingsDomain.ts's mobileSettingsSchema defaults.
func DefaultMobileSettings() MobileSettings {
	return MobileSettings{Enabled: false, Port: 7790, AgentInput: false}
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

// DefaultAdeSettings mirrors settingsDomain.ts's own adeSettingsSchema defaults (P129 Part 2 §7).
func DefaultAdeSettings() AdeSettings {
	return AdeSettings{
		PanelWidth:      0,
		HorizonDays:     14,
		HistoryDays:     14,
		ExtraDays:       []string{},
		OffDays:         []string{},
		WorkWeekendDays: []string{},
		WorkdayHours:    6,
		SpanDayShare:    0.5,

		HeadlessSettingSources: "all",
	}
}

// DefaultSettings mirrors the Appearance/Advanced/Git/Ade slice of
// packages/shared/domain/settings.ts's defaultSettings.
func DefaultSettings() Settings {
	return Settings{
		Appearance: Appearance{
			Appearance:  appsettings.DefaultAppearance(),
			InlineBlame: true,
			DateFormat:  "relative",
		},
		Advanced:   AdvancedSettings{GitLogLevel: "info"},
		Git:        DefaultGitSettings(),
		Ade:        DefaultAdeSettings(),
		ClaudeCode: DefaultClaudeCodeSettings(),
		Mobile:     DefaultMobileSettings(),
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

// AdePatch mirrors AdeSettings' own `.partial()` shape (§7).
type AdePatch struct {
	PanelWidth      *int      `json:"panelWidth,omitempty"`
	HorizonDays     *int      `json:"horizonDays,omitempty"`
	HistoryDays     *int      `json:"historyDays,omitempty"`
	ExtraDays       *[]string `json:"extraDays,omitempty"`
	OffDays         *[]string `json:"offDays,omitempty"`
	WorkWeekendDays *[]string `json:"workWeekendDays,omitempty"`
	WorkdayHours    *float64  `json:"workdayHours,omitempty"`
	SpanDayShare    *float64  `json:"spanDayShare,omitempty"`

	HeadlessSettingSources *string `json:"headlessSettingSources,omitempty"`
}

// ClaudeCodePatch mirrors ClaudeCodeSettings' own `.partial()` shape.
type ClaudeCodePatch struct {
	KeepAwakeWithAgents  *bool `json:"keepAwakeWithAgents,omitempty"`
	NotifyEnabled        *bool `json:"notifyEnabled,omitempty"`
	NotifyOnFinished     *bool `json:"notifyOnFinished,omitempty"`
	NotifyOnNeedsInput   *bool `json:"notifyOnNeedsInput,omitempty"`
	NotifyOnRunEnded     *bool `json:"notifyOnRunEnded,omitempty"`
	NotifyIncludeMessage *bool `json:"notifyIncludeMessage,omitempty"`
}

// MobilePatch mirrors MobileSettings' own `.partial()` shape.
type MobilePatch struct {
	Enabled    *bool `json:"enabled,omitempty"`
	Port       *int  `json:"port,omitempty"`
	AgentInput *bool `json:"agentInput,omitempty"`
}

type SettingsPatch struct {
	Appearance *AppearancePatch `json:"appearance,omitempty"`
	Advanced   *AdvancedPatch   `json:"advanced,omitempty"`
	Git        *GitPatch        `json:"git,omitempty"`
	Ade        *AdePatch        `json:"ade,omitempty"`
	ClaudeCode *ClaudeCodePatch `json:"claudeCode,omitempty"`
	Mobile     *MobilePatch     `json:"mobile,omitempty"`
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

// ValidAdePanelWidth mirrors settingsDomain.ts's adeSettingsSchema.panelWidth refinement: 0 (="half
// the window") or an explicit 340..4000 drag width.
func ValidAdePanelWidth(v int) bool {
	return v == 0 || (v >= 340 && v <= 4000)
}

// ValidAdeHeadlessSettingSources mirrors adeSettingsSchema.headlessSettingSources' enum.
func ValidAdeHeadlessSettingSources(v string) bool {
	return v == "user" || v == "all"
}

func floatInRange(lo, hi float64) func(float64) bool {
	return func(v float64) bool { return v >= lo && v <= hi }
}

var (
	ValidAdeHorizonDays  = appsettings.InRange(1, 365)
	ValidAdeHistoryDays  = appsettings.InRange(1, 365)
	ValidAdeWorkdayHours = floatInRange(1, 24)
	ValidAdeSpanDayShare = floatInRange(0.05, 1)
)

var adeISODateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ValidAdeDateList mirrors settingsDomain.ts's adeDateListSchema: at most 1000 entries, each an ISO
// (YYYY-MM-DD) date — extraDays/offDays/workWeekendDays all share this one shape.
func ValidAdeDateList(vs []string) bool {
	if len(vs) > 1000 {
		return false
	}
	for _, v := range vs {
		if !adeISODateRe.MatchString(v) {
			return false
		}
	}
	return true
}

// validateAdeSection mirrors upsertAde's own leaf list (repos/settings.go).
func validateAdeSection(a *AdePatch) error {
	if a == nil {
		return nil
	}
	if a.PanelWidth != nil && !ValidAdePanelWidth(*a.PanelWidth) {
		return fmt.Errorf("model: ade.panelWidth: invalid value %d", *a.PanelWidth)
	}
	if a.HorizonDays != nil && !ValidAdeHorizonDays(*a.HorizonDays) {
		return fmt.Errorf("model: ade.horizonDays: out of range value %d", *a.HorizonDays)
	}
	if a.HistoryDays != nil && !ValidAdeHistoryDays(*a.HistoryDays) {
		return fmt.Errorf("model: ade.historyDays: out of range value %d", *a.HistoryDays)
	}
	if a.ExtraDays != nil && !ValidAdeDateList(*a.ExtraDays) {
		return fmt.Errorf("model: ade.extraDays: invalid date list")
	}
	if a.OffDays != nil && !ValidAdeDateList(*a.OffDays) {
		return fmt.Errorf("model: ade.offDays: invalid date list")
	}
	if a.WorkWeekendDays != nil && !ValidAdeDateList(*a.WorkWeekendDays) {
		return fmt.Errorf("model: ade.workWeekendDays: invalid date list")
	}
	if a.WorkdayHours != nil && !ValidAdeWorkdayHours(*a.WorkdayHours) {
		return fmt.Errorf("model: ade.workdayHours: out of range value %v", *a.WorkdayHours)
	}
	if a.SpanDayShare != nil && !ValidAdeSpanDayShare(*a.SpanDayShare) {
		return fmt.Errorf("model: ade.spanDayShare: out of range value %v", *a.SpanDayShare)
	}
	if a.HeadlessSettingSources != nil && !ValidAdeHeadlessSettingSources(*a.HeadlessSettingSources) {
		return fmt.Errorf("model: ade.headlessSettingSources: invalid value %q", *a.HeadlessSettingSources)
	}
	return nil
}

// ValidMobilePort mirrors settingsDomain.ts's mobileSettingsSchema port bounds: unprivileged ports.
var ValidMobilePort = appsettings.InRange(1024, 65535)

func validateMobileSection(m *MobilePatch) error {
	if m == nil {
		return nil
	}
	if m.Port != nil && !ValidMobilePort(*m.Port) {
		return fmt.Errorf("model: mobile.port: out of range value %d", *m.Port)
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
	if err := validateAdeSection(p.Ade); err != nil {
		return err
	}
	return validateMobileSection(p.Mobile)
}
