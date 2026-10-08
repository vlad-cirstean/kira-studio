package main

import (
	"context"
	"embed"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeflow"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appshell"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitcred"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitvsix"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileterm"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileweb"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	memembed "github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/memorycli"
	memstt "github.com/kirathecat/kira-studio/internal/memory/stt"
	"github.com/kirathecat/kira-studio/internal/metrics"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/startupfail"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/windowsvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Any files in frontend/dist are embedded into the binary — empty until Part 2's own frontend
// build lands; frontend/dist/index.html is a placeholder so this compiles (P100 Part 1).
//
//go:embed all:frontend/dist
var assets embed.FS

//go:embed all:frontend/dist-mobile
var mobileAssets embed.FS

// runArgvShim runs the askpass, memory-mcp, memory-embed and memory-stt subcommands, before
// anything Wails-related, so they
// never start a window. memory-mcp is Claude Code's stdio MCP server; it runs before startupfail
// and the single-instance lock, so it works while the window is open. memory-embed is the ONNX
// embedding worker those processes and the app spawn; same ordering for the same reason.
// memory-stt is the whisper.cpp dictation worker the app spawns.
func runArgvShim(args []string) (code int, ok bool) {
	if len(args) < 2 {
		return 0, false
	}
	switch args[1] {
	case "askpass":
		return gitaskpass.RunHelper(args[2:], os.Environ(), os.Stdout), true
	case "memory-mcp":
		return memorycli.Run(args[2:]), true
	case "memory-embed":
		return memembed.RunWorker(args[2:]), true
	case "memory-stt":
		return memstt.RunWorker(args[2:]), true
	}
	return 0, false
}

// Startup order: the argv shims (askpass, memory-mcp, memory-embed) -> config.EnsureLayout -> logging.Init/Sweep ->
// storage.Open (migrates) -> repos.New -> wireGit (starts gitsock.Server) -> terminal registry and
// the ADE tracker (wireTracker, with the Claude Code hooks) -> wireAdeTask -> keep-awake ->
// application.New (18 bound services plus the git stream registration) -> the menu -> the startup
// window list, opened -> app.Run(). No adapters, connections, HTTP/gRPC or DB MCP: not this app's
// module. gitClientsSvc.AttachPush() wires gitsock's pairing/clients-changed feeds onto the two
// push channels the pairing prompt and Connected-editors pane read.
func main() {
	if code, ok := runArgvShim(os.Args); ok {
		os.Exit(code)
	}

	reporter := startupfail.NewReporter(startupfail.Deps{
		Info: startupfail.Info{
			AppName: "Kira Space",
			Version: buildinfo.Version,
			Home:    config.KiraSpaceHome,
			LogsDir: config.LogsDir,
			DbPath:  config.DbPath,
		},
	})

	// P103 Part 3: repo-root internal/terminal's own two process-constant vars, set once before
	// any Registry.Open.
	terminal.TermProgram = "Kira Space"
	terminal.TermProgramVersion = buildinfo.Version

	startedAt := time.Now()

	if err := config.EnsureLayout(); err != nil {
		reporter.Fatal(startupfail.StepEnsureLayout, err)
	}
	if err := logging.Init(config.LogsDir(), config.IsDev()); err != nil {
		reporter.Fatal(startupfail.StepLogging, err)
	}
	logging.Sweep(config.LogsDir())

	instanceLock := acquireSingleInstance(reporter)
	_ = instanceLock // kept open for the process's lifetime (AcquireLock's own doc); closing it releases the lock.

	db, err := storage.Open()
	if err != nil {
		reporter.Fatal(startupfail.StepStorage, err)
	}
	repositories, err := repos.New(db.DB)
	if err != nil {
		reporter.Fatal(startupfail.StepRepos, err)
	}

	settings, err := repositories.Settings.GetAll()
	if err != nil {
		reporter.Fatal(startupfail.StepSettings, err)
	}
	logging.SetLevel(settings.Advanced.GitLogLevel)

	credentialRelay := gitcred.New()
	git := wireGit(repositories, credentialRelay)
	gitDiscovery, gitRunner, gitRegistry := git.discovery, git.runner, git.registry
	askpassBroker, gitRouter, gitSock := git.askpassBroker, git.router, git.sock

	rawEmitter, attachEmitter := shell.NewDeferredEmitter()
	// The tap feeds every window-wide event to the phone event hub, which drops what is not allowlisted.
	mobileHub := mobileweb.NewHub()
	emitter := appevent.NewTap(rawEmitter, mobileHub.Publish)
	deps := appcore.Deps{Repos: repositories, Events: emitter, GitRegistry: gitRegistry}
	events := bridge.NewEvents(emitter)
	detachOpLog := events.AttachOpLog(git.opLog)

	browserOpener, attachBrowser := shell.NewDeferredBrowser()
	rawDialogs, attachDialogs := shell.NewDeferredDialogs()
	dialogsSvc := appshell.NewDialogs(rawDialogs)

	// P119: the update-availability checker and its detached installer — Kira Studio's own pair
	// (main.go), same appupdate package, this app's own App constant.
	updateChecker := appupdate.NewChecker(appupdate.Space.Name, buildinfo.Version)
	updateInstaller := appupdate.NewInstaller(appupdate.Space, buildinfo.Version)

	codeWorkspaceSvc := &bridge.CodeWorkspaceService{
		Deps: deps, Discovery: gitDiscovery, Runner: gitRunner, Registry: codeworkspace.NewRegistry(),
		OnReposChanged: func() { bridge.AdeTaskReposChanged(events) },
	}
	gitClientsSvc := &bridge.GitClientsService{
		Deps: deps, Sock: gitSock, Broker: gitSock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{}),
	}
	detachGitPush := gitClientsSvc.AttachPush()
	gitCredentialSvc := &bridge.GitCredentialService{Deps: deps, Relay: credentialRelay}
	detachGitCredentialPush := gitCredentialSvc.AttachPush()
	gitHubSvc := &bridge.GitHubService{Deps: deps, Browser: browserOpener}
	linkSvc := &bridge.LinkService{Browser: browserOpener}
	settingsSvc := &bridge.SettingsService{Deps: deps}
	layoutSvc := &bridge.LayoutService{Deps: deps}
	tabsSvc := &bridge.TabsService{Deps: deps}
	// terminalRegistry is shared by terminalSvc and adeTracker below (P129 Part 1 §4.3) — one
	// Registry, since Tracker.Reconcile/Send both need the same live-session set and PTYs the
	// terminal service itself opens.
	terminalRegistry := terminal.NewRegistry()
	adeTracker, agentHooks := wireTracker(repositories, terminalRegistry, emitter, events)

	// P128 §2.1: the bound terminal methods live once in internal/terminal.BoundService; this
	// app's own TerminalService only embeds it (own binding-name FQN, no behaviour of its own).
	// ComposeAgent (P129 Part 1 §4.1) rewrites every claude-code launch through adeTracker.Compose.
	termBroker := wireTermBroker(adeTracker, terminalRegistry, emitter)
	terminalSvc := &bridge.TerminalService{BoundService: &terminal.BoundService{
		Emit: emitter, Registry: terminalRegistry, ComposeAgent: adeTracker.Compose, AbortAgent: adeTracker.Abort,
		Arbiter: termBroker,
	}}
	// keepAwakeCtl/keepAwakeSvc: the title bar's keep-awake toggle (P116 G5, internal/keepawake.Toggle)
	// plus P188's agent reason, the live Claude Code session count — terminal agent tabs and running
	// headless ade sessions — applied against claudeCode.keepAwakeWithAgents.
	keepAwakeCtl := keepawake.New(keepawake.NewPlatformDriver())
	keepAwakeSvc := &bridge.KeepAwakeService{
		Emit: emitter, Toggle: &keepawake.Toggle{Ctl: keepAwakeCtl},
		AgentCount: agentSessionCount(repositories, terminalRegistry),
		Settings:   repositories.Settings.GetAll,
	}
	settingsSvc.OnChanged = func(model.Settings) { bridge.KeepAwakeRecompute(keepAwakeSvc) }
	// memory.db opens on the Memory module's first call.
	memorySvc := bridge.NewMemoryService(emitter, mcpinstall.New(mcpinstall.Deps{}))

	// windows holds every open window; created here so Archive can close a task's review windows.
	windows := shell.NewWindowRegistry()
	adeTaskBoard := wireAdeTask(repositories, events, git, adeTracker, adeCloseTerminal(terminalRegistry),
		closeTaskReviewWindows(repositories, windows), credentialRelay, keepAwakeSvc)
	adeTaskSvc := &bridge.AdeTaskService{Engine: adeTaskBoard, Registry: terminalRegistry, Emit: emitter}
	// Registry.OnChange fires after every agent session registers or is removed (spawn and exit) —
	// Reconcile picks up both, and AgentSessionsChanged refreshes the P127 store's own live count
	// (P129 Part 1 §4.2 step 4).
	terminalRegistry.OnChange = func() {
		adeTracker.Reconcile()
		bridge.AgentSessionsChanged(emitter, terminalRegistry)
		bridge.KeepAwakeRecompute(keepAwakeSvc)
	}
	bridge.KeepAwakeRecompute(keepAwakeSvc)

	// windowsSvc is P116 G6's own addition — OpenNewWindow is assigned once `openNew` exists,
	// below, the same two-step Kira Studio's own main.go uses (that closure needs `app`). P128
	// §2.2: the bound methods live once in windowsvc.Service; this app's own WindowsService only
	// embeds it, gaining Ensure/SetMode here for the first time (the module registry's own
	// per-window persisted mode).
	windowsSvc := &bridge.WindowsService{Service: &windowsvc.Service{Windows: deps.Repos.Windows}}

	// metricsTicker is P116 G7's own addition — the status bar's CPU/memory readout, Kira Studio's
	// own metrics.NewAppTicker wired to this app's own executable name.
	metricsTicker := metrics.NewAppTicker("Kira Space")
	metricsTicker.Start()
	detachMetrics := events.AttachMetrics(metricsTicker)

	// windows/closeFlush are P100 Part 2's own addition — Part 1 had no per-window flush to
	// coordinate (no tabs, no layout); the quit-wide handshake below needs windows.Keys, and each
	// window's own close needs closeFlush's ack routing (shell/closeflush.go).
	// FocusSession needs windows, which doesn't exist yet when adeTaskSvc is constructed above (the
	// same two-step windowsSvc.OpenNewWindow uses).
	adeTaskSvc.FocusWindow = windows.Focus
	closeFlush := shell.NewCloseFlushCoordinator(events)

	mobileAssetsFS, err := fs.Sub(mobileAssets, "frontend/dist-mobile")
	if err != nil {
		panic(err) // constant embed path: only a build-time mistake fails here
	}
	mobileLaunches := &bridge.MobileLaunches{Emit: emitter, Window: windows.AnyRealKey}
	mobileSvc := bridge.NewMobileAccessService(&bridge.MobileAccessService{
		Deps: deps, Reader: adeTaskSvc, Hub: mobileHub, Broker: mobileweb.NewBroker(time.Now), Assets: mobileAssetsFS,
		AgentSessions: func() any { return terminalSvc.AgentSessions() },
		Writer:        &bridge.MobileWriter{Svc: adeTaskSvc, Launches: mobileLaunches},
		Launches:      mobileLaunches,
		Terminals:     termBroker,
	})
	detachMobilePush := mobileSvc.AttachPush()

	beforeFlush := sync.OnceFunc(func() {
		// Kira Studio's own wireLifecycle: the ticker stops before the flush wait rather than after
		// it (P56 D3).
		metricsTicker.Stop()
		windows.DetachAll()
	})
	teardown := sync.OnceFunc(func() {
		// P119: a Cmd+Q mid-download aborts the install rather than leaving an orphan that later
		// swaps a bundle the user quit away from. After hand-off this is a no-op.
		updateInstaller.Cancel()
		detachMetrics()
		detachOpLog()
		// P87 §4: killing the assertion early keeps the window between "app is quitting" and
		// "caffeinate is dead" as short as possible — Kira Studio's own bridge.StopKeepAwake, inlined.
		keepAwakeCtl.Close()
		// terminal.ShutdownBound(terminalSvc.BoundService) first: every PTY dies, and each one's own exit fires
		// Registry.OnChange (Reconcile marks its row stopped) while the DB is still open. Then
		// shutdownTracker flushes whatever last-active time is still only in memory and stops the
		// hooks listener.
		terminal.ShutdownBound(terminalSvc.BoundService)
		shutdownTracker(adeTracker, agentHooks)
		adeTaskBoard.Close()
		detachGitPush()
		detachGitCredentialPush()
		// Before gitSock/DB close: ends open streams and aborts parked pairing requests.
		bridge.StopMobile(mobileSvc)
		detachMobilePush()
		if err := gitSock.Close(); err != nil {
			slog.Warn("close git socket", "scope", "shutdown", "err", err)
		}
		// F6: gitSock.Close() only reaches gitRegistry.Close() itself when this instance actually
		// won the listen (Server.Close's own early return otherwise) — a second instance's entries,
		// watchers, auto-fetch timers and review.db stayed open until process exit. Registry.Close
		// is idempotent (gitreview.Store.Close too), so calling it again here unconditionally is
		// always safe, listened or not.
		gitRegistry.Close()
		if askpassBroker != nil {
			if err := askpassBroker.Close(); err != nil {
				slog.Warn("close askpass broker", "scope", "shutdown", "err", err)
			}
		}
		// F5: stops every open codeworkspace.Session (cat-file pairs, in-flight searches) — before
		// repositories.Close(), since a running search still reads settings through Deps.Repos.
		codeWorkspaceSvc.Shutdown()
		bridge.CloseMemory(memorySvc)
		if err := repositories.Close(); err != nil {
			slog.Warn("close repos", "scope", "shutdown", "err", err)
		}
		if err := db.Close(); err != nil {
			slog.Warn("close db", "scope", "shutdown", "err", err)
		}
	})
	quitter := shell.NewQuitter(events, beforeFlush, teardown, 2*time.Second, windows.Keys)

	app := application.New(application.Options{
		Name:        "Kira Space",
		Description: "A git client for macOS\n\nVersion " + buildinfo.Version,
		Services: []application.Service{
			application.NewService(gitClientsSvc),
			application.NewService(gitCredentialSvc),
			application.NewService(codeWorkspaceSvc),
			application.NewService(gitHubSvc),
			application.NewService(linkSvc),
			application.NewService(&bridge.FilesService{Dialogs: dialogsSvc}),
			application.NewService(settingsSvc),
			application.NewService(layoutSvc),
			application.NewService(tabsSvc),
			application.NewService(&bridge.CustomScriptsService{Deps: deps}),
			application.NewService(terminalSvc),
			application.NewService(adeTaskSvc),
			application.NewService(&bridge.OpsService{Log: git.opLog}),
			application.NewService(&bridge.LifecycleService{Flusher: quitter, WindowFlusher: closeFlush}),
			application.NewService(keepAwakeSvc),
			application.NewService(mobileSvc),
			application.NewService(memorySvc),
			application.NewService(bridge.NewMemoryImportService(memorySvc, dialogsSvc)),
			application.NewService(windowsSvc),
			application.NewService(&bridge.UpdateService{
				Checker: updateChecker, Installer: updateInstaller, Quit: quitter.RequestQuit,
			}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		ShouldQuit: quitter.ShouldQuit,
		OnShutdown: quitter.Shutdown,
		ErrorHandler: func(err error) {
			fatalErr, ok := err.(*application.FatalError)
			if !ok {
				return
			}
			platformErrorOnce.Do(func() {
				reporter.ReportPlatform(fatalErr.Unwrap())
			})
		},
	})

	attachEmitter(app)
	bridge.StartMobileIfEnabled(mobileSvc)
	attachBrowser(app)
	quitter.Attach(app)

	// The sheet a folder-picker dialog attaches to is the window that actually asked — Current()
	// resolves the real key window on darwin; the registry fallback only matters where Current()
	// can't resolve one (this sandbox's Linux build, mid-startup before any window is focused).
	// Kira Studio's own main.go carries the identical fallback (wireWindowsAndMenu's
	// windowToActOn).
	windowToActOn := func() application.Window {
		if w := app.Window.Current(); w != nil {
			return w
		}
		return windows.Any()
	}
	attachDialogs(app, windowToActOn)

	appshell.RegisterGitStream(app, gitRouter)

	winDeps := shell.WindowOpenerDeps{
		App:        app,
		WindowDeps: shell.WindowDeps{Windows: repositories.Windows, StartedAt: startedAt},
		Windows:    windows, CloseFlush: closeFlush, Quitter: quitter,
		Terminal: terminalSvc.Registry, Repo: repositories.Windows,
		Cfg:       shell.Config{AppName: "Kira Space", WindowTitle: "Kira Space"},
		Ephemeral: func(key string) bool { ok, _ := repositories.AdeReview.IsReviewKey(key); return ok },
	}
	wireReviewWindows(adeTaskSvc, winDeps, windows, app)
	openNew := func() { shell.OpenNewWindow(winDeps) }
	// windowsSvc.OpenNewWindow is the title bar's "New window" button (P116 G6) — the same action
	// the ⇧⌘N menu command below ties to.
	windowsSvc.OpenNewWindow = openNew
	shell.AttachReopen(app, func() { shell.ReopenWindows(winDeps) })
	surfaceCredentialPrompts(credentialRelay, windows, winDeps)
	// P116 G5: a machine resume's own trigger — Rearm() while held, a no-op while idle.
	shell.AttachSystemWake(app, func() { bridge.KeepAwakeSystemDidWake(keepAwakeSvc) })

	isDev := app.Env.Info().Debug
	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Space", IsDev: isDev, Template: appshell.BuildTemplate("Kira Space", isDev),
		OnEmit: events.Signal, Quit: quitter.RequestQuit, NewWindow: openNew,
	}))

	purgeReviewWindows(repositories)
	records, err := repositories.Windows.List()
	if err != nil {
		reporter.Fatal(startupfail.StepWindowList, err)
	}
	if len(records) == 0 {
		rec := model.WindowRecord{Key: uuid.NewString(), Order: 0}
		if err := repositories.Windows.Create(rec); err != nil {
			reporter.Fatal(startupfail.StepWindowCreate, err)
		}
		records = []model.WindowRecord{rec}
	}
	for _, rec := range records {
		var bounds *shell.WindowBounds
		if rec.Bounds != nil {
			b := *rec.Bounds
			bounds = &b
		}
		shell.OpenWindow(winDeps, shell.ToWindowRecord(rec.Key, rec.Order, bounds))
	}

	if err := app.Run(); err != nil {
		reporter.Fatal(startupfail.StepRun, err)
	}
}

