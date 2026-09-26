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
	result.Appearance = readAppearance(stored)
	result.Git = readGit(stored)
	appsettings.LeafValid(stored, "advanced.gitLogLevel", &result.Advanced.GitLogLevel, appsettings.ValidLogLevel)
	return result, nil
}

// readAppearance reads the shared appearance.* leaves plus this app's own two (inlineBlame/
// dateFormat) on top of model.DefaultSettings().Appearance, mirroring the former
// appsettings.ReadAppearance's own inlineBlame/dateFormat block (P120: only this app's git module
// uses either leaf).
func readAppearance(stored map[string]json.RawMessage) model.Appearance {
	result := model.DefaultSettings().Appearance
	result.Appearance = appsettings.ReadAppearance(stored)
	appsettings.Leaf(stored, "appearance.inlineBlame", &result.InlineBlame)
	appsettings.LeafValid(stored, "appearance.dateFormat", &result.DateFormat, model.ValidDateFormat)
	return result
}

// readGit reads every git.* leaf from stored on top of model.DefaultGitSettings(), mirroring the
// former appsettings.ReadGit verbatim (P120: Git is this app's own model, the only app with a git
// module).
func readGit(stored map[string]json.RawMessage) model.GitSettings {
	result := model.DefaultGitSettings()
	appsettings.Leaf(stored, "git.protectedBranches", &result.ProtectedBranches)
	appsettings.LeafValid(stored, "git.fetchAutoIntervalMinutes", &result.FetchAutoIntervalMinutes, model.ValidFetchAutoIntervalMinutes)
	appsettings.Leaf(stored, "git.path", &result.GitPath)
	appsettings.LeafValid(stored, "git.graphFontSize", &result.GraphFontSize, model.ValidGraphFontSize)
	return result
}

// upsertGit mirrors the former appsettings.UpsertGit verbatim — "git.path" (not "git.gitPath") is
// the stored key for GitPath, matching this app's pre-existing row shape.
func upsertGit(tx *sql.Tx, g *model.GitPatch) error {
	if g == nil {
		return nil
	}
	if err := appsettings.UpsertOptional(tx, "git.protectedBranches", g.ProtectedBranches); err != nil {
		return err
	}
	if err := appsettings.UpsertOptional(tx, "git.fetchAutoIntervalMinutes", g.FetchAutoIntervalMinutes); err != nil {
		return err
	}
	if err := appsettings.UpsertOptional(tx, "git.path", g.GitPath); err != nil {
		return err
	}
	return appsettings.UpsertOptional(tx, "git.graphFontSize", g.GraphFontSize)
}

// upsertAppearance upserts the shared appearance.* leaves plus this app's own two (inlineBlame/
// dateFormat) — mirrors the former appsettings.UpsertAppearance's own inlineBlame/dateFormat block.
func upsertAppearance(tx *sql.Tx, a *model.AppearancePatch) error {
	if a == nil {
		return nil
	}
	if err := appsettings.UpsertAppearance(tx, &a.AppearancePatch); err != nil {
		return err
	}
	if err := appsettings.UpsertOptional(tx, "appearance.inlineBlame", a.InlineBlame); err != nil {
		return err
	}
	return appsettings.UpsertOptional(tx, "appearance.dateFormat", a.DateFormat)
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
		if err := upsertAppearance(tx, patch.Appearance); err != nil {
			return err
		}
		if err := upsertAdvancedSection(tx, patch.Advanced); err != nil {
			return err
		}
		return upsertGit(tx, patch.Git)
	})
	if err != nil {
		return model.Settings{}, err
	}
	return r.GetAll()
}
