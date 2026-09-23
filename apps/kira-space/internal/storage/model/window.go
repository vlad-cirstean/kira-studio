package model

import (
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// WindowBounds is a plain screen rectangle, shared by every window's stored geometry — a plain
// alias of appstorage.WindowBounds (P107 I2-3: the two were already field-for-field identical,
// JSON tags included).
type WindowBounds = appstorage.WindowBounds

// WindowRecord is one row of the `windows` table (P8 D2/D4) — a durable, shell-minted identity
// for one workbench. Bounds is nil until the window has been moved or resized at least once
// (D10: a freshly minted window with no stored rectangle inherits its cascade position instead).
//
// Kira Studio's own WindowRecord also carries a Mode field (the Studio/Api/Git/Terminal app mode a
// window was last closed in, P22 D12). Kira Space has no such multi-module app-mode concept — one
// window, one purpose — so this copy drops Mode entirely (P100 Part 1); confirmed safe via
// internal/shell/window.go, whose Options()/Attach() never read .Mode, only .Key/.Bounds. Without
// Mode, this shape is field-for-field identical to appstorage.WindowRecord too, so it's a plain
// alias of that (P107 I2-3), Validate() included.
type WindowRecord = appstorage.WindowRecord