// platformErrorOnce bounds ErrorHandler to at most one alert per process — Kira Studio's own
// main.go carries the same bound, for the same reason (G29 D7).
var platformErrorOnce sync.Once

// gitWired is wireGit's own result — Kira Studio's own gitWired (main.go), unchanged shape.
type gitWired struct {
	runner        gitclient.Runner
	discovery     *gitclient.Discovery
	registry      *gitsession.Registry
	askpassBroker *gitaskpass.Broker
	router        *gitrpc.Router
	sock          *gitsock.Server
	opLog         *oplog.Log
}

// acquireSingleInstance is F7's app-wide single-instance guard, called before storage.Open — a
// second launch pointed at the same KIRA_SPACE_HOME (open -n, the binary run directly, or a dev
// build) would otherwise open the same kira.db, restore the same window rows, and
// last-writer-wins on every table the first instance also owns, while its own gitsock silently
// never listens (server.go:99-101). A distinct lock file from git.sock.lock (gitsock.Server
// acquires that one itself, inside wireGit): flock is scoped to the open file description, not
// the process, so reusing the same path here would make wireGit's own acquireLock see this same
// process as "another instance" a few lines later. Not acquired here means a real other instance
// owns this home — exit quietly (D5's own posture for gitsock's identical case: this is a
// supported state, not a failure), never show a window over a database another process already
// owns. Fatals through reporter on a real error; exits the process directly (never returns) when
// another instance already holds the lock.
func acquireSingleInstance(reporter *startupfail.Reporter) *os.File {
	instanceLock, acquired, err := gitsock.AcquireLock(filepath.Join(config.KiraSpaceHome(), "app.lock"))
	if err != nil {
		reporter.Fatal(startupfail.StepInstanceLock, err)
	}
	if !acquired {
		slog.Info("kira-space: another instance already owns this home; exiting", "scope", "startup")
		os.Exit(0)
	}
	return instanceLock
}

