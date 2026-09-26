package main

import (
	"embed"
	"log/slog"
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
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appshell"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/dbmcp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/maskrules"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/preconnect"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
	"github.com/kirathecat/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/internal/metrics"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/startupfail"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Any files in frontend/dist are embedded into the binary — built by `bun run build` from
// the real apps/kira-studio/frontend/src (P52 §2.3), not by this scaffold's own removed demo frontend project.
//
//go:embed all:frontend/dist
var assets embed.FS

// main's startup order mirrors src/main/index.ts (P52 §4.1), with the upgradeLegacySecrets step
// deleted, not ported (P52 §6.4): config.EnsureLayout -> logging.Init/Sweep -> storage.Open
// (migrates) -> secrets.New -> repos.New + repos.NewSecrets -> Settings.GetAll ->
// adapterhost.NewRouter -> preconnect.New -> connections.New(...).Start -> tree.New ->
// router.PushCacheConfig -> oplog.New(...).Start -> metrics ticker Start -> shell.NewQuitter ->
// application.New(Services, ShouldQuit, OnShutdown) -> attach the deferred emitter and the
// Quitter to the now-real App -> menu -> engine stream -> reopen handler -> the main window ->
// app.Run() (P56 §4.11). There is no Node engine child to start any more (P58f M10 Phase 4).
func main() {
	// P100 Part 1: startupfail moved to repo-root internal/ and can no longer read
	// internal/config/internal/buildinfo itself (Go's internal/ rule — a repo-root package cannot
	// import anything under apps/kira-studio/internal), so this app constructs its own Reporter,
	// carrying its own Info, and threads it through every boot-failure site below instead of
	// startupfail holding a single process-wide default one.
	reporter := startupfail.NewReporter(startupfail.Deps{
		Info: startupfail.Info{
			AppName: "Kira Studio",
			Version: buildinfo.Version,
			Home:    config.KiraHome,
			LogsDir: config.LogsDir,
			DbPath:  config.DbPath,
		},
	})

	// P103 Part 3: repo-root internal/terminal's own two process-constant vars, set once before
	// any Registry.Open — a spawned shell's own TERM_PROGRAM/TERM_PROGRAM_VERSION env.
	terminal.TermProgram = "Kira Studio"
	terminal.TermProgramVersion = buildinfo.Version

	startedAt := time.Now()

	core := openCore(reporter)
	db, cipher, authorizer := core.db, core.cipher, core.authorizer
	repositories, secretsRepo, maskRulesSvc := core.repositories, core.secretsRepo, core.maskRulesSvc

	// P5 D8: the SAME authorizer instance connections.New below is given — that is what makes the
	// reveal grace genuinely shared between a connection-password reveal and a variable reveal.
	apiVarsSvc := apivars.New(repositories.Variables, cipher, authorizer)

	deps := appcore.Deps{
		DB:        db.DB,
		StartedAt: startedAt.UnixMilli(),
		Repos:     repositories,
		ApiVars:   apiVarsSvc,
		MaskRules: maskRulesSvc,
	}

	// Read from the just-migrated (possibly still-default) settings row, same as production would
	// before any user override exists — the cache budget below needs it.
	settings, err := deps.Repos.Settings.GetAll()
	if err != nil {
		reporter.Fatal(startupfail.StepSettings, err)
	}
	// P72 §9.2: match the stored advanced.gitLogLevel rather than always booting at Info.
	logging.SetLevel(settings.Advanced.GitLogLevel)

	adaptersW := wireAdapters(&deps, settings, repositories, secretsRepo, cipher, authorizer, db)
	router, connectionsSvc := adaptersW.router, adaptersW.connectionsSvc
	oplogWiring, metricsTicker := adaptersW.oplogWiring, adaptersW.metricsTicker

	// The two adapters below are needed inside the Services list, which is itself an argument to
	// application.New — but both need the *App that New alone produces (P56 §4.11's ordering
	// knot). Each is built "deferred": usable now, wired to the real App by attach() once New has
	// returned, well before Run() lets the renderer or any signal path actually call through it.
	emitter, attachEmitter := shell.NewDeferredEmitter()
	deps.Events = emitter
	rawDialogs, attachDialogs := shell.NewDeferredDialogs()
	dialogs := appshell.NewDialogs(rawDialogs)
	browserOpener, attachBrowser := shell.NewDeferredBrowser()

	// P66: the update-availability checker — no network call at all from a dev/test build
	// (appupdate's own isReleaseBuild guard); owns no goroutine, no ticker, no file handle, so
	// nothing is added to the quit teardown below.
	updateChecker := appupdate.NewChecker(appupdate.Studio.Name, buildinfo.Version)
	// P119: the detached installer. It owns a child process only while staging — teardown below
	// cancels it so a Cmd+Q mid-download aborts the install rather than orphaning a bundle swap.
	updateInstaller := appupdate.NewInstaller(appupdate.Studio, buildinfo.Version)

	embedded := wireEmbeddedServices(deps, connectionsSvc, oplogWiring, metricsTicker)
	dbMcpSvc := embedded.dbMcpSvc
	agentHooksSvc, keepAwakeSvc := embedded.agentHooksSvc, embedded.keepAwakeSvc
	windowsSvc, terminalSvc := embedded.windowsSvc, embedded.terminalSvc
	events, eventsDetach := embedded.events, embedded.eventsDetach

	lifecycle := wireLifecycle(events, eventsDetach, metricsTicker, oplogWiring, connectionsSvc,
		dbMcpSvc, agentHooksSvc, keepAwakeSvc, terminalSvc, updateInstaller, repositories, db)
	windows, closeFlush, quitter := lifecycle.windows, lifecycle.closeFlush, lifecycle.quitter

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
			application.NewService(windowsSvc),
			application.NewService(&bridge.ConnectionsService{Deps: deps}),
			application.NewService(&bridge.MaskRulesService{Deps: deps}),
			application.NewService(&bridge.TreeService{Deps: deps}),
			application.NewService(&bridge.EngineService{Deps: deps}),
			application.NewService(&bridge.OpsService{Deps: deps, Canceller: router}),
			application.NewService(&bridge.FiltersService{Deps: deps}),
			application.NewService(&bridge.FilesService{Dialogs: dialogs}),
			application.NewService(&bridge.QueriesService{Deps: deps}),
			application.NewService(&bridge.SchemaService{Deps: deps}),
			application.NewService(&bridge.HttpService{Deps: deps}),
			application.NewService(&bridge.GrpcService{Deps: deps}),
			application.NewService(&bridge.CollectionsService{Deps: deps}),
			application.NewService(&bridge.VariablesService{Deps: deps}),
			application.NewService(&bridge.ResponseHistoryService{Deps: deps}),
			application.NewService(&bridge.GrpcHistoryService{Deps: deps}),
			application.NewService(&bridge.DataGripService{Deps: deps}),
			application.NewService(dbMcpSvc),
			application.NewService(agentHooksSvc),
			application.NewService(keepAwakeSvc),
			application.NewService(terminalSvc),
			application.NewService(&bridge.CustomScriptsService{Deps: deps}),
			application.NewService(&bridge.UpdateService{
				Checker: updateChecker, Installer: updateInstaller, Quit: quitter.RequestQuit,
			}),
			application.NewService(&bridge.LinkService{Browser: browserOpener}),
			application.NewService(&bridge.LifecycleService{Flusher: quitter, WindowFlusher: closeFlush}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			// P56 D10: closing the last window leaves the app running, matching Electron's
			// default — AttachReopen below is what brings a window back.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		ShouldQuit:   quitter.ShouldQuit,
		OnShutdown:   quitter.Shutdown,
		ErrorHandler: buildErrorHandler(reporter),
	})

	attachEmitter(app)
	attachBrowser(app)
	quitter.Attach(app)

	wireWindowsAndMenu(postAppDeps{
		app: app, router: router, repositories: repositories,
		startedAt: startedAt, events: events, windows: windows, closeFlush: closeFlush, quitter: quitter,
		terminalSvc: terminalSvc, windowsSvc: windowsSvc, keepAwakeSvc: keepAwakeSvc,
		attachDialogs: attachDialogs,
		reporter:      reporter,
	})

	if err := app.Run(); err != nil {
		reporter.Fatal(startupfail.StepRun, err)
	}
}

