package model

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

type Layout struct {
	Panel struct {
		Project    PanelProject    `json:"project"`
		Operations PanelOperations `json:"operations"`
		CellEditor PanelCellEditor `json:"cellEditor"`
	} `json:"panel"`
}

// DefaultLayout mirrors packages/shared/domain/layout.ts's defaultLayout verbatim. The window
// rectangle used to live here too (a single `window.bounds` leaf for every window there has ever
// been, P8 F5) — it is now per-window, in the `windows` table (model.WindowRecord, repos.WindowsRepo).
func DefaultLayout() Layout {
	var l Layout
	l.Panel.Project = PanelProject{Visible: true, Width: 260}
	l.Panel.Operations = PanelOperations{Visible: false, Height: 200}
	l.Panel.CellEditor = PanelCellEditor{Height: 180}
	return l
}

// PanelProjectPatch, PanelOperationsPatch and PanelCellEditorPatch mirror layout.ts's
// `.partial()` per-panel patch shapes.
type PanelProjectPatch struct {
	Visible *bool    `json:"visible,omitempty"`
	Width   *float64 `json:"width,omitempty"`
}

type PanelOperationsPatch struct {
	Visible *bool    `json:"visible,omitempty"`
	Height  *float64 `json:"height,omitempty"`
}

type PanelCellEditorPatch struct {
	Height *float64 `json:"height,omitempty"`
}

type PanelsPatch struct {
	Project    *PanelProjectPatch    `json:"project,omitempty"`
	Operations *PanelOperationsPatch `json:"operations,omitempty"`
	CellEditor *PanelCellEditorPatch `json:"cellEditor,omitempty"`
}

type LayoutPatch struct {
	Panel *PanelsPatch `json:"panel,omitempty"`
}