// wireTracker constructs and starts the ade.Tracker and the agenthooks.Manager it drives, wired
// together before any window exists so Compose never races an unset hooks func with a real launch.
// Rows a previous process life left running are stopped by the task board's Recover.
func wireTracker(
	repositories *repos.Repos, registry *terminal.Registry, emitter appevent.Emitter, events *bridge.Events,
) (*ade.Tracker, *agenthooks.Manager) {
	tracker := ade.NewTracker(ade.TrackerDeps{
		Store: repositories.AdeSessions, LiveAgents: registry.AgentSessions,
		WriteTerminal: registry.Write, Now: time.Now,
		OnChange: func() { bridge.AdeTaskSessionsChanged(events) },
	})

	// Hooks are always on: a start failure (curl missing, a bind conflict) is logged, never fatal —
	// sessions still spawn and track, activity icons stay absent.
	hooks := agenthooks.NewManager(agenthooks.Options{OnEvent: func(ev agenthooks.Event) {
		tracker.HandleEvent(ev)
		bridge.EmitAgentEvent(emitter, ev)
	}})
	if err := hooks.Start(); err != nil {
		slog.Warn("agent hooks: start", "scope", "ade", "err", err)
	}
	tracker.SetHooks(hooks.ComposeLaunch)
	return tracker, hooks
}

