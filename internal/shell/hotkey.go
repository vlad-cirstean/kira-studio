package shell

import (
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// GlobalShortcuts is the slice of Wails' *application.GlobalShortcutManager a HotkeyBinding needs.
type GlobalShortcuts interface {
	Register(accelerator string, callback func()) error
	Unregister(accelerator string) error
}

// Hotkey states.
const (
	HotkeyOff       = "off"
	HotkeyActive    = "active"
	HotkeyRequested = "requested" // Wayland: asked of the portal, binding unconfirmed
	HotkeyFailed    = "failed"
)

// HotkeyState is the binding as the settings pane shows it.
type HotkeyState struct {
	State       string `json:"state"`
	Accelerator string `json:"accelerator"`
	Reason      string `json:"reason,omitempty"`
}

// IsWayland follows Wails' own rule: XDG_SESSION_TYPE wins, else WAYLAND_DISPLAY.
func IsWayland() bool {
	switch strings.ToLower(os.Getenv("XDG_SESSION_TYPE")) {
	case "wayland":
		return true
	case "x11":
		return false
	}
	return os.Getenv("WAYLAND_DISPLAY") != ""
}

// HotkeyBinding holds the one active global accelerator. Settings writes, the startup apply and
// the app ErrorHandler race, so every method takes the mutex.
type HotkeyBinding struct {
	mu      sync.Mutex
	sc      GlobalShortcuts
	wayland func() bool
	current string // accelerator registered with sc; "" when none
	state   HotkeyState
}

// NewHotkeyBinding builds a binding over sc; wayland nil uses IsWayland.
func NewHotkeyBinding(sc GlobalShortcuts, wayland func() bool) *HotkeyBinding {
	if wayland == nil {
		wayland = IsWayland
	}
	return &HotkeyBinding{sc: sc, wayland: wayland, state: HotkeyState{State: HotkeyOff}}
}

// Apply makes accel the one registered chord (or none when disabled) and returns the new state.
func (b *HotkeyBinding) Apply(enabled bool, accel string, cb func()) HotkeyState {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.current != "" {
		if err := b.sc.Unregister(b.current); err != nil {
			slog.Debug("unregister global shortcut", "scope", "capture", "err", err)
		}
		b.current = ""
	}
	if !enabled {
		b.state = HotkeyState{State: HotkeyOff, Accelerator: accel}
		return b.state
	}
	if err := b.sc.Register(accel, cb); err != nil {
		b.state = HotkeyState{State: HotkeyFailed, Accelerator: accel, Reason: err.Error()}
		return b.state
	}
	b.current = accel
	st := HotkeyActive
	if b.wayland() {
		st = HotkeyRequested
	}
	b.state = HotkeyState{State: st, Accelerator: accel}
	return b.state
}

// ReportError records an asynchronous registration failure from the app ErrorHandler.
func (b *HotkeyBinding) ReportError(err error) HotkeyState {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state.State != HotkeyActive && b.state.State != HotkeyRequested {
		return b.state
	}
	if !b.wayland() {
		b.current = "" // Wails rolls the registration back on an OS rejection
	}
	b.state = HotkeyState{State: HotkeyFailed, Accelerator: b.state.Accelerator, Reason: fmt.Sprint(err)}
	return b.state
}

// State returns the current state.
func (b *HotkeyBinding) State() HotkeyState {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}
