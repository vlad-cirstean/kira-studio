package model

import (
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// WindowBounds is a plain screen rectangle, shared by every window's stored geometry.
type WindowBounds struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// WindowRecord is one row of the `windows` table (P8 D2/D4) — a durable, shell-minted identity
// for one workbench. Bounds is nil until the window has been moved or resized at least once
// (D10: a freshly minted window with no stored rectangle inherits its cascade position instead).
//
// Kira Studio's own WindowRecord also carries a Mode field (the Studio/Api/Git/Terminal app mode a
// window was last closed in, P22 D12). Kira Space has no such multi-module app-mode concept — one
// window, one purpose — so this copy drops Mode entirely (P100 Part 1); confirmed safe via
// internal/shell/window.go, whose Options()/Attach() never read .Mode, only .Key/.Bounds.
type WindowRecord struct {
	Key    string        `json:"key"`
	Order  int           `json:"order"`
	Bounds *WindowBounds `json:"bounds"`
}

// Validate is the same non-empty-identity envelope Kira Studio's own WindowRecord.Validate
// enforces: a bad row is refused at the write site, not left to silently round-trip and vanish on
// the next read.
func (w WindowRecord) Validate() error {
	return appstorage.ValidateWindowBounds(w.Key, w.Order)
}