// agentSessionCount is the live Claude Code session count the keep-awake agent reason reads: the
// terminal registry's agent tabs plus ade headless sessions still running (headless runs have no
// terminal). A read failure counts the terminal sessions only.
func agentSessionCount(repositories *repos.Repos, registry *terminal.Registry) func() int {
	return func() int {
		n := len(registry.AgentSessions())
		headless, err := repositories.AdeSessions.CountRunningHeadless()
		if err != nil {
			slog.Warn("keep-awake: count ade sessions", "scope", "keepawake", "err", err)
			return n
		}
		n += headless
		return n
	}
}

// closeTaskReviewWindows returns the hook that closes every review window of an archived task.
func closeTaskReviewWindows(repositories *repos.Repos, windows *shell.WindowRegistry) func(taskID string) {
	return func(taskID string) {
		keys, err := repositories.AdeReview.KeysByTask(taskID)
		if err != nil {
			slog.Warn("ade: list review windows", "scope", "ade", "task", taskID, "err", err)
			return
		}
		for _, k := range keys {
			windows.Close(k)
		}
	}
}

// purgeReviewWindows drops review windows a previous run left behind: they are never restored.
func purgeReviewWindows(repositories *repos.Repos) {
	if err := repositories.AdeReview.PurgeAll(); err != nil {
		slog.Warn("ade: purge review windows", "scope", "ade", "err", err)
	}
}

