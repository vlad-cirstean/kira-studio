package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// LayoutRepo reads and writes the `ui_layout` table — same per-leaf-row shape as SettingsRepo,
// for the reason layout.ts's own comment gives (a per-key row survives an old build's missing
// keys without a schema migration).
const layoutSelectAllSQL = `SELECT key, value FROM ui_layout`

type LayoutRepo struct {
	DB *sql.DB

	// selectAll is prepared once by repos.New (P52 §5.4); nil when constructed directly, which
	// falls back to an ad-hoc query with identical SQL.
	selectAll *sql.Stmt
}

// scanAll reads every stored leaf from whatever rows/err a query against either the top-level DB
// (GetAll's own fast path) or a live transaction (Set's fix below) produced — factored out so
// both callers build the same model.Layout from the same rows shape.
func (r *LayoutRepo) scanAll(rows *sql.Rows, queryErr error) (model.Layout, error) {
	if queryErr != nil {
		return model.Layout{}, fmt.Errorf("repos/layout: query: %w", queryErr)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return model.Layout{}, fmt.Errorf("repos/layout: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return model.Layout{}, fmt.Errorf("repos/layout: rows: %w", err)
	}

	result := model.DefaultLayout()
	leaf(stored, "panel.project.visible", &result.Panel.Project.Visible)
	leaf(stored, "panel.project.width", &result.Panel.Project.Width)
	leaf(stored, "panel.operations.visible", &result.Panel.Operations.Visible)
	leaf(stored, "panel.operations.height", &result.Panel.Operations.Height)
	leaf(stored, "panel.cellEditor.height", &result.Panel.CellEditor.Height)
	return result, nil
}

func (r *LayoutRepo) GetAll() (model.Layout, error) {
	if r.selectAll != nil {
		return r.scanAll(r.selectAll.Query())
	}
	return r.scanAll(r.DB.Query(layoutSelectAllSQL))
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
	tx, err := r.DB.Begin()
	if err != nil {
		return model.Layout{}, fmt.Errorf("repos/layout: begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var current model.Layout
	if r.selectAll != nil {
		current, err = r.scanAll(tx.Stmt(r.selectAll).Query())
	} else {
		current, err = r.scanAll(tx.Query(layoutSelectAllSQL))
	}
	if err != nil {
		return model.Layout{}, err
	}
	merged := current
	if p := patch.Panel; p != nil {
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

	leaves := []struct {
		key   string
		value any
	}{
		{"panel.project.visible", merged.Panel.Project.Visible},
		{"panel.project.width", merged.Panel.Project.Width},
		{"panel.operations.visible", merged.Panel.Operations.Visible},
		{"panel.operations.height", merged.Panel.Operations.Height},
		{"panel.cellEditor.height", merged.Panel.CellEditor.Height},
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