// coreOpened is openCore's own result — the boot-order prefix of main's own comment: config layout,
// logging, DB, cipher, authorizer, repos.
type coreOpened struct {
	db           *storage.DB
	cipher       *secrets.Cipher
	authorizer   *localauth.Authorizer
	repositories *repos.Repos
	secretsRepo  *repos.SecretsRepo
	maskRulesSvc *maskrules.Service
}

// openCore runs main's own boot-order prefix: config.EnsureLayout -> logging.Init/Sweep ->
// storage.Open (migrates) -> secrets.New -> repos.New + repos.NewSecrets/NewVariables/NewMaskKeys
// -> maskrules.New. A failure at any reporter.Fatal step here exits the process; it never
// returns an error for the caller to handle.
func openCore(reporter *startupfail.Reporter) coreOpened {
	if err := config.EnsureLayout(); err != nil {
		reporter.Fatal(startupfail.StepEnsureLayout, err)
	}
	if err := logging.Init(config.LogsDir(), config.IsDev()); err != nil {
		reporter.Fatal(startupfail.StepLogging, err)
	}
	logging.Sweep(config.LogsDir())

	db, err := storage.Open()
	if err != nil {
		reporter.Fatal(startupfail.StepStorage, err)
	}

	cipher := secrets.New()
	// P14: constructed beside the cipher so its own startup log records OS-authentication
	// availability the same way cipher's Status does.
	authorizer := localauth.New(time.Now, localauth.Evaluate, localauth.Available)

	repositories, err := repos.New(db.DB)
	if err != nil {
		reporter.Fatal(startupfail.StepRepos, err)
	}
	secretsRepo := repos.NewSecrets(db.DB, cipher)
	// P5: the same "needs a Cipher, constructed separately from repos.New's aggregate" shape as
	// secretsRepo just above.
	repositories.Variables = repos.NewVariables(db.DB, cipher)
	// M5 §2.5/§3.2: the per-connection correlation key column, same "needs a Cipher" shape.
	maskKeysRepo := repos.NewMaskKeys(db.DB, cipher)
	maskRulesSvc := maskrules.New(repositories.MaskRules, maskKeysRepo)

	return coreOpened{
		db: db, cipher: cipher, authorizer: authorizer,
		repositories: repositories, secretsRepo: secretsRepo, maskRulesSvc: maskRulesSvc,
	}
}

