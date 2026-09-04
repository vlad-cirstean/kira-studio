//go:build !darwin || server

package shell

import "unsafe"

// repositionTrafficLightsImpl is a no-op outside a real macOS window: there is no traffic-light
// cluster to move on Linux/Windows, and a -tags server build has no native window at all
// (docs/ARCHITECTURE.md's own "server mode has no file dialogs" note is the same shape of gap for
// that build).
func repositionTrafficLightsImpl(_ unsafe.Pointer, _, _ float64) {}
