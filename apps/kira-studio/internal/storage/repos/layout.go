package repos

import (
	"database/sql"
	"encoding/json"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appsettings"
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// LayoutRepo reads and writes the `ui_layout` table — same per-leaf-row shape as SettingsRepo,
// for the reason layout.ts's own comment gives (a per-key row survives an old build's missing
// keys without a schema migration).
type LayoutRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4); nil when constructed directly, which
	// falls back to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

// decodeLayout builds model.Layout from an already-scanned leaf map — the part of GetAll's read
// path that Set's own apply callback needs too, reading the same leaves inside its own
// transaction (P107 I2-1).
func decodeLayout(stored map[string]json.RawMessage) model.Layout {
	result := model.DefaultLayout()
	appsettings.Leaf(stored, "panel.project.visible", &result.Panel.Project.Visible)
	appsettings.Leaf(stored, "panel.project.width", &result.Panel.Project.Width)
	appsettings.Leaf(stored, "panel.operations.visible", &result.Panel.Operations.Visible)
	appsettings.Leaf(stored, "panel.operations.height", &result.Panel.Operations.Height)
	appsettings.Leaf(stored, "panel.cellEditor.height", &result.Panel.CellEditor.Height)
	return result
}

// applyLayoutPatch merges patch's set leaves onto merged — split out of Set's own closure to keep
// its cognitive complexity within this repo's linted bound (gocognit).
func applyLayoutPatch(merged *model.Layout, patch model.LayoutPatch) {
	p := patch.Panel
	if p == nil {
		return
	}
	if p.Project != nil {
		if p.Project.Visible != nil {
			merged.Panel.Project.Visible = *p.Project.Visible
		}
		if p.Project.Width != nil {
			merged.Panel.Project.Width = *p.Project.Width
		}
	}
	if p.Operations != nil {
		if p.Operations.Visible != nil {
			merged.Panel.Operations.Visible = *p.Operations.Visible
		}
		if p.Operations.Height != nil {
			merged.Panel.Operations.Height = *p.Operations.Height
		}
	}
	if p.CellEditor != nil && p.CellEditor.Height != nil {
		merged.Panel.CellEditor.Height = *p.CellEditor.Height
	}
}

func (r *LayoutRepo) GetAll() (model.Layout, error) {
	stored, err := appstorage.QueryLeaves(r.DB, r.selectAll, appstorage.LayoutSelectAllSQL)
	if err != nil {
		return model.Layout{}, err
	}
	return decodeLayout(stored), nil
}

// Set writes all six leaves every time (unlike SettingsRepo.Set's patched-leaves-only write —
// P53 §4.5 deliberately keeps the two repos different), mirroring layout.ts's flatten(merged).
//
// The read that feeds the merge runs inside this same transaction (P8 C7/F7's fix), not before
// Begin() the way it used to: two concurrent Set calls patching disjoint leaves would otherwise
// each compute their merge from a pre-write snapshot, and the loser's upsert of all six leaves
// would silently overwrite the winner's — measured at 109 lost patches out of 200 rounds against
// the pre-fix code (P8 plan §1.3(d)). storage/db.go's SetMaxOpenConns(1) means Begin() here holds
// the database's one connection exclusively until Commit/Rollback, so no other Set's read or
// write can land between this one's own read and write.
func (r *LayoutRepo) Set(patch model.LayoutPatch) (model.Layout, error) {
	var merged model.Layout
	err := appstorage.UpdateLeaves(r.DB, r.selectAll, appstorage.LayoutSelectAllSQL, func(tx *sql.Tx, stored map[string]json.RawMessage) error {
		merged = decodeLayout(stored)
		applyLayoutPatch(&merged, patch)

		return appstorage.UpsertLeafList(tx, "ui_layout", []appstorage.Leaf{
			{Key: "panel.project.visible", Value: merged.Panel.Project.Visible},
			{Key: "panel.project.width", Value: merged.Panel.Project.Width},
			{Key: "panel.operations.visible", Value: merged.Panel.Operations.Visible},
			{Key: "panel.operations.height", Value: merged.Panel.Operations.Height},
			{Key: "panel.cellEditor.height", Value: merged.Panel.CellEditor.Height},
		})
	})
	if err != nil {
		return model.Layout{}, err
	}
	return merged, nil
}