// adaptersWired is wireAdapters' own result: the adapter router, the connections service, oplog's
// wiring and the metrics ticker — every piece main's own later blocks (events wiring, teardown,
// the Services list) still reach past this function's own return.
type adaptersWired struct {
	router         *adapterhost.Router
	connectionsSvc *connections.Service
	oplogWiring    *oplog.Wiring
	metricsTicker  *metrics.Ticker
}

// wireAdapters runs main's own adapter/cache/connections/tree/oplog/metrics block: the adapter
// router (backed by enginecache) -> preconnect supervisor -> connections service, started -> tree
// service -> the cache budget pushed to the router -> oplog, started -> the two per-launch history
// sweeps plus the freelist reclaim -> the process-metrics ticker, started. deps is mutated in place
// (Router/Connections/Tree) at the exact points the original sequential code set them, since
// several bridge.XxxService{Deps: deps} literals built later copy *deps by value.
func wireAdapters(deps *appcore.Deps, settings model.Settings, repositories *repos.Repos, secretsRepo *repos.SecretsRepo, cipher *secrets.Cipher, authorizer *localauth.Authorizer, db *storage.DB) adaptersWired {
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
		MaskRules: repositories.MaskRules,
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

	// P8 D7/F18: a scratch tab's response history is swept once per launch, beside oplog's own
	// startup prune — tabs is the liveness oracle (TabsRepo.Save always re-inserts every tab
	// that's currently open), so this removes only a closed tab's history, never a live one's.
	if err := repositories.ResponseHistory.SweepOrphans(); err != nil {
		slog.Warn("sweep orphaned response history", "scope", "startup", "err", err)
	}
	// P11 D11: the same startup prune, for a scratch tab's gRPC call history.
	if err := repositories.GrpcHistory.SweepOrphans(); err != nil {
		slog.Warn("sweep orphaned grpc call history", "scope", "startup", "err", err)
	}
	// P23 D5(b): return freed pages to the filesystem once the freelist is worth reclaiming — a
	// no-op on a database opened before this phase (auto_vacuum stays NONE, D5(a) never converts
	// an existing file) and on one whose freelist is still small.
	if err := (&repos.Maintenance{DB: db.DB}).Reclaim(); err != nil {
		slog.Warn("reclaim freed pages", "scope", "startup", "err", err)
	}

	metricsTicker := metrics.NewAppTicker("Kira Studio")
	metricsTicker.Start()

	return adaptersWired{
		router: router, connectionsSvc: connectionsSvc, oplogWiring: oplogWiring, metricsTicker: metricsTicker,
	}
}

