package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// LayoutRepo reads and writes the `ui_layout` table — Kira Studio's own LayoutRepo, trimmed to
// this app's own one-panel model.Layout (P100 Part 2).
type LayoutRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New; nil when constructed directly, which falls back to
	// an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

func (r *LayoutRepo) scanAll(rows *sql.Rows, queryErr error) (model.Layout, error) {
	stored, err := appstorage.ScanLayoutRows(rows, queryErr)
	if err != nil {
		return model.Layout{}, err
	}

	result := model.DefaultLayout()
	appsettings.Leaf(stored, "panel.project.visible", &result.Panel.Project.Visible)
	appsettings.Leaf(stored, "panel.project.width", &result.Panel.Project.Width)
	return result, nil
}

func (r *LayoutRepo) GetAll() (model.Layout, error) {
	if r.selectAll != nil {
		return r.scanAll(r.selectAll.Query())
	}
	return r.scanAll(r.DB.Query(appstorage.LayoutSelectAllSQL))
}

// Set writes both leaves every time, mirroring Kira Studio's own LayoutRepo.Set (the read-modify-
// write runs inside one transaction — storage/db.go's SetMaxOpenConns(1) makes that transaction's
// Begin() hold the database's one connection exclusively until Commit/Rollback, so no concurrent
// Set can race it — same C7/F7 fix Kira Studio's own copy documents).
func (r *LayoutRepo) Set(patch model.LayoutPatch) (model.Layout, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.Layout{}, fmt.Errorf("repos/layout: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var current model.Layout
	if r.selectAll != nil {
		current, err = r.scanAll(tx.Stmt(r.selectAll).Query())
	} else {
		current, err = r.scanAll(tx.Query(appstorage.LayoutSelectAllSQL))
	}
	if err != nil {
		return model.Layout{}, err
	}
	merged := current
	if p := patch.Panel; p != nil && p.Project != nil {
		if p.Project.Visible != nil {
			merged.Panel.Project.Visible = *p.Project.Visible
		}
		if p.Project.Width != nil {
			merged.Panel.Project.Width = *p.Project.Width
		}
	}

	leaves := []struct {
		key   string
		value any
	}{
		{"panel.project.visible", merged.Panel.Project.Visible},
		{"panel.project.width", merged.Panel.Project.Width},
	}
	for _, l := range leaves {
		encoded, err := json.Marshal(l.value)
		if err != nil {
			return model.Layout{}, fmt.Errorf("repos/layout: encode %s: %w", l.key, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO ui_layout (key, value) VALUES (?, ?)
			   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			l.key, string(encoded),
		); err != nil {
			return model.Layout{}, fmt.Errorf("repos/layout: upsert %s: %w", l.key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return model.Layout{}, fmt.Errorf("repos/layout: commit: %w", err)
	}
	return merged, nil
}