// wireReviewWindows points the task service at the shell window registry for review windows.
func wireReviewWindows(svc *bridge.AdeTaskService, winDeps shell.WindowOpenerDeps, windows *shell.WindowRegistry, app *application.App) {
	svc.OpenWindow = func(rec shell.WindowRecord) {
		rec.Bounds = shell.CascadeFrom(app.Window.Current())
		shell.OpenWindow(winDeps, rec)
	}
	svc.CloseWindow = windows.Close
	svc.SetWindowTitle = func(key, title string) { windows.SetTitle(key, title) }
}

// wireAdeTask builds the v2 task board engine (P144): its own Conn, the
// workflow reader over <home>/workflows, and the cached git discovery gating merge-tree checks.
// It recovers rows a restart left running, then starts the board.
// surfaceCredentialPrompts handles a prompt raised away from any window (P178 D4): the user started
// that git op elsewhere and waits on it, so open a window when none exists, else bring one forward.
func surfaceCredentialPrompts(relay *gitcred.Relay, windows *shell.WindowRegistry, winDeps shell.WindowOpenerDeps) {
	var mu sync.Mutex // count-then-open must not interleave: two concurrent prompts would open two windows
	relay.SetOnAdded(func() {
		mu.Lock()
		defer mu.Unlock()
		if windows.Count() == 0 {
			shell.ReopenWindows(winDeps)
			return
		}
		if keys := windows.Keys(); len(keys) > 0 {
			windows.Focus(keys[0])
		}
	})
}

