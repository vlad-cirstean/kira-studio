package shell

import (
	"log/slog"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// AttachActivationTrace logs app activate/resign/hide/unhide at Debug (P396 Space-switch trace).
// Registering is load-bearing: the app delegate posts an event only when a listener exists
// (application_darwin_delegate.m). Never fires on Linux.
func AttachActivationTrace(app *application.App) (detach func()) {
	evs := []struct {
		t    events.ApplicationEventType
		name string
	}{
		{events.Mac.ApplicationDidBecomeActive, "ApplicationDidBecomeActive"},
		{events.Mac.ApplicationDidResignActive, "ApplicationDidResignActive"},
		{events.Mac.ApplicationDidHide, "ApplicationDidHide"},
		{events.Mac.ApplicationDidUnhide, "ApplicationDidUnhide"},
	}
	offs := make([]func(), 0, len(evs))
	for _, e := range evs {
		offs = append(offs, app.Event.OnApplicationEvent(e.t, func(*application.ApplicationEvent) {
			slog.Debug("app event", "scope", "window", "event", e.name)
		}))
	}
	return func() {
		for _, off := range offs {
			off()
		}
	}
}
