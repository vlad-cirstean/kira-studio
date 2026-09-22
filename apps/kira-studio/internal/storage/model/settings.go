package model

import "fmt"

type AppearanceSettings struct {
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

type DataSettings struct {
	DefaultPageSize int `json:"defaultPageSize"`
}

type CacheSettings struct {
	L2BudgetMb int `json:"l2BudgetMb"`
}

type AdvancedSettings struct {
	OpLogRetentionDays int `json:"opLogRetentionDays"`
	// P18 D14/D20: an estimated-rows-read threshold, never a cost unit — settings.ts's own
	// EXPENSIVE_QUERY_ROWS_RANGE comment carries the full argument.
	ExpensiveQueryRows int `json:"expensiveQueryRows"`
	// GitLogLevel is P72 §9.2's genuinely app-wide replacement for the per-repo
	// kiraSpace.log.level (renamed from kiraVersion.log.level, P100 Part 3) —
	// internal/logging.SetLevel is its actual mechanism.
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

// DbMcpSettings is the embedded DB MCP server instance's persisted on/off record
// (internal/bridge/dbmcp.go owns the actual start/stop side effect).
type DbMcpSettings struct {
	ServerEnabled bool `json:"serverEnabled"`
}

// ClaudeCodeSettings mirrors DbMcpSettings' own shape (P86 §8.4/§9.2): HooksEnabled is read fresh
// at every terminal launch, not cached anywhere (internal/bridge/agenthooks.go owns the actual
// server start/stop side effect) — never an installer, never a one-time write. HooksPromptDismissed
// is the first-run banner's own "don't ask again" leaf (§9.4), independent of HooksEnabled so
// declining the prompt once doesn't reappear on every new Claude Code tab.
// KeepAwakeWithAgents is P87 §6's own leaf: on, this Mac is kept awake automatically whenever at
// least one Claude Code session is live (internal/keepawake owns the actual OS assertion),
// independent of the title bar's own keep-awake toggle. Off by default.
type ClaudeCodeSettings struct {
	HooksEnabled         bool `json:"hooksEnabled"`
	HooksPromptDismissed bool `json:"hooksPromptDismissed"`
	KeepAwakeWithAgents  bool `json:"keepAwakeWithAgents"`
}

// ApiSettings mirrors packages/shared/domain/settings.ts's apiSettingsSchema (P90 item 1) — the
// seven request settings that used to be httpclient package constants (internal/httpclient's own
// options.go states the coupling back at this file: its normalize() defaults must equal
// DefaultSettings().Api field for field). HTTPVersion is "1.1" | "2"; RequestTimeoutMs is
// milliseconds, 0 = none; MaxResponseMb is whole MB, 0 = unlimited.
type ApiSettings struct {
	HTTPVersion      string `json:"httpVersion"`
	RequestTimeoutMs int    `json:"requestTimeoutMs"`
	MaxResponseMb    int    `json:"maxResponseMb"`
	SSLVerify        bool   `json:"sslVerify"`
	FollowRedirects  bool   `json:"followRedirects"`
	MaxRedirects     int    `json:"maxRedirects"`
	DisableCookieJar bool   `json:"disableCookieJar"`
}

type Settings struct {
	Appearance AppearanceSettings `json:"appearance"`
	Data       DataSettings       `json:"data"`
	Cache      CacheSettings      `json:"cache"`
	Advanced   AdvancedSettings   `json:"advanced"`
	Git        GitSettings        `json:"git"`
	Api        ApiSettings        `json:"api"`
	DbMcp      DbMcpSettings      `json:"dbMcp"`
	ClaudeCode ClaudeCodeSettings `json:"claudeCode"`
}

// DefaultSettings mirrors packages/shared/domain/settings.ts's defaultSettings verbatim.
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
		Data:  DataSettings{DefaultPageSize: 100},
		Cache: CacheSettings{L2BudgetMb: 64},
		Advanced: AdvancedSettings{
			OpLogRetentionDays: 30,
			ExpensiveQueryRows: 100_000,
			GitLogLevel:        "info",
		},
		// docs/v1.3/plans/G7 D16: the same three-pattern default upstream's own
		// kiraVersion.protectedBranches carried, before this phase moved it server-side.
		Git: GitSettings{
			ProtectedBranches:        []string{"main", "master", "release/*"},
			FetchAutoIntervalMinutes: 0,
			GitPath:                  "",
			GraphFontSize:            0,
		},
		// P90 §2.1: three deliberate default changes from pre-P90 httpclient behaviour — timeout
		// 30s -> none, max response 10 MiB -> 50 MB, max redirects unchanged at 10.
		Api: ApiSettings{
			HTTPVersion:      "2",
			RequestTimeoutMs: 0,
			MaxResponseMb:    50,
			SSLVerify:        true,
			FollowRedirects:  true,
			MaxRedirects:     10,
			DisableCookieJar: true,
		},
		DbMcp:      DbMcpSettings{ServerEnabled: false},
		ClaudeCode: ClaudeCodeSettings{HooksEnabled: false, HooksPromptDismissed: false, KeepAwakeWithAgents: false},
	}
}

