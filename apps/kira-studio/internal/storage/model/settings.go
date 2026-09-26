package model

import (
	"fmt"

	"github.com/kirathecat/kira-studio/internal/appsettings"
)

type DataSettings struct {
	DefaultPageSize int `json:"defaultPageSize"`
}

type CacheSettings struct {
	L2BudgetMb int `json:"l2BudgetMb"`
}

// AdvancedSettings' own LogLevel is P120: Studio's own diagnostic-log verbosity, its own name/key
// (`advanced.logLevel`), no longer the shared appsettings.AdvancedCore embed both apps used to
// share under the git-era name `gitLogLevel` — Studio has no git module, so that name never fit.
// internal/logging.SetLevel is its actual mechanism; appsettings.ValidLogLevel is its validator,
// genuinely shared with Kira Space's own advanced.gitLogLevel.
type AdvancedSettings struct {
	OpLogRetentionDays int `json:"opLogRetentionDays"`
	// P18 D14/D20: an estimated-rows-read threshold, never a cost unit — settings.ts's own
	// EXPENSIVE_QUERY_ROWS_RANGE comment carries the full argument.
	ExpensiveQueryRows int    `json:"expensiveQueryRows"`
	LogLevel           string `json:"logLevel"`
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
	Appearance appsettings.Appearance `json:"appearance"`
	Data       DataSettings           `json:"data"`
	Cache      CacheSettings          `json:"cache"`
	Advanced   AdvancedSettings       `json:"advanced"`
	Api        ApiSettings            `json:"api"`
	DbMcp      DbMcpSettings          `json:"dbMcp"`
	ClaudeCode ClaudeCodeSettings     `json:"claudeCode"`
}

// DefaultSettings mirrors packages/shared/domain/settings.ts's defaultSettings verbatim.
func DefaultSettings() Settings {
	return Settings{
		Appearance: appsettings.DefaultAppearance(),
		Data:       DataSettings{DefaultPageSize: 100},
		Cache:      CacheSettings{L2BudgetMb: 64},
		Advanced: AdvancedSettings{
			OpLogRetentionDays: 30,
			ExpensiveQueryRows: 100_000,
			LogLevel:           "info",
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

// DataPatch and CachePatch mirror settings.ts's `.partial()` per-section patch shapes — every leaf
// is optional, present only when the caller means to change it (D15: SettingsRepo.Set writes only
// the leaves actually patched). Appearance's own patch shape is appsettings.AppearancePatch
// (P103 Part 4 §7.1).
type DataPatch struct {
	DefaultPageSize *int `json:"defaultPageSize,omitempty"`
}

type CachePatch struct {
	L2BudgetMb *int `json:"l2BudgetMb,omitempty"`
}

// AdvancedPatch mirrors AdvancedSettings' own `.partial()` shape.
type AdvancedPatch struct {
	OpLogRetentionDays *int    `json:"opLogRetentionDays,omitempty"`
	ExpensiveQueryRows *int    `json:"expensiveQueryRows,omitempty"`
	LogLevel           *string `json:"logLevel,omitempty"`
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
	Appearance *appsettings.AppearancePatch `json:"appearance,omitempty"`
	Data       *DataPatch                   `json:"data,omitempty"`
	Cache      *CachePatch                  `json:"cache,omitempty"`
	Advanced   *AdvancedPatch               `json:"advanced,omitempty"`
	Api        *ApiPatch                    `json:"api,omitempty"`
	DbMcp      *DbMcpPatch                  `json:"dbMcp,omitempty"`
	ClaudeCode *ClaudeCodePatch             `json:"claudeCode,omitempty"`
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

// InRange (settings.ts's z.number().int().min(lo).max(hi)), ValidRowDensity and ValidLogLevel
// moved to appsettings (P103 Part 4 §7.1) — this file's own remaining bounds
// (Data/Cache/Advanced/Api are all per-app-only sections) are built on appsettings.InRange
// directly rather than a redundant local copy.
var (
	validL2BudgetMb         = appsettings.InRange(8, 1024)
	validOpLogRetentionDays = appsettings.InRange(1, 365)
	validExpensiveQueryRows = appsettings.InRange(1_000, 1_000_000_000)
	// P90 §2.1: settings.ts's own REQUEST_TIMEOUT_MS_RANGE/MAX_RESPONSE_MB_RANGE/MAX_REDIRECTS_RANGE.
	validRequestTimeoutMs = appsettings.InRange(0, 3_600_000)
	validMaxResponseMb    = appsettings.InRange(0, 2048)
	validMaxRedirects     = appsettings.InRange(0, 100)
)

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
	if a.LogLevel != nil && !appsettings.ValidLogLevel(*a.LogLevel) {
		return fmt.Errorf("model: advanced.logLevel: invalid value %q", *a.LogLevel)
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
	if err := appsettings.ValidateAppearance(p.Appearance); err != nil {
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
	if err := validateApiSection(p.Api); err != nil {
		return err
	}
	return nil
}
