package model

import "fmt"

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
type WindowRecord struct {
	Key    string        `json:"key"`
	Order  int           `json:"order"`
	Bounds *WindowBounds `json:"bounds"`
}

// Validate is the same non-empty-identity envelope TabRecord.Validate enforces (P2 R2's
// discipline applied here too): a bad row is refused at the write site, not left to silently
// round-trip and vanish on the next read.
func (w WindowRecord) Validate() error {
	if w.Key == "" {
		return fmt.Errorf("model: window: key is required")
	}
	if w.Order < 0 {
		return fmt.Errorf("model: window %q: order must be >= 0", w.Key)
	}
	return nil
}