// AppearancePatch, DataPatch, CachePatch and AdvancedPatch mirror settings.ts's `.partial()`
// per-section patch shapes — every leaf is optional, present only when the caller means to
// change it (D15: SettingsRepo.Set writes only the leaves actually patched).
type AppearancePatch struct {
	FontFamily  *string `json:"fontFamily,omitempty"`
	FontSize    *int    `json:"fontSize,omitempty"`
	RowDensity  *string `json:"rowDensity,omitempty"`
	WordWrap    *bool   `json:"wordWrap,omitempty"`
	RowColoring *bool   `json:"rowColoring,omitempty"`
	InlineBlame *bool   `json:"inlineBlame,omitempty"`
	DateFormat  *string `json:"dateFormat,omitempty"`
}

type DataPatch struct {
	DefaultPageSize *int `json:"defaultPageSize,omitempty"`
}

type CachePatch struct {
	L2BudgetMb *int `json:"l2BudgetMb,omitempty"`
}

type AdvancedPatch struct {
	OpLogRetentionDays *int    `json:"opLogRetentionDays,omitempty"`
	ExpensiveQueryRows *int    `json:"expensiveQueryRows,omitempty"`
	GitLogLevel        *string `json:"gitLogLevel,omitempty"`
}

// GitPatch mirrors GitSettings' own `.partial()` shape (G7 D16).
type GitPatch struct {
	ProtectedBranches        *[]string `json:"protectedBranches,omitempty"`
	FetchAutoIntervalMinutes *int      `json:"fetchAutoIntervalMinutes,omitempty"`
	GitPath                  *string   `json:"gitPath,omitempty"`
	GraphFontSize            *int      `json:"graphFontSize,omitempty"`
}

// ApiPatch mirrors ApiSettings' own `.partial()` shape (P90 item 1).
type ApiPatch struct {
	HTTPVersion      *string `json:"httpVersion,omitempty"`
	RequestTimeoutMs *int    `json:"requestTimeoutMs,omitempty"`
	MaxResponseMb    *int    `json:"maxResponseMb,omitempty"`
	SSLVerify        *bool   `json:"sslVerify,omitempty"`
	FollowRedirects  *bool   `json:"followRedirects,omitempty"`
	MaxRedirects     *int    `json:"maxRedirects,omitempty"`
	DisableCookieJar *bool   `json:"disableCookieJar,omitempty"`
}

// DbMcpPatch mirrors DbMcpSettings' own `.partial()` shape (M1 §6.2).
type DbMcpPatch struct {
	ServerEnabled *bool `json:"serverEnabled,omitempty"`
}

// ClaudeCodePatch mirrors ClaudeCodeSettings' own `.partial()` shape (P86 §9.2).
type ClaudeCodePatch struct {
	HooksEnabled         *bool `json:"hooksEnabled,omitempty"`
	HooksPromptDismissed *bool `json:"hooksPromptDismissed,omitempty"`
	KeepAwakeWithAgents  *bool `json:"keepAwakeWithAgents,omitempty"`
}

type SettingsPatch struct {
	Appearance *AppearancePatch `json:"appearance,omitempty"`
	Data       *DataPatch       `json:"data,omitempty"`
	Cache      *CachePatch      `json:"cache,omitempty"`
	Advanced   *AdvancedPatch   `json:"advanced,omitempty"`
	Git        *GitPatch        `json:"git,omitempty"`
	Api        *ApiPatch        `json:"api,omitempty"`
	DbMcp      *DbMcpPatch      `json:"dbMcp,omitempty"`
	ClaudeCode *ClaudeCodePatch `json:"claudeCode,omitempty"`
}

// ValidRowDensity mirrors settings.ts's rowDensitySchema.
func ValidRowDensity(v string) bool {
	return v == "compact" || v == "comfortable"
}

// ValidDateFormat mirrors settings.ts's appearanceSettingsSchema.dateFormat enum.
func ValidDateFormat(v string) bool {
	return v == "relative" || v == "absolute"
}

// ValidHTTPVersion mirrors settings.ts's HTTP_VERSIONS — Go's HTTP/1 *is* 1.1, so "1" is never a
// member (internal/httpclient/options.go's own comment states why).
func ValidHTTPVersion(v string) bool {
	return v == "1.1" || v == "2"
}

