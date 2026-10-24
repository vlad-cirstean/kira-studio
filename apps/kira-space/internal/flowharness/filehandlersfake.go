package flowharness

import (
	"fmt"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/filehandlers"
)

// FakeHandlers is an in-memory default-app database. Extensions are unavailable (a dynamic type)
// unless Declare'd; an app that is not Install'ed cannot be set as a default.
type FakeHandlers struct {
	mu        sync.Mutex
	declared  map[string]bool
	shared    map[string]string // ext -> ext whose type it shares
	defaults  map[string]filehandlers.App
	installed map[string]filehandlers.App
	self      filehandlers.App
}

// NewFakeHandlers returns a database whose only installed app is Kira Space.
func NewFakeHandlers() *FakeHandlers {
	self := filehandlers.App{Path: "/Applications/Kira Space.app", BundleID: "com.kirathecat.kira-space", Name: "Kira Space"}
	return &FakeHandlers{
		declared: map[string]bool{}, shared: map[string]string{}, defaults: map[string]filehandlers.App{},
		installed: map[string]filehandlers.App{self.Path: self}, self: self,
	}
}

func (f *FakeHandlers) uti(ext string) string {
	if with, ok := f.shared[ext]; ok {
		ext = with
	}
	return "test.uti." + ext
}

// Share makes ext resolve to the same type as with (yml and yaml); both must be Declare'd.
func (f *FakeHandlers) Share(ext, with string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.shared[ext] = with
}

// Declare makes ext resolve to a real type, handled by app (zero App means no handler).
func (f *FakeHandlers) Declare(ext string, app filehandlers.App) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.declared[ext] = true
	if app.Path != "" {
		f.defaults[f.uti(ext)] = app
	}
}

// Install makes app a valid target for SetDefault.
func (f *FakeHandlers) Install(app filehandlers.App) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.installed[app.Path] = app
}

// Uninstall removes app, as dragging it to the Trash does.
func (f *FakeHandlers) Uninstall(app filehandlers.App) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.installed, app.Path)
}

// HandlerOf returns the current handler of ext.
func (f *FakeHandlers) HandlerOf(ext string) filehandlers.App {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.defaults[f.uti(ext)]
}

func (f *FakeHandlers) Supported() bool { return true }

func (f *FakeHandlers) Resolve(ext string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.uti(ext), !f.declared[ext]
}

func (f *FakeHandlers) Default(uti string) (filehandlers.App, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.defaults[uti], nil
}

func (f *FakeHandlers) SetDefault(uti, appPath string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	app, ok := f.installed[appPath]
	if !ok {
		return fmt.Errorf("app not found: %s", appPath)
	}
	f.defaults[uti] = app
	return nil
}

func (f *FakeHandlers) Self() filehandlers.App { return f.self }
