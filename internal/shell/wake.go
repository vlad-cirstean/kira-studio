package shell

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// AttachSystemWake fires onWake after the machine comes back from sleep (P87 §5). Wails already
// observes NSWorkspaceDidWakeNotification (application_darwin.go) and posts
// events.Mac.ApplicationDidWake from its app delegate — no pmset poll and no IOKit cgo of our own.
//
// Registering this listener is load-bearing, not merely how we hear about the event: the delegate
// body is `if (hasListeners(EventApplicationDidWake)) processApplicationEvent(...)`
// (application_darwin_delegate.m), so an unobserved event is never posted at all.
//
// events.Mac.ApplicationDidWake, not events.Common.SystemDidWake — the delegate posts the mac id
// specifically, and AttachReopen (repo-root internal/shell) already uses the events.Mac.*
// vocabulary. On Linux (wails3 task dev, and the -tags server build) the event simply never
// fires; the keep-awake driver is a no-op there anyway.
func AttachSystemWake(app *application.App, onWake func()) (detach func()) {
	return app.Event.OnApplicationEvent(events.Mac.ApplicationDidWake, func(*application.ApplicationEvent) {
		onWake()
	})
}
