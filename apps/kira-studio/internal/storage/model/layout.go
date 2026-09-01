package model

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

// DefaultLayout mirrors packages/shared/domain/layout.ts's defaultLayout verbatim.
func DefaultLayout() Layout {
	var l Layout
	l.Panel.Project = PanelProject{Visible: true, Width: 260}
	l.Panel.Operations = PanelOperations{Visible: false, Height: 200}
	l.Panel.CellEditor = PanelCellEditor{Height: 180}
	l.Window.Bounds = nil
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

// WindowPatch's Bounds is *WindowBounds (absent or set), not layoutPatchSchema's tri-state
// (absent/null/value) — D7: the only writer in the codebase (src/main/window.ts) always passes
// a real rectangle, so absent/null collapse to the same "leave it alone" meaning here.
type WindowPatch struct {
	Bounds *WindowBounds `json:"bounds,omitempty"`
}

type LayoutPatch struct {
	Panel  *PanelsPatch `json:"panel,omitempty"`
	Window *WindowPatch `json:"window,omitempty"`
}
