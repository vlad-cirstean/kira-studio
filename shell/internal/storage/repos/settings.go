// Package repos is the Go analogue of src/main/storage/repos/*.ts.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// SettingsRepo reads and writes the `settings` table, one JSON-valued row per leaf
// (`${section}.${key}`), never a blob per section — settings.ts's own per-leaf fallback is what
// lets a row written before a key existed still parse (P52 §4.3).
const settingsSelectAllSQL = `SELECT key, value FROM settings`

type SettingsRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4 — this is one of the app's hot boot-path
	// reads). nil when a SettingsRepo is constructed directly (e.g. in tests), which falls back
	// to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

func (r *SettingsRepo) GetAll() (model.Settings, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if r.selectAll != nil {
		rows, err = r.selectAll.Query()
	} else {
		rows, err = r.DB.Query(settingsSelectAllSQL)
	}
	if err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: query: %w", err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return model.Settings{}, fmt.Errorf("repos/settings: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: rows: %w", err)
	}

	result := model.DefaultSettings()
	leaf(stored, "appearance.fontFamily", &result.Appearance.FontFamily)
	leafValid(stored, "appearance.fontSize", &result.Appearance.FontSize, alwaysValid[int])
	leafValid(stored, "appearance.rowDensity", &result.Appearance.RowDensity, model.ValidRowDensity)
	leaf(stored, "appearance.wordWrap", &result.Appearance.WordWrap)
	leafValid(stored, "data.defaultPageSize", &result.Data.DefaultPageSize, model.ValidPageSize)
	leafValid(stored, "cache.l2BudgetMb", &result.Cache.L2BudgetMb, model.InRange(8, 1024))
	leafValid(stored, "advanced.engineMemoryCapMb", &result.Advanced.EngineMemoryCapMb, model.InRange(256, 4096))
	leafValid(stored, "advanced.opLogRetentionDays", &result.Advanced.OpLogRetentionDays, model.InRange(1, 365))
	return result, nil
}

// Set validates the patch, writes only the leaves the caller actually patched in one transaction
// (D15 — a full rewrite would touch eleven unrelated rows), and returns GetAll() afterwards.
func (r *SettingsRepo) Set(patch model.SettingsPatch) (model.Settings, error) {
	if err := patch.Validate(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if a := patch.Appearance; a != nil {
		if a.FontFamily != nil {
			if err := upsertSettingsLeaf(tx, "appearance.fontFamily", *a.FontFamily); err != nil {
				return model.Settings{}, err
			}
		}
		if a.FontSize != nil {
			if err := upsertSettingsLeaf(tx, "appearance.fontSize", *a.FontSize); err != nil {
				return model.Settings{}, err
			}
		}
		if a.RowDensity != nil {
			if err := upsertSettingsLeaf(tx, "appearance.rowDensity", *a.RowDensity); err != nil {
				return model.Settings{}, err
			}
		}
		if a.WordWrap != nil {
			if err := upsertSettingsLeaf(tx, "appearance.wordWrap", *a.WordWrap); err != nil {
				return model.Settings{}, err
			}
		}
	}
	if d := patch.Data; d != nil && d.DefaultPageSize != nil {
		if err := upsertSettingsLeaf(tx, "data.defaultPageSize", *d.DefaultPageSize); err != nil {
			return model.Settings{}, err
		}
	}
	if c := patch.Cache; c != nil && c.L2BudgetMb != nil {
		if err := upsertSettingsLeaf(tx, "cache.l2BudgetMb", *c.L2BudgetMb); err != nil {
			return model.Settings{}, err
		}
	}
	if a := patch.Advanced; a != nil {
		if a.EngineMemoryCapMb != nil {
			if err := upsertSettingsLeaf(tx, "advanced.engineMemoryCapMb", *a.EngineMemoryCapMb); err != nil {
				return model.Settings{}, err
			}
		}
		if a.OpLogRetentionDays != nil {
			if err := upsertSettingsLeaf(tx, "advanced.opLogRetentionDays", *a.OpLogRetentionDays); err != nil {
				return model.Settings{}, err
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return model.Settings{}, fmt.Errorf("repos/settings: commit: %w", err)
	}
	return r.GetAll()
}

func upsertSettingsLeaf(tx *sql.Tx, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("repos/settings: encode %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, string(encoded),
	); err != nil {
		return fmt.Errorf("repos/settings: upsert %s: %w", key, err)
	}
	return nil
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

// leafValid is leaf plus D4's semantic validation: a stored value that parses but fails valid
// falls back to the default too, logged by the caller's own scope elsewhere in this package.
func leafValid[T any](stored map[string]json.RawMessage, key string, dst *T, valid func(T) bool) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	if !valid(v) {
		return
	}
	*dst = v
}

func alwaysValid[T any](T) bool { return true }
