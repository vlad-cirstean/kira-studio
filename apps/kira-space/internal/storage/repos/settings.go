// Package repos is Kira Space's own analogue of apps/kira-studio/internal/storage/repos — its
// trimmed subset, since this app has no connections/queries/collections/history tables of its own.
package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
	"github.com/kirathecat/kira-studio/internal/appstorage"
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
	stored, err := appstorage.ScanLeafRows(rows, err)
	if err != nil {
		return model.Settings{}, err
	}

	result := model.DefaultSettings()
	result.Appearance = appsettings.ReadAppearance(stored)
	result.Git = appsettings.ReadGit(stored)
	appsettings.LeafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, appsettings.ValidLogLevel)
	return result, nil
}

func upsertAdvancedSection(tx *sql.Tx, a *model.AdvancedPatch) error {
	if a == nil {
		return nil
	}
	return appsettings.UpsertOptional(tx, "advanced.gitLogLevel", a.GitLogLevel)
}

// Set validates the patch, writes only the leaves the caller actually patched in one transaction,
// and returns GetAll() afterwards.
func (r *SettingsRepo) Set(patch model.SettingsPatch) (model.Settings, error) {
	if err := patch.Validate(); err != nil {
		return model.Settings{}, fmt.Errorf("repos: %w", err)
	}

	err := appstorage.UpdateLeaves(r.DB, r.selectAll, settingsSelectAllSQL, func(tx *sql.Tx, _ map[string]json.RawMessage) error {
		if err := appsettings.UpsertAppearance(tx, patch.Appearance); err != nil {
			return err
		}
		if err := upsertAdvancedSection(tx, patch.Advanced); err != nil {
			return err
		}
		return appsettings.UpsertGit(tx, patch.Git)
	})
	if err != nil {
		return model.Settings{}, err
	}
	return r.GetAll()
}
