package repos

import (
	"database/sql"
	"encoding/json"

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

// decodeLayout builds model.Layout from an already-scanned leaf map — the part of GetAll's read
// path that Set's own apply callback needs too, reading the same leaves inside its own
// transaction (P107 I2-1).
func decodeLayout(stored map[string]json.RawMessage) model.Layout {
	result := model.DefaultLayout()
	appsettings.Leaf(stored, "panel.project.visible", &result.Panel.Project.Visible)
	appsettings.Leaf(stored, "panel.project.width", &result.Panel.Project.Width)
	return result
}

func (r *LayoutRepo) GetAll() (model.Layout, error) {
	stored, err := appstorage.QueryLeaves(r.DB, r.selectAll, appstorage.LayoutSelectAllSQL)
	if err != nil {
		return model.Layout{}, err
	}
	return decodeLayout(stored), nil
}

// Set writes both leaves every time, mirroring Kira Studio's own LayoutRepo.Set (the read-modify-
// write runs inside one transaction — storage/db.go's SetMaxOpenConns(1) makes that transaction's
// Begin() hold the database's one connection exclusively until Commit/Rollback, so no concurrent
// Set can race it — same C7/F7 fix Kira Studio's own copy documents).
func (r *LayoutRepo) Set(patch model.LayoutPatch) (model.Layout, error) {
	var merged model.Layout
	err := appstorage.UpdateLeaves(r.DB, r.selectAll, appstorage.LayoutSelectAllSQL, func(tx *sql.Tx, stored map[string]json.RawMessage) error {
		merged = decodeLayout(stored)
		if p := patch.Panel; p != nil && p.Project != nil {
			if p.Project.Visible != nil {
				merged.Panel.Project.Visible = *p.Project.Visible
			}
			if p.Project.Width != nil {
				merged.Panel.Project.Width = *p.Project.Width
			}
		}

		return appstorage.UpsertLeafList(tx, "ui_layout", []appstorage.Leaf{
			{Key: "panel.project.visible", Value: merged.Panel.Project.Visible},
			{Key: "panel.project.width", Value: merged.Panel.Project.Width},
		})
	})
	if err != nil {
		return model.Layout{}, err
	}
	return merged, nil
}
