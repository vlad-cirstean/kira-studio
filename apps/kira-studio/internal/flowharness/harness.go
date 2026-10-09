// Package flowharness boots Kira Studio's real composition root (internal/appwire) over a temporary
// home for flow tests at the IPC boundary. Real: SQLite, the cipher, the adapter host and op log,
// httpclient, grpcclient, PTYs and login shells, the Docker engine, and local HTTP/HTTPS/gRPC
// servers (servers.go). Faked, each an OS seam: native dialogs, the keep-awake driver, the OS
// authentication prompt, the claude MCP installer and the window manager. Settings stay at their
// defaults; a test changes one only through SettingsService.Set, the way the UI does.
//
// Only _test.go files import this package. A flow test is:
//
//	func TestSend(t *testing.T) {
//		app := flowharness.New(t)
//		srv := flowharness.HTTP(t)
//		res, err := app.W.Http.Send(context.Background(), bridge.HttpSendArgs{ ... URL: srv.URL + "/echo" })
//		...
//		app.Events.Wait(t, "kira:api:dataChanged", nil, 5*time.Second)
//	}
package flowharness

import (
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appwire"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/flowtest"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Event and Events record every emit toward a window; see internal/flowtest.
type (
	Event  = flowtest.Event
	Events = flowtest.Events
)

// EnvComplete turns on the complete flow suite.
const EnvComplete = flowtest.EnvComplete

// Complete skips a test unless the complete suite is on.
func Complete(t testing.TB) { flowtest.Complete(t) }

// App is one booted Kira Studio.
type App struct {
	t *testing.T
	// Home is the isolated HOME (also what DefaultCwd and the docker config dir read); KiraHome is
	// KIRA_HOME.
	Home, KiraHome string

	W            *appwire.Wired
	Events       *Events
	Dialogs      *Dialogs
	KeepAwake    *KeepAwakeDriver
	McpInstaller *McpInstaller
	OSAuth       *OSAuth

	mu         sync.Mutex
	newWindows int
	db         *storage.DB
	stopped    bool
}

// New boots the app and tears it down at cleanup, in main's order.
func New(t *testing.T) *App {
	t.Helper()
	root := t.TempDir()
	a := &App{
		t: t, Home: filepath.Join(root, "home"), KiraHome: filepath.Join(root, "kira"),
		Events: flowtest.NewEvents(), Dialogs: &Dialogs{}, KeepAwake: &KeepAwakeDriver{},
		McpInstaller: &McpInstaller{}, OSAuth: &OSAuth{},
	}
	if err := mkdirs(a.Home); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KIRA_HOME", a.KiraHome)
	t.Setenv("HOME", a.Home)
	t.Setenv("TZ", "UTC")
	// Linux has no keychain; a no-op on macOS, where the real Keychain-backed cipher is used.
	t.Setenv("KIRA_INSECURE_SECRETS", "1")
	useDockerHost(t)
	a.build()
	t.Cleanup(a.stop)
	return a
}

func (a *App) build() {
	a.t.Helper()
	if err := config.EnsureLayout(); err != nil {
		a.t.Fatalf("ensure layout: %v", err)
	}
	db, err := storage.Open()
	if err != nil {
		a.t.Fatalf("storage.Open: %v", err)
	}
	r, err := repos.New(db.DB)
	if err != nil {
		a.t.Fatalf("repos.New: %v", err)
	}
	cipher := secrets.New()
	if !cipher.Status().Available {
		a.t.Fatalf("cipher unavailable: %+v", cipher.Status())
	}
	w, err := appwire.Build(appwire.Options{
		DB: db, Repos: r, Cipher: cipher,
		Authorizer: localauth.New(time.Now, a.OSAuth.evaluate, a.OSAuth.isAvailable),
		Emitter:    a.Events, Dialogs: a.Dialogs, KeepAwakeDriver: a.KeepAwake, McpInstaller: a.McpInstaller,
		AppName: "Kira Studio", Version: "flowtest",
	})
	if err != nil {
		a.t.Fatalf("appwire.Build: %v", err)
	}
	w.WindowsSvc.OpenNewWindow = func() {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.newWindows++
	}
	a.db, a.W, a.stopped = db, w, false
	// The cookie jar is process-global in httpclient.
	if err := w.Http.ClearCookies(); err != nil {
		a.t.Fatalf("clear cookies: %v", err)
	}
}

// DB is the live database, for tests that plant or inspect rows no bound call reaches.
func (a *App) DB() *sql.DB { return a.db.DB }

// NewWindows is how many times the app asked the shell for a new window.
func (a *App) NewWindows() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.newWindows
}

// CloseWindow runs what closing a window runs in the shell: the terminal registry's CloseWindow,
// then each OnWindowClosing hook (internal/shell/openwindow.go).
func (a *App) CloseWindow(key string) {
	a.W.TerminalRegistry.CloseWindow(key)
	for _, hook := range a.W.OnWindowClosing {
		hook(key)
	}
}

func (a *App) stop() {
	if a.stopped {
		return
	}
	a.stopped = true
	a.W.BeforeFlush()
	a.W.Teardown()
}

// Quit runs the app-quit sequence: BeforeFlush, Teardown, then ServiceShutdown on every bound
// service that has one, as Wails does. Services and streams from before are dead afterwards.
func (a *App) Quit(t testing.TB) {
	t.Helper()
	a.stop()
	svcs := a.W.Bound()
	for i := len(svcs) - 1; i >= 0; i-- {
		if s, ok := svcs[i].Instance().(application.ServiceShutdown); ok {
			if err := s.ServiceShutdown(); err != nil {
				t.Errorf("ServiceShutdown: %v", err)
			}
		}
	}
}

// Restart tears the app down and rebuilds it on the same home, as a relaunch does. References to
// the old Wired are dead.
func (a *App) Restart(t testing.TB) {
	t.Helper()
	a.Quit(t)
	a.build()
}