func wireAdeTask(
	repositories *repos.Repos, events *bridge.Events, git gitWired, tracker *ade.Tracker, closeTerminal func(string) error,
	closeReviewWindows func(taskID string), credentials *gitcred.Relay, keepAwake *bridge.KeepAwakeService,
) *ade.TaskBoard {
	userHome, err := os.UserHomeDir()
	if err != nil {
		slog.Warn("ade: user home", "scope", "ade", "err", err)
	}
	gitPath := adeGitPathSetting(repositories)
	board := ade.NewTaskBoard(ade.TaskBoardDeps{
		Tasks: repositories.AdeTasks, Backlog: repositories.AdeBacklog, RepoConfig: repositories.AdeRepoConfig,
		CodeRepos: repositories.CodeRepos, GitRepoSettings: repositories.GitRepoSettings.Get,
		Registry: git.registry, GitPath: gitPath,
		GitStatus:       func(ctx context.Context) gitclient.GitStatus { return git.discovery.Status(ctx, gitPath()) },
		Askpass:         git.askpassBroker,
		Workflows:       &adeflow.Reader{Dir: adeflow.Dir(config.KiraSpaceHome()), Store: repositories.AdeTasks},
		OnBoard:         func() { bridge.AdeTaskBoardChanged(events) },
		OnBacklog:       func() { bridge.AdeTaskBacklogChanged(events) },
		OnWorkflows:     func() { bridge.AdeTaskWorkflowsChanged(events) },
		OnRepos:         func() { bridge.AdeTaskReposChanged(events) },
		Facts:           repositories.AdeFacts,
		Runner:          git.runner,
		SetRepoSettings: git.router.SetRepoSettings,
		Credentials:     credentials,
		Logs:            repositories.AdeLogs,
		Sessions:        repositories.AdeSessions,
		Tracker:         tracker,
		CloseTerminal:   closeTerminal,
		Windows:         repositories.Windows, ReviewWindows: repositories.AdeReview, GhSynced: repositories.AdeGhSynced,
		CloseReviewWindows: closeReviewWindows,
		OnRuns:             func(ev adewire.RunsChangedEvent) { bridge.AdeTaskRunsChanged(events, ev) },
		OnLog:              func(ev adewire.LogEvent) { bridge.AdeTaskLogAppended(events, ev) },
		OnSessions: func() {
			bridge.AdeTaskSessionsChanged(events)
			bridge.KeepAwakeRecompute(keepAwake)
		},
		AgentDir: filepath.Join(config.KiraSpaceHome(), "ade", "runs"),
		HeadlessSettingSources: func() string {
			settings, err := repositories.Settings.GetAll()
			if err != nil {
				return ""
			}
			return settings.Ade.HeadlessSettingSources
		},
		AutofetchMinutes: adeAutofetchMinutes(repositories),
		HomeDir:          userHome,
		Now:              time.Now,
	})
	tracker.SetStoppedHandler(board.OnTUIStopped)
	if err := board.Recover(); err != nil {
		slog.Warn("ade: recover task board", "scope", "ade", "err", err)
	}
	board.WatchReviews()
	board.Start()
	return board
}