// ValidPageSize mirrors settings.ts's pageSizeSchema (shared with tabs.ts's per-kind page sizes).
func ValidPageSize(v int) bool {
	switch v {
	case 10, 100, 1000, 10000:
		return true
	default:
		return false
	}
}

// ValidLogLevel mirrors schema.ts's kiraSpace.log.level enum (kiraVersion.log.level before P100
// Part 3's rename). P100 Part 1: kept here rather than
// deleted with the rest of internal/storage/model/gitreposettings.go — advanced.gitLogLevel (the
// only remaining caller) stays on model.Settings, see this app's own bridge/settings.go comment.
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
	validL2BudgetMb               = InRange(8, 1024)
	validOpLogRetentionDays       = InRange(1, 365)
	validExpensiveQueryRows       = InRange(1_000, 1_000_000_000)
	validFetchAutoIntervalMinutes = InRange(0, 1440)
	// P92 item 9: settings.ts's own FONT_SIZE_RANGE, floored at 0 (the "follow the app" sentinel)
	// rather than FONT_SIZE_RANGE.min — the schema's own comment states why.
	validGraphFontSize = InRange(0, 24)
	// P90 §2.1: settings.ts's own REQUEST_TIMEOUT_MS_RANGE/MAX_RESPONSE_MB_RANGE/MAX_REDIRECTS_RANGE.
	validRequestTimeoutMs = InRange(0, 3_600_000)
	validMaxResponseMb    = InRange(0, 2048)
	validMaxRedirects     = InRange(0, 100)
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

func validateDataSection(d *DataPatch) error {
	if d != nil && d.DefaultPageSize != nil && !ValidPageSize(*d.DefaultPageSize) {
		return fmt.Errorf("model: data.defaultPageSize: invalid value %d", *d.DefaultPageSize)
	}
	return nil
}

func validateCacheSection(c *CachePatch) error {
	if c != nil && c.L2BudgetMb != nil && !validL2BudgetMb(*c.L2BudgetMb) {
		return fmt.Errorf("model: cache.l2BudgetMb: out of range value %d", *c.L2BudgetMb)
	}
	return nil
}

func validateAdvancedSection(a *AdvancedPatch) error {
	if a == nil {
		return nil
	}
	if a.OpLogRetentionDays != nil && !validOpLogRetentionDays(*a.OpLogRetentionDays) {
		return fmt.Errorf("model: advanced.opLogRetentionDays: out of range value %d", *a.OpLogRetentionDays)
	}
	if a.ExpensiveQueryRows != nil && !validExpensiveQueryRows(*a.ExpensiveQueryRows) {
		return fmt.Errorf("model: advanced.expensiveQueryRows: out of range value %d", *a.ExpensiveQueryRows)
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

func validateApiSection(a *ApiPatch) error {
	if a == nil {
		return nil
	}
	if a.HTTPVersion != nil && !ValidHTTPVersion(*a.HTTPVersion) {
		return fmt.Errorf("model: api.httpVersion: invalid value %q", *a.HTTPVersion)
	}
	if a.RequestTimeoutMs != nil && !validRequestTimeoutMs(*a.RequestTimeoutMs) {
		return fmt.Errorf("model: api.requestTimeoutMs: out of range value %d", *a.RequestTimeoutMs)
	}
	if a.MaxResponseMb != nil && !validMaxResponseMb(*a.MaxResponseMb) {
		return fmt.Errorf("model: api.maxResponseMb: out of range value %d", *a.MaxResponseMb)
	}
	if a.MaxRedirects != nil && !validMaxRedirects(*a.MaxRedirects) {
		return fmt.Errorf("model: api.maxRedirects: out of range value %d", *a.MaxRedirects)
	}
	return nil
}

// Validate checks every leaf the caller actually patched against settings.ts's bounds, naming
// the offending leaf in the error — fontFamily and fontSize have no bounds in the TS schema
// either, so they are accepted as-is. DbMcp/ClaudeCode have no bounds either and so no validateX
// of their own.
func (p SettingsPatch) Validate() error {
	if err := validateAppearanceSection(p.Appearance); err != nil {
		return err
	}
	if err := validateDataSection(p.Data); err != nil {
		return err
	}
	if err := validateCacheSection(p.Cache); err != nil {
		return err
	}
	if err := validateAdvancedSection(p.Advanced); err != nil {
		return err
	}
	if err := validateGitSection(p.Git); err != nil {
		return err
	}
	if err := validateApiSection(p.Api); err != nil {
		return err
	}
	return nil
}
