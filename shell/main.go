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

	"github.com/kirathecat/kira-studio/shell/internal/adapterhost"
	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/mariadb"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/mysql"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/clickhouse"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/mongo"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/postgres"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/redis"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/s3"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/sqlite"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/sqs"
	_ "github.com/kirathecat/kira-studio/shell/internal/adapters/kafka"
	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/config"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginecache"
	"github.com/kirathecat/kira-studio/shell/internal/logging"
	"github.com/kirathecat/kira-studio/shell/internal/metrics"
	"github.com/kirathecat/kira-studio/shell/internal/oplog"
	"github.com/kirathecat/kira-studio/shell/internal/preconnect"
	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/shell"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/kirathecat/kira-studio/shell/internal/tree"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Any files in frontend/dist are embedded into the binary — built by `bun run build:wails` from
// the real src/renderer (P52 §2.3), not by this scaffold's own removed demo frontend project.
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
		Cipher: cipher, Backend: router, Preconnect: preconnectSupervisor,
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

	metricsTicker := metrics.NewTicker(
		func() ([]int32, error) { return metrics.AppProcessSet(metrics.AnchorNeedles, metrics.HelperNeedles) },
		metrics.Interval,
	)
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

	// teardown is today's OnShutdown, minus the ticker Stop (which moves to beforeFlush, run
	// before the flush wait rather than after it — P56 D3/index.ts:156).
	beforeFlush := sync.OnceFunc(func() { metricsTicker.Stop() })
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
	quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second)

	app := application.New(application.Options{
		Name:        "Kira Studio",
		Description: "A visual database client for macOS",
		Services: []application.Service{
			application.NewService(&bridge.AppService{Deps: deps}),
			application.NewService(&bridge.SettingsService{Deps: deps}),
			application.NewService(&bridge.LayoutService{Deps: deps}),
			application.NewService(&bridge.TabsService{Deps: deps}),
			application.NewService(&bridge.ConnectionsService{Deps: deps}),
			application.NewService(&bridge.TreeService{Deps: deps}),
			application.NewService(&bridge.EngineService{Deps: deps}),
			application.NewService(&bridge.OpsService{Deps: deps, Canceller: router}),
			application.NewService(&bridge.FiltersService{Deps: deps}),
			application.NewService(&bridge.FilesService{Dialogs: dialogs}),
			application.NewService(&bridge.QueriesService{Deps: deps}),
			application.NewService(&bridge.LifecycleService{Flusher: quitter}),
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

	var mainWindow *application.WebviewWindow
	attachDialogs(app, func() application.Window { return mainWindow })

	isDev := app.Env.Info().Debug
	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Studio", IsDev: isDev, Events: events, Quit: quitter.RequestQuit,
	}))

	shell.RegisterEngineStream(app, router)

	windowDeps := shell.WindowDeps{Layout: repositories.Layout, StartedAt: startedAt}
	newWindow := func() {
		win := app.Window.NewWithOptions(shell.Options(windowDeps, shell.Harden(), "/"))
		mainWindow = win
		shell.Attach(win, windowDeps)
	}
	shell.AttachReopen(app, newWindow)

	newWindow()

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
