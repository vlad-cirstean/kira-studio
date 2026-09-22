package shell

import (
	"errors"

	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// wails.go is the Wails adapters. Nothing else in this package's own callers below the app's own
// composition root imports pkg/application (P56 D1). P103 Part 3: the pieces here were identical
// in both apps — everything genuinely per-app (BuildTemplate, the bound-service Dialogs adapter,
// the stream registration, Kira Studio's own AttachSystemWake) stays in each app's own
// internal/appshell.

// emitter satisfies appevent.Emitter. EventManager.Emit takes data ...any (event_manager.go:31); a
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

// EmitTo delivers to exactly one window (P8 D6/C6) — the mechanism the per-window close-flush
// handshake needs, since app.Event.Emit fans out to every window (transport_event_ipc.go). A key
// naming no live window (already closed, or never existed) is a silent no-op, matching Emit's own
// "no app yet" no-op above.
func (e *emitter) EmitTo(windowKey string, name string, data any) {
	if e.app == nil {
		return
	}
	win, ok := e.app.Window.GetByName(windowKey)
	if !ok {
		return
	}
	win.DispatchWailsEvent(&application.CustomEvent{Name: name, Data: data})
}

// EmitFocused delivers to whichever window is currently key/focused (P8 D6/C9) — the successor to
// Electron's own sendToFocusedWindow(channel) (18fe7bb^:src/main/menu.ts:5-8). Current() resolves
// the real key window on darwin via [NSApp keyWindow] ?? [NSApp mainWindow]
// (application_darwin.go); on a build with no window (or this sandbox's Linux fallback with
// nothing focused) it returns nil, and there is nothing to deliver to, so this is a silent no-op —
// the same "no live target" shape EmitTo already has, not a broadcast fallback.
func (e *emitter) EmitFocused(name string, data any) {
	if e.app == nil {
		return
	}
	win := e.app.Window.Current()
	if win == nil {
		return
	}
	win.DispatchWailsEvent(&application.CustomEvent{Name: name, Data: data})
}

// NewDeferredEmitter builds an appevent.Emitter usable before application.New has returned an
// *App to emit through — §4.11's ordering knot: both appcore.Deps.Events (read by
// SettingsService.Set, built into the Services list passed to New) and the Quitter's own Signaller
// (whose ShouldQuit method value must come from an already-allocated Quitter, itself needing
// Events) are needed before New can be called, but New alone produces the App an emitter emits
// through. attach must be called with the real *App immediately after New returns, before
// anything has a chance to actually emit.
func NewDeferredEmitter() (e appevent.Emitter, attach func(*application.App)) {
	em := &emitter{}
	return em, func(app *application.App) { em.app = app }
}

// Dialogs is the Wails adapter behind every app's own bound-service Dialogs interface — plain
// parameters, not a bound-service request struct (P103 Part 3): bridge.SaveFileRequest/
// OpenFileRequest/OpenDirectoryRequest are Wails-bound service parameter types, so moving them
// would move the generated @bindings/* model they produce. Each app's own internal/appshell holds
// a tiny adapter destructuring its own request struct into these calls instead — the duplication
// left behind is two four-field structs, correct and expected, not a miss. Attaches each panel to
// the main window so it opens as a sheet rather than a free-floating modal (dialogs.go:456 / :247).
type Dialogs struct {
	app    *application.App
	window func() application.Window
}

func (d *Dialogs) SaveFile(directory, filename string) (string, error) {
	dlg := d.app.Dialog.SaveFile().AttachToWindow(d.window())
	if directory != "" {
		dlg.SetDirectory(directory)
	}
	if filename != "" {
		dlg.SetFilename(filename)
	}
	return dlg.PromptForSingleSelection()
}

func (d *Dialogs) OpenFile(title, filterName, filterPattern string) (string, error) {
	dlg := d.app.Dialog.OpenFile().AttachToWindow(d.window())
	if title != "" {
		dlg.SetTitle(title)
	}
	if filterName != "" {
		dlg.AddFilter(filterName, filterPattern)
	}
	return dlg.PromptForSingleSelection()
}

// OpenDirectory is P25 D13: the same OpenFile panel, switched to directory-picking mode —
// CanChooseDirectories(bool)/CanChooseFiles(bool) already exist on Wails v3 beta.16's
// OpenFileDialogStruct, so a folder picker is one more method on this seam, not a new mechanism.
func (d *Dialogs) OpenDirectory(title string) (string, error) {
	dlg := d.app.Dialog.OpenFile().AttachToWindow(d.window()).CanChooseFiles(false).CanChooseDirectories(true)
	if title != "" {
		dlg.SetTitle(title)
	}
	return dlg.PromptForSingleSelection()
}

// NewDeferredDialogs is NewDeferredEmitter's counterpart for FilesService: it too is built into
// the Services list passed to application.New, before the *App (and the main window func) a
// dialog needs exist. attach must be called with both immediately after New returns.
func NewDeferredDialogs() (d *Dialogs, attach func(app *application.App, window func() application.Window)) {
	da := &Dialogs{}
	return da, func(app *application.App, window func() application.Window) {
		da.app = app
		da.window = window
	}
}

// browserOpener satisfies each app's own bridge.Browser (OpenURL(url string) error) over the real
// Wails BrowserManager. app is nil until attach runs — see NewDeferredBrowser.
type browserOpener struct{ app *application.App }

func (b *browserOpener) OpenURL(url string) error {
	if b.app == nil {
		return errors.New("no application")
	}
	return b.app.Browser.OpenURL(url)
}

// NewDeferredBrowser is NewDeferredDialogs' counterpart for UpdateService/GitHubService: built
// into the Services list passed to application.New, before the *App a browser open needs exists.
// attach must be called with the real *App immediately after New returns. The returned value
// structurally satisfies each app's own bridge.Browser (a single OpenURL method), so no adapter is
// needed at the call site.
func NewDeferredBrowser() (b *browserOpener, attach func(*application.App)) {
	bo := &browserOpener{}
	return bo, func(app *application.App) { bo.app = app }
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
