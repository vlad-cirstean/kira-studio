// Package repos is the Go analogue of src/main/storage/repos/*.ts.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

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
			FontFamily: `"SF Mono", Menlo, monospace`,
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

// SettingsRepo reads and writes the `settings` table, one JSON-valued row per leaf
// (`${section}.${key}`), never a blob per section — settings.ts's own per-leaf fallback is what
// lets a row written before a key existed still parse (P52 §4.3).
type SettingsRepo struct {
	DB *sql.DB
}

func (r *SettingsRepo) GetAll() (Settings, error) {
	rows, err := r.DB.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return Settings{}, fmt.Errorf("repos/settings: query: %w", err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return Settings{}, fmt.Errorf("repos/settings: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return Settings{}, fmt.Errorf("repos/settings: rows: %w", err)
	}

	result := DefaultSettings()
	leaf(stored, "appearance.fontFamily", &result.Appearance.FontFamily)
	leaf(stored, "appearance.fontSize", &result.Appearance.FontSize)
	leaf(stored, "appearance.rowDensity", &result.Appearance.RowDensity)
	leaf(stored, "appearance.wordWrap", &result.Appearance.WordWrap)
	leaf(stored, "data.defaultPageSize", &result.Data.DefaultPageSize)
	leaf(stored, "cache.l2BudgetMb", &result.Cache.L2BudgetMb)
	leaf(stored, "advanced.engineMemoryCapMb", &result.Advanced.EngineMemoryCapMb)
	leaf(stored, "advanced.opLogRetentionDays", &result.Advanced.OpLogRetentionDays)
	return result, nil
}

// leaf overwrites *dst with the stored value for key if present, leaving the caller's default in
// place otherwise (settings.ts's sectionFromStore, one key at a time). An unparseable stored
// value is a hand-edited or stale-shape row; it is left at its default rather than propagated,
// the same "fail closed to a known-good value" discipline the TS build's zod parse enforces.
func leaf[T any](stored map[string]json.RawMessage, key string, dst *T) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	*dst = v
}