// embeddedWired is wireEmbeddedServices' own result — every embedded-service handle main's later
// blocks (the Services list, teardown, the window-closing terminal cleanup) still reach past this
// function's own return.
type embeddedWired struct {
	dbMcpSvc      *bridge.DbMcpService
	agentHooksSvc *bridge.AgentHooksService
	keepAwakeSvc  *bridge.KeepAwakeService
	windowsSvc    *bridge.WindowsService
	terminalSvc   *bridge.TerminalService
	events        *bridge.Events
	eventsDetach  func()
}

// wireEmbeddedServices runs main's own embedded-service block: DB MCP (with its own approval
// broker) -> code workspace (native code-viewing) -> Claude Code hook reporting -> keep-awake ->
// the windows service handle -> the embedded terminal (its own OnChange republishing both the
// status-bar widget and keep-awake's agent-session count) -> the app-wide event bus, attached to
// every producer built so far. deps is taken by value, since every call site here is at or after
// the point main's own deps.Events assignment (the emitter) has already run — each
// bridge.XxxService{Deps: deps} literal below is exactly the same value copy the original
// sequential code made in place.
func wireEmbeddedServices(deps appcore.Deps, connectionsSvc *connections.Service, oplogWiring *oplog.Wiring, metricsTicker *metrics.Ticker) embeddedWired {
	// M1 §3.3: the DB MCP server's embedded instance — owned by this app's own lifecycle.
	// StartIfEnabled's own failure (a bind conflict) is logged, never fatal.
	// M2 §5.1/§5.3: the approval broker outlives the server's own start/stop (constructed here, not
	// inside DbMcpService.startLocked), so the event subscription wired below stays valid across a
	// restart of the embedded server within one app run.
	dbMcpApprovals := dbmcp.NewApprovalBroker(time.Now)
	dbMcpSvc := bridge.NewDbMcpService(deps, mcpinstall.New(mcpinstall.Deps{}), dbMcpApprovals)
	bridge.StartDbMcpIfEnabled(dbMcpSvc)

	// P86 §7/§9: the Claude Code hook-reporting toggle's own embedded instance — same posture as
	// dbMcpSvc just above (constructed before the terminal registry it feeds, started here if the
	// leaf is already on).
	agentHooksSvc := bridge.NewAgentHooksService(deps)
	bridge.StartAgentHooksIfEnabled(agentHooksSvc)

	// P87 §3/§4: one keep-awake assertion for the whole app, composed from the titlebar toggle and
	// the agent-aware setting (§1). The driver is a runtime.GOOS switch — a real caffeinate child
	// on macOS, a documented no-op everywhere else. Constructed before terminalSvc below, since its
	// Registry.OnChange closure closes over it.
	keepAwakeCtl := keepawake.New(keepawake.NewPlatformDriver())
	keepAwakeSvc := &bridge.KeepAwakeService{Deps: deps, Ctl: keepAwakeCtl, Toggle: &keepawake.Toggle{Ctl: keepAwakeCtl}}
	bridge.StartKeepAwake(keepAwakeSvc)

	// P92 item 3: hoisted so openNewWindow (defined below, once `app` exists) can be assigned onto
	// it — the title bar's "New window" button reaches this same OpenNewWindow closure the ⇧⌘N
	// menu command already uses.
	windowsSvc := &bridge.WindowsService{Deps: deps}

	// P83 §3.2/§4: the embedded terminal's own bound service — a PTY registry behind a Wails
	// service plus ChannelTerminal's push channel, deliberately not on the git contract (§3.1).
	// P86 §8.3: AgentHooks lets a claude-code launch's Open compose the `--settings` flag and env.
	terminalSvc := &bridge.TerminalService{Emit: deps.Events, Registry: terminal.NewRegistry(), AgentHooks: agentHooksSvc}
	// P86 §11: the status-bar widget's own app-wide authority — every window's live session list,
	// republished whenever a Claude Code session's own liveness changes anywhere.
	terminalSvc.Registry.OnChange = func() {
		bridge.TerminalAgentSessionsChanged(terminalSvc)
		// P87 §1.1: the agent reason's other input. AgentSessions() is safe to call from here —
		// session.go documents OnChange as fired outside the registry mutex for exactly this reason.
		bridge.KeepAwakeAgentSessionsChanged(keepAwakeSvc, len(terminalSvc.Registry.AgentSessions()))
	}

	events := bridge.NewEvents(deps.Events)
	eventsDetach := events.Attach(bridge.Sources{Connections: connectionsSvc, Oplog: oplogWiring, Metrics: metricsTicker, DbMcp: dbMcpApprovals})

	return embeddedWired{
		dbMcpSvc: dbMcpSvc, agentHooksSvc: agentHooksSvc, keepAwakeSvc: keepAwakeSvc,
		windowsSvc: windowsSvc, terminalSvc: terminalSvc,
		events: events, eventsDetach: eventsDetach,
	}
}

