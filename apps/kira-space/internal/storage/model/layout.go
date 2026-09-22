package model

// PanelProject is the repo-tree panel's own persisted state — Kira Studio's own model.Layout
// carries three panels (project/operations/cellEditor, storage/model/layout.go); Kira Space has
// no operations-results grid and no cell editor (both DB-grid concepts this app's ported views
// never use), so this copy keeps only Project (P100 Part 2, plan §5.4).
type PanelProject struct {
	Visible bool    `json:"visible"`
	Width   float64 `json:"width"`
}

type Layout struct {
	Panel struct {
		Project PanelProject `json:"project"`
	} `json:"panel"`
}

// DefaultLayout mirrors Kira Studio's own DefaultLayout, minus the two dropped panels.
func DefaultLayout() Layout {
	var l Layout
	l.Panel.Project = PanelProject{Visible: true, Width: 260}
	return l
}

// PanelProjectPatch mirrors Kira Studio's own PanelProjectPatch — the `.partial()` patch shape.
type PanelProjectPatch struct {
	Visible *bool    `json:"visible,omitempty"`
	Width   *float64 `json:"width,omitempty"`
}

type PanelsPatch struct {
	Project *PanelProjectPatch `json:"project,omitempty"`
}

type LayoutPatch struct {
	Panel *PanelsPatch `json:"panel,omitempty"`
}
