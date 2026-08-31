package model

import "fmt"

type AppearanceSettings struct {
	FontFamily string `json:"fontFamily"`
	FontSize   int    `json:"fontSize"`
	RowDensity string `json:"rowDensity"`
	WordWrap   bool   `json:"wordWrap"`
}

type DataSettings struct {
	DefaultPageSize int `json:"defaultPageSize"`
}

type CacheSettings struct {
	L2BudgetMb int `json:"l2BudgetMb"`
}

type AdvancedSettings struct {
	EngineMemoryCapMb  int `json:"engineMemoryCapMb"`
	OpLogRetentionDays int `json:"opLogRetentionDays"`
}

type Settings struct {
	Appearance AppearanceSettings `json:"appearance"`
	Data       DataSettings       `json:"data"`
	Cache      CacheSettings      `json:"cache"`
	Advanced   AdvancedSettings   `json:"advanced"`
}

// DefaultSettings mirrors src/shared/domain/settings.ts's defaultSettings verbatim.
func DefaultSettings() Settings {
	return Settings{
		Appearance: AppearanceSettings{
			FontFamily: `"JetBrains Mono", "DejaVu Sans Mono", monospace`,
			FontSize:   12,
			RowDensity: "comfortable",
			WordWrap:   true,
		},
		Data:  DataSettings{DefaultPageSize: 100},
		Cache: CacheSettings{L2BudgetMb: 64},
		Advanced: AdvancedSettings{
			EngineMemoryCapMb:  512,
			OpLogRetentionDays: 30,
		},
	}
}

// AppearancePatch, DataPatch, CachePatch and AdvancedPatch mirror settings.ts's `.partial()`
// per-section patch shapes — every leaf is optional, present only when the caller means to
// change it (D15: SettingsRepo.Set writes only the leaves actually patched).
type AppearancePatch struct {
	FontFamily *string `json:"fontFamily,omitempty"`
	FontSize   *int    `json:"fontSize,omitempty"`
	RowDensity *string `json:"rowDensity,omitempty"`
	WordWrap   *bool   `json:"wordWrap,omitempty"`
}

type DataPatch struct {
	DefaultPageSize *int `json:"defaultPageSize,omitempty"`
}

type CachePatch struct {
	L2BudgetMb *int `json:"l2BudgetMb,omitempty"`
}

type AdvancedPatch struct {
	EngineMemoryCapMb  *int `json:"engineMemoryCapMb,omitempty"`
	OpLogRetentionDays *int `json:"opLogRetentionDays,omitempty"`
}

type SettingsPatch struct {
	Appearance *AppearancePatch `json:"appearance,omitempty"`
	Data       *DataPatch       `json:"data,omitempty"`
	Cache      *CachePatch      `json:"cache,omitempty"`
	Advanced   *AdvancedPatch   `json:"advanced,omitempty"`
}

// ValidRowDensity mirrors settings.ts's rowDensitySchema.
func ValidRowDensity(v string) bool {
	return v == "compact" || v == "comfortable"
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

// InRange returns a predicate matching settings.ts's z.number().int().min(lo).max(hi).
func InRange(lo, hi int) func(int) bool {
	return func(v int) bool { return v >= lo && v <= hi }
}

var (
	validL2BudgetMb         = InRange(8, 1024)
	validEngineMemoryCapMb  = InRange(256, 4096)
	validOpLogRetentionDays = InRange(1, 365)
)

// Validate checks every leaf the caller actually patched against settings.ts's bounds, naming
// the offending leaf in the error — fontFamily and fontSize have no bounds in the TS schema
// either, so they are accepted as-is.
func (p SettingsPatch) Validate() error {
	if p.Appearance != nil && p.Appearance.RowDensity != nil && !ValidRowDensity(*p.Appearance.RowDensity) {
		return fmt.Errorf("model: appearance.rowDensity: invalid value %q", *p.Appearance.RowDensity)
	}
	if p.Data != nil && p.Data.DefaultPageSize != nil && !ValidPageSize(*p.Data.DefaultPageSize) {
		return fmt.Errorf("model: data.defaultPageSize: invalid value %d", *p.Data.DefaultPageSize)
	}
	if p.Cache != nil && p.Cache.L2BudgetMb != nil && !validL2BudgetMb(*p.Cache.L2BudgetMb) {
		return fmt.Errorf("model: cache.l2BudgetMb: out of range value %d", *p.Cache.L2BudgetMb)
	}
	if p.Advanced != nil {
		if p.Advanced.EngineMemoryCapMb != nil && !validEngineMemoryCapMb(*p.Advanced.EngineMemoryCapMb) {
			return fmt.Errorf("model: advanced.engineMemoryCapMb: out of range value %d", *p.Advanced.EngineMemoryCapMb)
		}
		if p.Advanced.OpLogRetentionDays != nil && !validOpLogRetentionDays(*p.Advanced.OpLogRetentionDays) {
			return fmt.Errorf("model: advanced.opLogRetentionDays: out of range value %d", *p.Advanced.OpLogRetentionDays)
		}
	}
	return nil
}