// adeGitPathSetting is TaskBoardDeps.GitPath's own construction — git.gitPath's own configured value
// verbatim (never resolved through Discovery.Status here), the same shape gitPathFrom
// (gitrpc/handlers.go) and CodeWorkspaceService.gitPathSetting already read it in: Registry.Acquire
// resolves an unset/relative path itself.
func adeGitPathSetting(repositories *repos.Repos) func() string {
	return func() string {
		settings, err := repositories.Settings.GetAll()
		if err != nil {
			return ""
		}
		return settings.Git.GitPath
	}
}

// adeAutofetchMinutes is TaskBoardDeps.AutofetchMinutes' own construction — echoes
// git.fetchAutoIntervalMinutes into the board, the same leaf gitRegistry.Settings
// (wireGit) already reads.
func adeAutofetchMinutes(repositories *repos.Repos) func() int {
	return func() int {
		settings, err := repositories.Settings.GetAll()
		if err != nil {
			return 0
		}
		return settings.Git.FetchAutoIntervalMinutes
	}
}

// adeCloseTerminal is the board's CloseTerminal seam — terminal.Registry.Close never
// errors, so this just satisfies the func(id string) error signature.
func adeCloseTerminal(registry *terminal.Registry) func(id string) error {
	return func(id string) error {
		registry.Close(id)
		return nil
	}
}