// lifecycleWired is wireLifecycle's own result: the window registry, the close-flush coordinator
// and the quitter main's later blocks (openWindow, BuildMenu, app's own ShouldQuit/OnShutdown)
// still reach past this function's own return.
type lifecycleWired struct {
	windows    *shell.WindowRegistry
	closeFlush *shell.CloseFlushCoordinator
	quitter    *shell.Quitter
}

// wireLifecycle runs main's own pre-app window-lifecycle block: the window registry -> the
// close-flush coordinator -> beforeFlush/teardown (today's OnShutdown, minus the ticker Stop,
// which moves to beforeFlush, run before the flush wait rather than after it — P56 D3/index.ts:156)
// -> the quitter built over both.
func wireLifecycle(events *bridge.Events, eventsDetach func(), metricsTicker *metrics.Ticker, oplogWiring *oplog.Wiring, connectionsSvc *connections.Service, dbMcpSvc *bridge.DbMcpService, agentHooksSvc *bridge.AgentHooksService, keepAwakeSvc *bridge.KeepAwakeService, terminalSvc *bridge.TerminalService, updateInstaller *appupdate.Installer, repositories *repos.Repos, db *storage.DB) lifecycleWired {
	// windows holds every currently open window's shell.Attach cleanup, keyed by that window's own
	// identity (P8 C2, replacing the single detachWindow/mainWindow pair that only ever worked
	// because at most one window could exist at a time — F4). beforeFlush detaches every one of
	// them, not just the most recently created (P2 R1's finding, generalised past one window).
	windows := shell.NewWindowRegistry()

	// closeFlush routes each window's own "flush before close" ack back to whichever
	// shell.AttachCloseFlush hook is waiting for it (P8 C6, F8's fix) — a separate handshake from
	// the quit one below: at most one window is ever waiting at a time.
	closeFlush := shell.NewCloseFlushCoordinator(events)

	// teardown is today's OnShutdown, minus the ticker Stop (which moves to beforeFlush, run
	// before the flush wait rather than after it — P56 D3/index.ts:156).
	beforeFlush := sync.OnceFunc(func() {
		metricsTicker.Stop()
		windows.DetachAll()
	})
	teardown := sync.OnceFunc(func() {
		// P119: a Cmd+Q mid-download aborts the install rather than leaving an orphan that later
		// swaps a bundle the user quit away from. After hand-off this is a no-op.
		updateInstaller.Cancel()
		eventsDetach()
		oplogWiring.Stop()
		// F13 (P108 Part 7): DB MCP and agenthooks stop before connectionsSvc.Shutdown(), not
		// after — each stop blocks until its own in-flight handlers return (DbMcpService's stopFn
		// abandons parked approvals then waits out closeHTTP's graceful drain), so no run_query (or
		// hook) can still be mid-flight, dialing a preconnect target on demand, once Shutdown below
		// starts tearing preconnect down.
		bridge.StopDbMcp(dbMcpSvc)
		bridge.StopAgentHooks(agentHooksSvc)
		connectionsSvc.Shutdown()
		// P87 §4: killing the assertion early keeps the window between "app is quitting" and
		// "caffeinate is dead" as short as possible — order otherwise isn't load-bearing here, the
		// controller's release is independent of the PTY registry terminalSvc.Shutdown() stops.
		bridge.StopKeepAwake(keepAwakeSvc)
		terminalSvc.Shutdown()
		if err := repositories.Close(); err != nil {
			slog.Warn("close repos", "scope", "shutdown", "err", err)
		}
		if err := db.Close(); err != nil {
			slog.Warn("close db", "scope", "shutdown", "err", err)
		}
	})
	quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second, windows.Keys)

	return lifecycleWired{
		windows: windows, closeFlush: closeFlush, quitter: quitter,
	}
}

