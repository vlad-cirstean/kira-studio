// Package repos is Kira Space's own analogue of apps/kira-studio/internal/storage/repos — its
// trimmed subset, since this app has no connections/queries/collections/history tables of its own.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
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
	result.Appearance = appsettings.ReadAppearance(stored)
	result.Git = appsettings.ReadGit(stored)
	appsettings.LeafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, appsettings.ValidLogLevel)
	return result, nil
}

func upsertAdvancedSection(tx *sql.Tx, a *model.AdvancedPatch) error {
	if a == nil || a.GitLogLevel == nil {
		return nil
	}
	return appsettings.UpsertLeaf(tx, "advanced.gitLogLevel", *a.GitLogLevel)
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

	if err := appsettings.UpsertAppearance(tx, patch.Appearance); err != nil {
		return model.Settings{}, err
	}
	if err := upsertAdvancedSection(tx, patch.Advanced); err != nil {
		return model.Settings{}, err
	}
	if err := appsettings.UpsertGit(tx, patch.Git); err != nil {
		return model.Settings{}, err
	}

	if err := tx.Commit(); err != nil {
		return model.Settings{}, fmt.Errorf("repos: commit settings: %w", err)
	}
	return r.GetAll()
}
