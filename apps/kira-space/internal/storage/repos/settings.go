// Package repos is Kira Space's own analogue of apps/kira-studio/internal/storage/repos — its
// trimmed subset, since this app has no connections/queries/collections/history tables of its own.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// SettingsRepo reads and writes the `settings` table, one JSON-valued row per leaf
// (`${section}.${key}`), never a blob per section — same shape as Kira Studio's own SettingsRepo,
// trimmed to the three sections model.Settings actually has here (appearance/advanced/git).
const settingsSelectAllSQL = `SELECT key, value FROM settings`

type SettingsRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New. nil when a SettingsRepo is constructed directly
	// (e.g. in tests), which falls back to an ad-hoc query with identical SQL.
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
		return model.Settings{}, fmt.Errorf("repos: query settings: %w", err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return model.Settings{}, fmt.Errorf("repos: scan settings: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return model.Settings{}, fmt.Errorf("repos: settings rows: %w", err)
	}

	result := model.DefaultSettings()
	leaf(stored, "appearance.fontFamily", &result.Appearance.FontFamily)
	leafValid(stored, "appearance.fontSize", &result.Appearance.FontSize, alwaysValid[int])
	leafValid(stored, "appearance.rowDensity", &result.Appearance.RowDensity, model.ValidRowDensity)
	leaf(stored, "appearance.wordWrap", &result.Appearance.WordWrap)
	leaf(stored, "appearance.rowColoring", &result.Appearance.RowColoring)
	leaf(stored, "appearance.inlineBlame", &result.Appearance.InlineBlame)
	leafValid(stored, "appearance.dateFormat", &result.Appearance.DateFormat, model.ValidDateFormat)
	leafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, model.ValidLogLevel)
	leaf(stored, "git.protectedBranches", &result.Git.ProtectedBranches)
	leafValid(stored, "git.fetchAutoIntervalMinutes", &result.Git.FetchAutoIntervalMinutes, model.InRange(0, 1440))
	leaf(stored, "git.path", &result.Git.GitPath)
	leafValid(stored, "git.graphFontSize", &result.Git.GraphFontSize, model.InRange(0, 24))
	return result, nil
}

func upsertAppearanceSection(tx *sql.Tx, a *model.AppearancePatch) error {
	if a == nil {
		return nil
	}
	if a.FontFamily != nil {
		if err := upsertSettingsLeaf(tx, "appearance.fontFamily", *a.FontFamily); err != nil {
			return err
		}
	}
	if a.FontSize != nil {
		if err := upsertSettingsLeaf(tx, "appearance.fontSize", *a.FontSize); err != nil {
			return err
		}
	}
	if a.RowDensity != nil {
		if err := upsertSettingsLeaf(tx, "appearance.rowDensity", *a.RowDensity); err != nil {
			return err
		}
	}
	if a.WordWrap != nil {
		if err := upsertSettingsLeaf(tx, "appearance.wordWrap", *a.WordWrap); err != nil {
			return err
		}
	}
	if a.RowColoring != nil {
		if err := upsertSettingsLeaf(tx, "appearance.rowColoring", *a.RowColoring); err != nil {
			return err
		}
	}
	if a.InlineBlame != nil {
		if err := upsertSettingsLeaf(tx, "appearance.inlineBlame", *a.InlineBlame); err != nil {
			return err
		}
	}
	if a.DateFormat != nil {
		if err := upsertSettingsLeaf(tx, "appearance.dateFormat", *a.DateFormat); err != nil {
			return err
		}
	}
	return nil
}

func upsertAdvancedSection(tx *sql.Tx, a *model.AdvancedPatch) error {
	if a == nil {
		return nil
	}
	if a.GitLogLevel != nil {
		if err := upsertSettingsLeaf(tx, "advanced.gitLogLevel", *a.GitLogLevel); err != nil {
			return err
		}
	}
	return nil
}

func upsertGitSection(tx *sql.Tx, g *model.GitPatch) error {
	if g == nil {
		return nil
	}
	if g.ProtectedBranches != nil {
		if err := upsertSettingsLeaf(tx, "git.protectedBranches", *g.ProtectedBranches); err != nil {
			return err
		}
	}
	if g.FetchAutoIntervalMinutes != nil {
		if err := upsertSettingsLeaf(tx, "git.fetchAutoIntervalMinutes", *g.FetchAutoIntervalMinutes); err != nil {
			return err
		}
	}
	if g.GitPath != nil {
		if err := upsertSettingsLeaf(tx, "git.path", *g.GitPath); err != nil {
			return err
		}
	}
	if g.GraphFontSize != nil {
		if err := upsertSettingsLeaf(tx, "git.graphFontSize", *g.GraphFontSize); err != nil {
			return err
		}
	}
	return nil
}

// Set validates the patch, writes only the leaves the caller actually patched in one transaction,
// and returns GetAll() afterwards.
func (r *SettingsRepo) Set(patch model.SettingsPatch) (model.Settings, error) {
	if err := patch.Validate(); err != nil {
		return model.Settings{}, fmt.Errorf("repos: %w", err)
	}

	tx, err := r.DB.Begin()
	if err != nil {
		return model.Settings{}, fmt.Errorf("repos: begin settings: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := upsertAppearanceSection(tx, patch.Appearance); err != nil {
		return model.Settings{}, err
	}
	if err := upsertAdvancedSection(tx, patch.Advanced); err != nil {
		return model.Settings{}, err
	}
	if err := upsertGitSection(tx, patch.Git); err != nil {
		return model.Settings{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.Settings{}, fmt.Errorf("repos: commit settings: %w", err)
	}
	return r.GetAll()
}

func upsertSettingsLeaf(tx *sql.Tx, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("repos: encode %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, string(encoded),
	); err != nil {
		return fmt.Errorf("repos: upsert %s: %w", key, err)
	}
	return nil
}
