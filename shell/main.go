package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/appcore"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/config"
	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
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
// call, measuring the floor cost of Wails + the webview + Go + the vendored Node child with no
// app in it. Selected via KIRA_G1_BLANK=1, never in normal operation.
//
//go:embed blank/index.html
var blankAssets embed.FS

// main's startup order mirrors src/main/index.ts (P52 §4.1), with the upgradeLegacySecrets step
// deleted, not ported (P52 §6.4): config.EnsureLayout -> logging.Init/Sweep -> storage.Open
// (migrates) -> secrets.New -> repos.New + repos.NewSecrets -> Settings.GetAll ->
// resolveEngine (P56 D12: the real bundled engine) -> enginehost.Start -> preconnect.New ->
// connections.New(...).Start -> tree.New -> enginehost.PushCacheConfig -> oplog.New(...).Start ->
// metrics ticker Start -> shell.NewQuitter -> application.New(Services, ShouldQuit, OnShutdown)
// -> attach the deferred emitter and the Quitter to the now-real App -> menu -> engine stream ->
// reopen handler -> the main window -> app.Run() (P56 §4.11).
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

	// The engine memory cap mirrors today's advanced.engineMemoryCapMb setting (P51 §3.6); this
	// reads it from the just-migrated (possibly still-default) settings row, same as production
	// would before any user override exists.
	settings, err := deps.Repos.Settings.GetAll()
	if err != nil {
		log.Fatalf("kira-studio-shell: read settings: %v", err)
	}

	nodeBin, engineScript, err := resolveEngine()
	if err != nil {
		log.Fatalf("kira-studio-shell: resolve engine: %v", err)
	}
	host, err := enginehost.Start(nodeBin, engineScript,
		fmt.Sprintf("--max-old-space-size=%d", settings.Advanced.EngineMemoryCapMb),
	)
	if err != nil {
		log.Fatalf("kira-studio-shell: start engine: %v", err)
	}
	deps.EngineHost = host
	deps.NodeVersion = nodeVersion(nodeBin)

	preconnectSupervisor := preconnect.New()
	connectionsSvc := connections.New(connections.Deps{
		Conns: repositories.Connections, Secrets: secretsRepo, Metadata: repositories.Metadata,
		Cipher: cipher, Host: host, Preconnect: preconnectSupervisor,
	})
	connectionsSvc.Start()
	deps.Connections = connectionsSvc

	treeSvc := tree.New(repositories.Connections, repositories.Metadata, host, connectionsSvc)
	deps.Tree = treeSvc

	enginehost.PushCacheConfig(host, settings)

	oplogWiring := oplog.New(host, repositories.Ops, settings.Advanced.OpLogRetentionDays)
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
		host.Stop()
		if err := repositories.Close(); err != nil {
			slog.Warn("close repos", "scope", "shutdown", "err", err)
		}
		if err := db.Close(); err != nil {
			slog.Warn("close db", "scope", "shutdown", "err", err)
		}
	})
	quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second)

	app := application.New(application.Options{
		Name:        "Kira Studio Shell",
		Description: "A visual database client for macOS (Wails/Go spike shell)",
		Services: []application.Service{
			application.NewService(&bridge.AppService{Deps: deps}),
			application.NewService(&bridge.SettingsService{Deps: deps}),
			application.NewService(&bridge.LayoutService{Deps: deps}),
			application.NewService(&bridge.TabsService{Deps: deps}),
			application.NewService(&bridge.ConnectionsService{Deps: deps}),
			application.NewService(&bridge.TreeService{Deps: deps}),
			application.NewService(&bridge.EngineService{Deps: deps}),
			application.NewService(&bridge.OpsService{Deps: deps}),
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

	shell.RegisterEngineStream(app, host)

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

// resolveEngine locates the vendored Node runtime and the real bundled engine (P56 D12: the
// switch from M1's engine-ping.mjs walking-skeleton fixture to shell/runtime/engine/engine.cjs,
// built by `bun run build:engine` and already verified end-to-end by P54's
// stdio_main_integration_test.go). P52 §3.1 vendors the Node runtime to shell/runtime/node/
// (git-ignored, fetched by scripts/vendor-node.sh); this checks next to the running executable
// first (the packaged shape) and falls back to the source tree (the `wails3 task dev` / `go run`
// shape).
func resolveEngine() (nodeBin, script string, err error) {
	scriptCandidates := []string{
		"runtime/engine/engine.cjs",
	}
	nodeCandidates := []string{
		"runtime/node/bin/node",
	}
	if exe, exeErr := os.Executable(); exeErr == nil {
		exeDir := filepath.Dir(exe)
		nodeCandidates = append([]string{filepath.Join(exeDir, "runtime", "node", "bin", "node")}, nodeCandidates...)
		scriptCandidates = append([]string{filepath.Join(exeDir, "runtime", "engine", "engine.cjs")}, scriptCandidates...)
	}

	nodeBin, err = firstExisting(nodeCandidates)
	if err != nil {
		return "", "", fmt.Errorf(
			"vendored node runtime not found (looked in %v) — run scripts/vendor-node.sh first", nodeCandidates,
		)
	}
	script, err = firstExisting(scriptCandidates)
	if err != nil {
		return "", "", fmt.Errorf(`engine.cjs not found (looked in %v) — run "bun run build:engine" first`, scriptCandidates)
	}
	return nodeBin, script, nil
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

func firstExisting(candidates []string) (string, error) {
	for _, c := range candidates {
		if fi, err := os.Stat(c); err == nil && !fi.IsDir() {
			return c, nil
		}
	}
	return "", os.ErrNotExist
}

func nodeVersion(nodeBin string) string {
	out, err := exec.Command(nodeBin, "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}