// postAppDeps is wireWindowsAndMenu's own argument bundle — every piece main built before `app`
// existed that this block still needs, gathered into one struct since the block itself (dialog
// attach, the three window closures, the menu, the startup window list) is one continuous unit
// that only makes sense once `app` is real.
type postAppDeps struct {
	app          *application.App
	router       *adapterhost.Router
	repositories *repos.Repos
	startedAt    time.Time
	events       *bridge.Events
	windows      *shell.WindowRegistry
	closeFlush   *shell.CloseFlushCoordinator
	quitter      *shell.Quitter
	terminalSvc  *bridge.TerminalService
	windowsSvc   *bridge.WindowsService
	keepAwakeSvc *bridge.KeepAwakeService

	attachDialogs func(app *application.App, window func() application.Window)
	reporter      *startupfail.Reporter
}

// wireWindowsAndMenu runs main's own post-`app` block: the dialog attach point -> the engine
// stream -> the three window closures (open/openNew/reopen) -> the reopen/system-wake handlers ->
// the menu -> the startup window list, opened. Nothing here is needed past main's own app.Run()
// call, so this returns nothing.
func wireWindowsAndMenu(d postAppDeps) {
	app := d.app

	// The sheet a Save/Open dialog attaches to is the window that actually asked — Current()
	// resolves the real key window on darwin ([NSApp keyWindow], application_darwin.go); the
	// registry fallback only matters where Current() can't resolve one (this sandbox's Linux
	// build, mid-startup before any window is focused) so a dialog call still has some live
	// window to attach to rather than none (F4's second half — the single `mainWindow` var this
	// replaces always attached to whichever window was created most recently, not the caller).
	windowToActOn := func() application.Window {
		if w := app.Window.Current(); w != nil {
			return w
		}
		return d.windows.Any()
	}
	d.attachDialogs(app, windowToActOn)

	appshell.RegisterEngineStream(app, d.router)

	deps := shell.WindowOpenerDeps{
		App:        app,
		WindowDeps: shell.WindowDeps{Windows: windowStore{d.repositories.Windows}, StartedAt: d.startedAt},
		Windows:    d.windows, CloseFlush: d.closeFlush, Quitter: d.quitter,
		Terminal: d.terminalSvc.Registry, Repo: windowStore{d.repositories.Windows},
		Cfg: shell.Config{AppName: "Kira Studio", WindowTitle: "Kira Studio"},
	}
	openNew := func() { shell.OpenNewWindow(deps) }
	d.windowsSvc.OpenNewWindow = openNew
	shell.AttachReopen(app, func() { shell.ReopenWindows(deps) })
	// P87 §5: a machine resume's own trigger — Rearm() while held, a no-op while idle.
	shell.AttachSystemWake(app, func() { bridge.KeepAwakeSystemDidWake(d.keepAwakeSvc) })

	isDev := app.Env.Info().Debug
	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Studio", IsDev: isDev, Template: appshell.BuildTemplate("Kira Studio", isDev),
		OnEmit: d.events.Signal, Quit: d.quitter.RequestQuit, NewWindow: openNew,
	}))

	// Startup: one window per stored record (C1's migration guarantees at least the "main" row on
	// a fresh database), in order — the first time this app has ever been able to open more than
	// one.
	records, err := d.repositories.Windows.List()
	if err != nil {
		d.reporter.Fatal(startupfail.StepWindowList, err)
	}
	if len(records) == 0 {
		rec := model.WindowRecord{Key: uuid.NewString(), Order: 0}
		if err := d.repositories.Windows.Create(rec); err != nil {
			d.reporter.Fatal(startupfail.StepWindowCreate, err)
		}
		records = []model.WindowRecord{rec}
	}
	for _, rec := range records {
		var bounds *shell.WindowBounds
		if rec.Bounds != nil {
			b := *rec.Bounds
			bounds = &b
		}
		shell.OpenWindow(deps, shell.ToWindowRecord(rec.Key, rec.Order, bounds))
	}
}

