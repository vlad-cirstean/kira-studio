package main

import (
	"embed"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/clickhouse"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/kafka"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/mariadb"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/mongo"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/mysql"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/postgres"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/redis"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/s3"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/sqlite"
	_ "github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters/sqs"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/metrics"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/preconnect"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
	"github.com/wailsapp/wails/v3/pkg/application"
	// Aliased: main.go's own `events` local var (bridge.NewEvents) would otherwise shadow this
	// package for the rest of the function, exactly where openWindow's WindowClosing listener
	// needs it.
	wailsevents "github.com/wailsapp/wails/v3/pkg/events"
)

// Any files in frontend/dist are embedded into the binary — built by `bun run build` from
// the real apps/kira-studio/frontend/src (P52 §2.3), not by this scaffold's own removed demo frontend project.
//
//go:embed all:frontend/dist
var assets embed.FS

// blank is gate G1's configuration (1) (P52 §3.2): a static page making the one AppService.Info()
// call, measuring the floor cost of Wails + the webview + Go with no app in it. Selected via
// KIRA_G1_BLANK=1, never in normal operation.
//
//go:embed blank/index.html
var blankAssets embed.FS

// main's startup order mirrors src/main/index.ts (P52 §4.1), with the upgradeLegacySecrets step
// deleted, not ported (P52 §6.4): config.EnsureLayout -> logging.Init/Sweep -> storage.Open
// (migrates) -> secrets.New -> repos.New + repos.NewSecrets -> Settings.GetAll ->
// adapterhost.NewRouter -> preconnect.New -> connections.New(...).Start -> tree.New ->
// router.PushCacheConfig -> oplog.New(...).Start -> metrics ticker Start -> shell.NewQuitter ->
// application.New(Services, ShouldQuit, OnShutdown) -> attach the deferred emitter and the
// Quitter to the now-real App -> menu -> engine stream -> reopen handler -> the main window ->
// app.Run() (P56 §4.11). There is no Node engine child to start any more (P58f M10 Phase 4).
func main() {
	startedAt := time.Now()

	if err := config.EnsureLayout(); err != nil {
		log.Fatalf("kira-studio-shell: ensure layout: %v", err)
	}
	if err := logging.Init(); err != nil {
		log.Fatalf("kira-studio-shell: logging: %v", err)
	}
	logging.Sweep()

	db, err := storage.Open()
	if err != nil {
		log.Fatalf("kira-studio-shell: storage: %v", err)
	}

	cipher := secrets.New()
	// P14: constructed beside the cipher so its own startup log records OS-authentication
	// availability the same way cipher's Status does.
	authorizer := localauth.New(time.Now, localauth.Evaluate, localauth.Available)

	repositories, err := repos.New(db.DB)
	if err != nil {
		log.Fatalf("kira-studio-shell: storage repos: %v", err)
	}
	secretsRepo := repos.NewSecrets(db.DB, cipher)

	deps := appcore.Deps{
		DB:        db.DB,
		StartedAt: startedAt.UnixMilli(),
		Repos:     repositories,
	}

	// Read from the just-migrated (possibly still-default) settings row, same as production would
	// before any user override exists — the cache budget below needs it.
	settings, err := deps.Repos.Settings.GetAll()
	if err != nil {
		log.Fatalf("kira-studio-shell: read settings: %v", err)
	}

	adapterDeps := adapters.Deps{Log: func(level, message string) {
		switch level {
		case "error":
			slog.Error(message, "scope", "adapter")
		case "warn":
			slog.Warn(message, "scope", "adapter")
		default:
			slog.Info(message, "scope", "adapter")
		}
	}}
	goCache := enginecache.NewCache(settings.Cache.L2BudgetMb*1024*1024, adapterDeps.Log)
	router := adapterhost.NewRouter(adapterDeps, goCache)
	deps.Router = router

	preconnectSupervisor := preconnect.New()
	connectionsSvc := connections.New(connections.Deps{
		Conns: repositories.Connections, Secrets: secretsRepo, Metadata: repositories.Metadata,
		Cipher: cipher, Auth: authorizer, Backend: router, Preconnect: preconnectSupervisor,
	})
	connectionsSvc.Start()
	deps.Connections = connectionsSvc

	treeSvc := tree.New(repositories.Connections, repositories.Metadata, router, connectionsSvc)
	deps.Tree = treeSvc

	// Configure pushes the budget to both caches (§4.9).
	router.PushCacheConfig(settings)

	// The router's in-process scheduler is oplog's only EventSource now (P58f D9) — every kind has
	// been native since P58e, so the Node child never produces an op:start/op:end of its own to fan
	// in (enginebackend.Merge, which used to do that, is deleted).
	oplogWiring := oplog.New(router.Host(), repositories.Ops, settings.Advanced.OpLogRetentionDays)
	oplogWiring.Start()

	processSet := metrics.NewCachedPIDs(
		func() ([]int32, error) { return metrics.AppProcessSet(metrics.AnchorNeedles, metrics.HelperNeedles) },
		metrics.RescanEvery,
	)
	metricsTicker := metrics.NewTicker(processSet.PIDs, metrics.Interval)
	metricsTicker.Start()

	// The two adapters below are needed inside the Services list, which is itself an argument to
	// application.New — but both need the *App that New alone produces (P56 §4.11's ordering
	// knot). Each is built "deferred": usable now, wired to the real App by attach() once New has
	// returned, well before Run() lets the renderer or any signal path actually call through it.
	emitter, attachEmitter := shell.NewDeferredEmitter()
	deps.Events = emitter
	dialogs, attachDialogs := shell.NewDeferredDialogs()

	events := bridge.NewEvents(emitter)
	eventsDetach := events.Attach(bridge.Sources{Connections: connectionsSvc, Oplog: oplogWiring, Metrics: metricsTicker})

	// windows holds every currently open window's shell.Attach cleanup, keyed by that window's own
	// identity (P8 C2, replacing the single detachWindow/mainWindow pair that only ever worked
	// because at most one window could exist at a time — F4). beforeFlush detaches every one of
	// them, not just the most recently created (P2 R1's finding, generalised past one window).
	windows := shell.NewWindowRegistry()

	// closeFlush routes each window's own "flush before close" ack back to whichever
	// shell.AttachCloseFlush hook is waiting for it (P8 C6, F8's fix) — a separate handshake from
	// the quit one below: at most one window is ever waiting at a time.
	closeFlush := shell.NewCloseFlushCoordinator()

	// teardown is today's OnShutdown, minus the ticker Stop (which moves to beforeFlush, run
	// before the flush wait rather than after it — P56 D3/index.ts:156).
	beforeFlush := sync.OnceFunc(func() {
		metricsTicker.Stop()
		windows.DetachAll()
	})
	teardown := sync.OnceFunc(func() {
		eventsDetach()
		oplogWiring.Stop()
		connectionsSvc.Shutdown()
		if err := repositories.Close(); err != nil {
			slog.Warn("close repos", "scope", "shutdown", "err", err)
		}
		if err := db.Close(); err != nil {
			slog.Warn("close db", "scope", "shutdown", "err", err)
		}
	})
	quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second, windows.Keys)

	app := application.New(application.Options{
		Name: "Kira Studio",
		// The macOS About item is `application.About` in internal/shell/menutemplate.go, and Wails
		// renders that role with its own dialog — Name, this Description and the icon, with no
		// version field of its own (pkg/application/menu_manager.go's ShowAbout). So the version
		// goes in the description, which is the only string that dialog will show.
		Description: "A visual database client for macOS\n\nVersion " + buildinfo.Version,
		Services: []application.Service{
			application.NewService(&bridge.AppService{Deps: deps}),
			application.NewService(&bridge.SettingsService{Deps: deps}),
			application.NewService(&bridge.LayoutService{Deps: deps}),
			application.NewService(&bridge.TabsService{Deps: deps}),
			application.NewService(&bridge.WindowsService{Deps: deps}),
			application.NewService(&bridge.ConnectionsService{Deps: deps}),
			application.NewService(&bridge.TreeService{Deps: deps}),
			application.NewService(&bridge.EngineService{Deps: deps}),
			application.NewService(&bridge.OpsService{Deps: deps, Canceller: router}),
			application.NewService(&bridge.FiltersService{Deps: deps}),
			application.NewService(&bridge.FilesService{Dialogs: dialogs}),
			application.NewService(&bridge.QueriesService{Deps: deps}),
			application.NewService(&bridge.SchemaService{Deps: deps}),
			application.NewService(&bridge.LifecycleService{Flusher: quitter, WindowFlusher: closeFlush}),
		},
		Assets: application.AssetOptions{
			Handler: assetHandler(),
		},
		Mac: application.MacOptions{
			// P56 D10: closing the last window leaves the app running, matching Electron's
			// default — AttachReopen below is what brings a window back.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		ShouldQuit: quitter.ShouldQuit,
		OnShutdown: quitter.Shutdown,
	})

	attachEmitter(app)
	quitter.Attach(app)

	// The sheet a Save/Open dialog attaches to is the window that actually asked — Current()
	// resolves the real key window on darwin ([NSApp keyWindow], application_darwin.go); the
	// registry fallback only matters where Current() can't resolve one (this sandbox's Linux
	// build, mid-startup before any window is focused) so a dialog call still has some live
	// window to attach to rather than none (F4's second half — the single `mainWindow` var this
	// replaces always attached to whichever window was created most recently, not the caller).
	attachDialogs(app, func() application.Window {
		if w := app.Window.Current(); w != nil {
			return w
		}
		return windows.Any()
	})

	shell.RegisterEngineStream(app, router)

	windowDeps := shell.WindowDeps{Windows: repositories.Windows, StartedAt: startedAt}

	// primaryWorkArea feeds shell.Options' first-launch size clamp (P22 D6(a)). Resolved once,
	// here, rather than per window: every window below is opened before app.Run() (this
	// function's own top comment), and shell.Options' own doc comment records why that means
	// GetPrimary() reliably answers nil today regardless of platform — a real, sandbox-verified
	// constraint of Wails' startup order, not a reason to skip the call, since the clamp still
	// falls back correctly and takes effect the moment a screen can be resolved.
	var primaryWorkArea *application.Rect
	if screen := app.Screen.GetPrimary(); screen != nil {
		primaryWorkArea = &screen.WorkArea
	}

	// openWindow opens one workbench from an already-persisted record and registers it — the one
	// path every window (startup, reopen, "New Window") ultimately goes through. Its own
	// WindowClosing listener implements D5: delete the row only if another window remains open,
	// so closing the last window leaves it behind for the next Dock click or relaunch to restore.
	openWindow := func(rec model.WindowRecord) {
		win := app.Window.NewWithOptions(shell.Options(shell.Harden(), rec, primaryWorkArea))
		detach := shell.Attach(win, windowDeps, rec.Key)
		windows.Add(rec.Key, win, detach)
		shell.AttachCloseFlush(win, rec.Key, events, closeFlush)
		win.OnWindowEvent(wailsevents.Common.WindowClosing, func(*application.WindowEvent) {
			// A window that closes mid-quit-handshake without ever acking through the flush
			// channel is removed from the pending set here rather than being waited out for the
			// full timeout (C8) — a no-op when no quit is in flight, since Quitter.Flushed
			// ignores a key it isn't currently waiting on.
			quitter.Flushed(rec.Key)
			if windows.RemoveAndCount(rec.Key) > 0 {
				if err := repositories.Windows.Delete(rec.Key); err != nil {
					slog.Warn("delete window row", "scope", "window", "key", rec.Key, "err", err)
				}
			}
		})
	}

	// openNewWindow is the *New Window* (⇧⌘N) menu command (D8): a fresh workbench, ordered after
	// every existing one, cascaded from whichever window is currently focused (D10).
	openNewWindow := func() {
		records, err := repositories.Windows.List()
		if err != nil {
			slog.Error("list windows", "scope", "window", "err", err)
			return
		}
		order := 0
		for _, r := range records {
			if r.Order >= order {
				order = r.Order + 1
			}
		}
		rec := model.WindowRecord{Key: uuid.NewString(), Order: order, Bounds: shell.CascadeFrom(app.Window.Current())}
		if err := repositories.Windows.Create(rec); err != nil {
			slog.Error("create window", "scope", "window", "err", err)
			return
		}
		openWindow(rec)
	}

	// reopenWindow is the Dock-reopen path (shell.AttachReopen only calls this when zero windows
	// are live): bring back the highest-order stored workbench, or mint a fresh "main" one if
	// every window row was somehow deleted (D5).
	reopenWindow := func() {
		records, err := repositories.Windows.List()
		if err != nil {
			slog.Error("list windows for reopen", "scope", "window", "err", err)
			return
		}
		if len(records) == 0 {
			rec := model.WindowRecord{Key: uuid.NewString(), Order: 0}
			if err := repositories.Windows.Create(rec); err != nil {
				slog.Error("create window for reopen", "scope", "window", "err", err)
				return
			}
			openWindow(rec)
			return
		}
		best := records[0]
		for _, r := range records[1:] {
			if r.Order > best.Order {
				best = r
			}
		}
		openWindow(best)
	}
	shell.AttachReopen(app, reopenWindow)

	isDev := app.Env.Info().Debug
	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Studio", IsDev: isDev, Events: events, Quit: quitter.RequestQuit, NewWindow: openNewWindow,
	}))

	// Startup: one window per stored record (C1's migration guarantees at least the "main" row on
	// a fresh database), in order — the first time this app has ever been able to open more than
	// one.
	records, err := repositories.Windows.List()
	if err != nil {
		log.Fatalf("kira-studio-shell: list windows: %v", err)
	}
	if len(records) == 0 {
		rec := model.WindowRecord{Key: uuid.NewString(), Order: 0}
		if err := repositories.Windows.Create(rec); err != nil {
			log.Fatalf("kira-studio-shell: create window: %v", err)
		}
		records = []model.WindowRecord{rec}
	}
	for _, rec := range records {
		openWindow(rec)
	}

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func assetHandler() http.Handler {
	if os.Getenv("KIRA_G1_BLANK") == "1" {
		sub, err := fs.Sub(blankAssets, "blank")
		if err != nil {
			log.Fatalf("kira-studio-shell: blank assets: %v", err)
		}
		return application.AssetFileServerFS(sub)
	}
	return application.AssetFileServerFS(assets)
}
