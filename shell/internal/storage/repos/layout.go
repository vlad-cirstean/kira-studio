package repos

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

type WindowBounds struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type PanelProject struct {
	Visible bool    `json:"visible"`
	Width   float64 `json:"width"`
}

type PanelOperations struct {
	Visible bool    `json:"visible"`
	Height  float64 `json:"height"`
}

type PanelCellEditor struct {
	Height float64 `json:"height"`
}

type LayoutWindow struct {
	Bounds *WindowBounds `json:"bounds"`
}

type Layout struct {
	Panel struct {
		Project    PanelProject    `json:"project"`
		Operations PanelOperations `json:"operations"`
		CellEditor PanelCellEditor `json:"cellEditor"`
	} `json:"panel"`
	Window LayoutWindow `json:"window"`
}

// DefaultLayout mirrors src/shared/domain/layout.ts's defaultLayout verbatim.
func DefaultLayout() Layout {
	var l Layout
	l.Panel.Project = PanelProject{Visible: true, Width: 260}
	l.Panel.Operations = PanelOperations{Visible: false, Height: 200}
	l.Panel.CellEditor = PanelCellEditor{Height: 180}
	l.Window.Bounds = nil
	return l
}

// LayoutRepo reads and writes the `ui_layout` table — same per-leaf-row shape as SettingsRepo,
// for the reason layout.ts's own comment gives (a per-key row survives an old build's missing
// keys without a schema migration).
type LayoutRepo struct {
	DB *sql.DB
}

func (r *LayoutRepo) GetAll() (Layout, error) {
	rows, err := r.DB.Query(`SELECT key, value FROM ui_layout`)
	if err != nil {
		return Layout{}, fmt.Errorf("repos/layout: query: %w", err)
	}
	defer rows.Close()

	stored := map[string]json.RawMessage{}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return Layout{}, fmt.Errorf("repos/layout: scan: %w", err)
		}
		stored[key] = json.RawMessage(value)
	}
	if err := rows.Err(); err != nil {
		return Layout{}, fmt.Errorf("repos/layout: rows: %w", err)
	}

	result := DefaultLayout()
	leaf(stored, "panel.project.visible", &result.Panel.Project.Visible)
	leaf(stored, "panel.project.width", &result.Panel.Project.Width)
	leaf(stored, "panel.operations.visible", &result.Panel.Operations.Visible)
	leaf(stored, "panel.operations.height", &result.Panel.Operations.Height)
	leaf(stored, "panel.cellEditor.height", &result.Panel.CellEditor.Height)
	leaf(stored, "window.bounds", &result.Window.Bounds)
	return result, nil
}