// buildErrorHandler builds main's own application.Options.ErrorHandler (G29 D7/F6): catches the two
// pre-window fatal paths Wails takes itself, without ever returning to main -- application.New's
// own transport-start failure, and webview_window_darwin.go's GetStartURL failure during
// first-window creation, inside Run(). handleError (application.go) prefers ErrorHandler over its
// own logger and calls it synchronously, before Wails' own os.Exit(1) -- so ReportPlatform's alert
// has already run and completed by the time that exit happens, and the returned func must never
// exit itself. A non-fatal handleError call (e.g. RegisterService after Run) passes a plain error
// here, not a *FatalError -- logged by Wails itself already, not alerted a second time. This is the
// one place startupfail needs a pkg/application type; the assertion stays here, in the file that
// already legitimately imports pkg/application (internal/shell/app.go's own documented rule), so
// internal/startupfail imports nothing from pkg/application at all.
func buildErrorHandler(reporter *startupfail.Reporter) func(error) {
	return func(err error) {
		fatalErr, ok := err.(*application.FatalError)
		if !ok {
			return
		}
		platformErrorOnce.Do(func() {
			reporter.ReportPlatform(fatalErr.Unwrap())
		})
	}
}

// windowStore adapts *repos.WindowsRepo to shell.WindowRepo (P103 Part 3 §6.3 / P107 I2-3). Kira
// Studio's own model.WindowRecord alone still carries Mode (P22 D12), so it stays its own type
// rather than a plain alias of shell.WindowRecord/appstorage.WindowRecord — this adapter is what
// that costs. Kira Space's identical-minus-Mode WindowRecord is a true alias now (P107 I2-3), so
// its own main.go passes *repos.WindowsRepo straight through, no adapter needed. WindowBounds is a
// plain alias on both sides already, so no per-field conversion remains here either.
type windowStore struct{ repo *repos.WindowsRepo }

func (w windowStore) SetBounds(key string, b shell.WindowBounds) error {
	return w.repo.SetBounds(key, b)
}

func (w windowStore) List() ([]shell.WindowRecord, error) {
	records, err := w.repo.List()
	if err != nil {
		return nil, err
	}
	out := make([]shell.WindowRecord, len(records))
	for i, r := range records {
		out[i] = shell.ToWindowRecord(r.Key, r.Order, r.Bounds)
	}
	return out, nil
}

func (w windowStore) Create(rec shell.WindowRecord) error {
	return w.repo.Create(model.WindowRecord{Key: rec.Key, Order: rec.Order, Bounds: rec.Bounds})
}

func (w windowStore) Delete(key string) error {
	return w.repo.Delete(key)
}

// platformErrorOnce bounds G29 D7's ErrorHandler to at most one alert per process, independent of
// internal/startupfail's own per-Reporter alertOnce bound -- both exist because this handler could,
// in principle, be reached more than once before the process actually exits.
var platformErrorOnce sync.Once
