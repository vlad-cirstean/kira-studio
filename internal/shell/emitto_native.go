//go:build !server

package shell

import "github.com/wailsapp/wails/v3/pkg/application"

// EmitTo delivers to exactly one window (P8 D6/C6) — the mechanism the per-window close-flush
// handshake needs, since app.Event.Emit fans out to every window (transport_event_ipc.go). A key
// naming no live window (already closed, or never existed) is a silent no-op, matching Emit's own
// "no app yet" no-op above.
func (e *emitter) EmitTo(windowKey string, name string, data any) {
	app := e.app.Load()
	if app == nil {
		return
	}
	win, ok := app.Window.GetByName(windowKey)
	if !ok {
		return
	}
	win.DispatchWailsEvent(&application.CustomEvent{Name: name, Data: data})
}
