package shell

import (
	"errors"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// app.go is the Wails adapter layer — Kira Studio's own shell/app.go, trimmed to what this app's
// bridge services need: an appcore.Emitter, a Browser for GitHubService, Dialogs for FilesService
// (P100 Part 2), the git stream registration and the Dock-reopen handler. Kira Studio's own copy
// also builds a system-wake hook (no keep-awake service in this app).

// emitter satisfies appcore.Emitter. app is nil until attach runs — see NewDeferredEmitter.
type emitter struct {
	app *application.App
}

func (e *emitter) Emit(name string, data any) {
	if e.app == nil {
		return
	}
	e.app.Event.Emit(name, data)
}

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

// NewDeferredEmitter builds an appcore.Emitter usable before application.New has returned an
// *App to emit through — Kira Studio's own §4.11 ordering knot applies here too: appcore.Deps.
// Events is needed before New can be called, but New alone produces the App an emitter emits
// through. attach must be called with the real *App immediately after New returns.
func NewDeferredEmitter() (e appcore.Emitter, attach func(*application.App)) {
	em := &emitter{}
	return em, func(app *application.App) { em.app = app }
}

// browserOpener satisfies bridge.Browser over the real Wails BrowserManager — GitHubService's own
// OpenPullRequestURL target.
type browserOpener struct{ app *application.App }

func (b *browserOpener) OpenURL(url string) error {
	if b.app == nil {
		return errors.New("no application")
	}
	return b.app.Browser.OpenURL(url)
}

// NewDeferredBrowser is NewDeferredEmitter's counterpart for GitHubService.
func NewDeferredBrowser() (b bridge.Browser, attach func(*application.App)) {
	bo := &browserOpener{}
	return bo, func(app *application.App) { bo.app = app }
}

// dialogs satisfies bridge.Dialogs, attaching the panel to the main window so it opens as a sheet
// rather than a free-floating modal — Kira Studio's own shell/app.go dialogs type, trimmed to the
// one panel this app needs (OpenDirectory only; bridge/files.go's own doc comment says why).
type dialogs struct {
	app    *application.App
	window func() application.Window
}

func (d *dialogs) OpenDirectory(req bridge.OpenDirectoryRequest) (string, error) {
	dlg := d.app.Dialog.OpenFile().AttachToWindow(d.window()).CanChooseFiles(false).CanChooseDirectories(true)
	if req.Title != "" {
		dlg.SetTitle(req.Title)
	}
	return dlg.PromptForSingleSelection()
}

// NewDeferredDialogs is NewDeferredEmitter's counterpart for FilesService: built into the Services
// list passed to application.New, before the *App (and the main window func) a dialog needs
// exist. attach must be called with both immediately after New returns.
func NewDeferredDialogs() (d bridge.Dialogs, attach func(app *application.App, window func() application.Window)) {
	da := &dialogs{}
	return da, func(app *application.App, window func() application.Window) {
		da.app = app
		da.window = window
	}
}

// RegisterGitStream registers the git stream — Kira Studio's own RegisterGitStream, carrying
// gitrpc's own wire protocol read-only (bridge.ServeGitStream's own allowlist).
func RegisterGitStream(app *application.App, router *gitrpc.Router) {
	app.HandleStream(bridge.GitStreamName, func(c *application.StreamConn) {
		bridge.ServeGitStream(router, c)
	})
}

// AttachReopen is macOS's `activate` handler: closing the last window leaves the app running
// (Mac.ApplicationShouldTerminateAfterLastWindowClosed: false, main.go), and clicking the Dock
// icon brings a window back — Kira Studio's own AttachReopen, unchanged.
func AttachReopen(app *application.App, newWindow func()) (detach func()) {
	return app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(*application.ApplicationEvent) {
		if len(app.Window.GetAll()) == 0 {
			newWindow()
		}
	})
}