// shutdownTracker is wireTracker's teardown half: flushes the tracker's still-in-memory lastActive
// values, then stops the hooks listener.
func shutdownTracker(tracker *ade.Tracker, hooks *agenthooks.Manager) {
	if err := tracker.Close(); err != nil {
		slog.Warn("ade: close", "scope", "ade", "err", err)
	}
	if err := hooks.Stop(); err != nil {
		slog.Warn("agent hooks: stop", "scope", "ade", "err", err)
	}
}

// wireGit is Kira Studio's own wireGit (main.go), lifted wholesale onto this app's own
// repositories/config/buildinfo.
func wireGit(repositories *repos.Repos, credentials *gitcred.Relay) gitWired {
	gitRunner := gitclient.NewExecRunner()
	gitDiscovery := gitclient.NewDiscovery(gitclient.NewPlatformLocator(), gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
	// Set before gitSock.Start: a paired VS Code client can run a write the moment the socket is up.
	opLog := oplog.New()
	gitRegistry.OpLog = opLog
	gitRegistry.Settings = func() (protectedBranches []string, autoFetchMinutes int, gitPath string) {
		s, err := repositories.Settings.GetAll()
		if err != nil {
			slog.Warn("read git settings", "scope", "git", "err", err)
			return nil, 0, ""
		}
		return s.Git.ProtectedBranches, s.Git.FetchAutoIntervalMinutes, s.Git.GitPath
	}
	gitRegistry.RepoSettingsGet = repositories.GitRepoSettings.Get
	gitRegistry.RepoSettingsSet = repositories.GitRepoSettings.Set

	askpassBroker, err := gitaskpass.New(gitaskpass.Options{})
	if err != nil {
		slog.Warn("start askpass broker", "scope", "startup", "err", err)
		askpassBroker = nil
	}

	gitRouter := gitrpc.New(gitrpc.Deps{
		Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: buildinfo.Version,
		Askpass: askpassBroker,
		DateFormat: func() string {
			s, err := repositories.Settings.GetAll()
			if err != nil {
				slog.Warn("read date format", "scope", "git", "err", err)
				return "relative"
			}
			return s.Appearance.DateFormat
		},
	})
	gitSock := gitsock.New(gitsock.Deps{
		SocketPath:    filepath.Join(config.KiraSpaceHome(), "git.sock"),
		LockPath:      filepath.Join(config.KiraSpaceHome(), "git.sock.lock"),
		Clients:       repositories.GitClients,
		Registry:      gitRegistry,
		Credentials:   credentials,
		Router:        gitRouter,
		ServerVersion: buildinfo.Version,
		Now:           time.Now,
	})
	if err := gitSock.Start(); err != nil {
		slog.Warn("git socket listener", "scope", "startup", "err", err)
	}
	return gitWired{
		runner: gitRunner, discovery: gitDiscovery, registry: gitRegistry,
		askpassBroker: askpassBroker, router: gitRouter, sock: gitSock, opLog: opLog,
	}
}

// wireTermBroker arbitrates phone-attached agent terminals (P212 Part 2); a phone reaches only a
// running TUI task session, by ADE session id.
func wireTermBroker(tracker *ade.Tracker, registry *terminal.Registry, emitter appevent.Emitter) *mobileterm.Broker {
	return mobileterm.New(mobileterm.Deps{
		Registry: registry,
		Sessions: func(sessionID string) (string, bool) {
			tid, ok := tracker.TerminalOf(sessionID)
			if !ok {
				return "", false
			}
			rec, err := tracker.Get(sessionID)
			if err != nil || rec == nil || rec.Mode != model.AdeSessionModeTUI || rec.State != model.AdeSessionStateRunning || rec.TaskID == "" {
				return "", false
			}
			return tid, true
		},
		OnChange: func(h []mobileterm.Hold) { emitter.Emit(bridge.ChannelMobileTerminals, h) },
	})
}
