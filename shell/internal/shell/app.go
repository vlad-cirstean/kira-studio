package shell

import (
	"github.com/kirathecat/kira-studio/shell/internal/adapterhost"
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// app.go is the Wails adapters. Nothing else in the repo imports pkg/application (P56 D1).

// emitter satisfies appcore.Emitter. EventManager.Emit takes data ...any (event_manager.go:31); a
// single argument is how a payload-free signal (nil, D6) or a real payload is expressed either
// way. app is nil until attach runs — see NewDeferredEmitter.
type emitter struct {
	app *application.App
}

func (e *emitter) Emit(name string, data any) {
	if e.app == nil {
		return
	}
	e.app.Event.Emit(name, data)
}

// NewDeferredEmitter builds an appcore.Emitter usable before application.New has returned an
// *App to emit through — §4.11's ordering knot: both appcore.Deps.Events (read by
// SettingsService.Set, built into the Services list passed to New) and the Quitter's
// *bridge.Events (whose ShouldQuit method value must come from an already-allocated Quitter,
// itself needing Events) are needed before New can be called, but New alone produces the App an
// emitter emits through. attach must be called with the real *App immediately after New returns,
// before anything has a chance to actually emit.
func NewDeferredEmitter() (e appcore.Emitter, attach func(*application.App)) {
	em := &emitter{}
	return em, func(app *application.App) { em.app = app }
}

// dialogs satisfies bridge.Dialogs, attaching each panel to the main window so it opens as a
// sheet rather than a free-floating modal (dialogs.go:456 / :247).
type dialogs struct {
	app    *application.App
	window func() application.Window
}

func (d *dialogs) SaveFile(req bridge.SaveFileRequest) (string, error) {
	dlg := d.app.Dialog.SaveFile().AttachToWindow(d.window())
	if req.Directory != "" {
		dlg.SetDirectory(req.Directory)
	}
	if req.Filename != "" {
		dlg.SetFilename(req.Filename)
	}
	return dlg.PromptForSingleSelection()
}

func (d *dialogs) OpenFile(req bridge.OpenFileRequest) (string, error) {
	dlg := d.app.Dialog.OpenFile().AttachToWindow(d.window())
	if req.Title != "" {
		dlg.SetTitle(req.Title)
	}
	if req.FilterName != "" {
		dlg.AddFilter(req.FilterName, req.FilterPattern)
	}
	return dlg.PromptForSingleSelection()
}

// NewDeferredDialogs is NewDeferredEmitter's counterpart for FilesService: it too is built into
// the Services list passed to application.New, before the *App (and the main window func) a
// dialog needs exist. attach must be called with both immediately after New returns.
func NewDeferredDialogs() (d bridge.Dialogs, attach func(app *application.App, window func() application.Window)) {
	da := &dialogs{}
	return da, func(app *application.App, window func() application.Window) {
		da.app = app
		da.window = window
	}
}

// RegisterEngineStream registers the one named stream. The handler blocks for the life of the
// connection, which is what keeps it open (stream.go:162-166's StreamHandler contract). Takes the
// router, not the engine host, since M4: the data plane is a server now, not a byte forwarder
// (P58 D3).
func RegisterEngineStream(app *application.App, router *adapterhost.Router) {
	app.HandleStream(bridge.StreamName, func(c *application.StreamConn) {
		bridge.ServeEngineStream(router, c)
	})
}

// AttachReopen is src/main/index.ts:141-145's `activate` handler: on macOS, closing the last
// window leaves the app running (P56 D10), and clicking the Dock icon brings a window back.
// Wails' own default reopen handler (events_common_darwin.go) only re-shows a hidden-but-extant
// window; it does not create one when none exist at all, which is the Electron behaviour this
// mirrors.
func AttachReopen(app *application.App, newWindow func()) (detach func()) {
	return app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {
		if len(app.Window.GetAll()) == 0 {
			newWindow()
		}
	})
}
