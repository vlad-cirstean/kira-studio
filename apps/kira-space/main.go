package main

import (
	"embed"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appshell"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitvsix"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/internal/logging"
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

// main's startup order is Kira Studio's own main.go, trimmed to this app's own four bridge
// services and a minimal window (P100 Part 1, plan §4.2): the askpass argv shim -> config.
// EnsureLayout -> logging.Init/Sweep -> storage.Open (migrates) -> repos.New -> wireGit ->
// gitsock.Server (inside wireGit) -> application.New(Services: GitClientsService,
// CodeWorkspaceService, the git stream registration, GitHubService) -> the menu -> the startup
// window list, opened -> app.Run(). No adapters, no connections, no HTTP/gRPC, no DB MCP, no
// terminal, no keep-awake, no Claude Code hooks, no system notifications for pairing requests —
// none of that is this app's own module. P119 added an update checker/installer, the one
// exception. gitClientsSvc.AttachPush() wires
// gitsock's pairing/clients-changed feeds onto the two push channels the pairing prompt and
// Connected-editors pane read (P108 Part 20 F1).
func main() {
	// Askpass shim, before anything Wails-related runs, so it can never accidentally start a
	// window — Kira Studio's own main.go:83, deleted there in this same phase's cleanup commit.
	if len(os.Args) > 1 && os.Args[1] == "askpass" {
		os.Exit(gitaskpass.RunHelper(os.Args[2:], os.Environ(), os.Stdout))
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

	git := wireGit(repositories)
	gitDiscovery, gitRunner, gitRegistry := git.discovery, git.runner, git.registry
	askpassBroker, gitRouter, gitSock := git.askpassBroker, git.router, git.sock

	emitter, attachEmitter := shell.NewDeferredEmitter()
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
	}
	gitClientsSvc := &bridge.GitClientsService{
		Deps: deps, Sock: gitSock, Broker: gitSock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{}),
	}
	detachGitPush := gitClientsSvc.AttachPush()
	gitHubSvc := &bridge.GitHubService{Deps: deps, Browser: browserOpener}
	linkSvc := &bridge.LinkService{Browser: browserOpener}
	settingsSvc := &bridge.SettingsService{Deps: deps}
	layoutSvc := &bridge.LayoutService{Deps: deps}
	tabsSvc := &bridge.TabsService{Deps: deps}
	// terminalRegistry is shared by terminalSvc and adeTracker below (P129 Part 1 §4.3) — one
	// Registry, since Tracker.Reconcile/Send both need the same live-session set and PTYs the
	// terminal service itself opens.
	terminalRegistry := terminal.NewRegistry()
	adeTracker, adeQueue, agentHooks := wireAde(repositories, terminalRegistry, emitter, events, git)

	// P128 §2.1: the bound terminal methods live once in internal/terminal.BoundService; this
	// app's own TerminalService only embeds it (own binding-name FQN, no behaviour of its own).
	// ComposeAgent (P129 Part 1 §4.1) rewrites every claude-code launch through adeTracker.Compose.
	terminalSvc := &bridge.TerminalService{BoundService: &terminal.BoundService{
		Emit: emitter, Registry: terminalRegistry, ComposeAgent: adeTracker.Compose,
	}}
	adeSvc := &bridge.AdeService{Deps: deps, Tracker: adeTracker, Registry: terminalRegistry, Queue: adeQueue}
	// Registry.OnChange fires after every agent session registers or is removed (spawn and exit) —
	// Reconcile picks up both, and AgentSessionsChanged refreshes the P127 store's own live count
	// (P129 Part 1 §4.2 step 4).
	terminalRegistry.OnChange = func() {
		adeTracker.Reconcile()
		bridge.AgentSessionsChanged(adeSvc)
	}

	// keepAwakeCtl/keepAwakeSvc are P116 G5's own addition — the title bar's keep-awake toggle,
	// Kira Studio's own titlebar half (internal/keepawake.Toggle, shared since H3) with no
	// agent-aware reason of this app's own to layer on top.
	keepAwakeCtl := keepawake.New(keepawake.NewPlatformDriver())
	keepAwakeSvc := &bridge.KeepAwakeService{Emit: emitter, Toggle: &keepawake.Toggle{Ctl: keepAwakeCtl}}

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
	windows := shell.NewWindowRegistry()
	// adeSvc.FocusWindow: the same two-step windowsSvc.OpenNewWindow (below) uses — FocusSession
	// (P129 Part 7 §0.9) needs windows, which doesn't exist yet when adeSvc is constructed above.
	adeSvc.FocusWindow = windows.Focus
	closeFlush := shell.NewCloseFlushCoordinator(events)

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
		// "caffeinate is dead" as short as possible — Kira Studio's own bridge.StopKeepAwake, inlined
		// here since this app's own KeepAwakeService has no agent-reason recompute to also stop.
		keepAwakeCtl.Close()
		// terminalSvc.Shutdown() first: every PTY dies, and each one's own exit fires
		// Registry.OnChange (Reconcile marks its row stopped) while the DB is still open. Then
		// shutdownAde flushes whatever last-active time is still only in memory, closes the queue's
		// own Conn (releasing every repo it held), and stops the hooks listener (P129 Part 1 §4.3,
		// Part 2 §5.4).
		terminalSvc.Shutdown()
		shutdownAde(adeTracker, adeQueue, agentHooks)
		detachGitPush()
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
			application.NewService(codeWorkspaceSvc),
			application.NewService(gitHubSvc),
			application.NewService(linkSvc),
			application.NewService(&bridge.FilesService{Dialogs: dialogsSvc}),
			application.NewService(settingsSvc),
			application.NewService(layoutSvc),
			application.NewService(tabsSvc),
			application.NewService(terminalSvc),
			application.NewService(adeSvc),
			application.NewService(&bridge.OpsService{Log: git.opLog}),
			application.NewService(&bridge.LifecycleService{Flusher: quitter, WindowFlusher: closeFlush}),
			application.NewService(keepAwakeSvc),
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
		Cfg: shell.Config{AppName: "Kira Space", WindowTitle: "Kira Space"},
	}
	openNew := func() { shell.OpenNewWindow(winDeps) }
	// windowsSvc.OpenNewWindow is the title bar's "New window" button (P116 G6) — the same action
	// the ⇧⌘N menu command below ties to.
	windowsSvc.OpenNewWindow = openNew
	shell.AttachReopen(app, func() { shell.ReopenWindows(winDeps) })
	// P116 G5: a machine resume's own trigger — Rearm() while held, a no-op while idle.
	shell.AttachSystemWake(app, func() { bridge.KeepAwakeSystemDidWake(keepAwakeSvc) })

	isDev := app.Env.Info().Debug
	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Space", IsDev: isDev, Template: appshell.BuildTemplate("Kira Space", isDev),
		OnEmit: events.Signal, Quit: quitter.RequestQuit, NewWindow: openNew,
	}))

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

// wireAde constructs and starts Kira Space's own agent runtime (P129 Part 1 §4.3/§4.4) plus the
// merge-queue's own git-facts and persistence surface (Part 2 §5.4): the ade.Tracker and the
// agenthooks.Manager it drives, and the ade.Queue holding its own gitsession.Conn, wired together
// before any window exists so Compose never races an unset hooks func with a real launch. Recover
// runs here too — a fresh Registry never has any of a previous process life's PTYs live, so every
// row that life left "running" is unconditionally stale. Kira Studio's own main.go has no
// equivalent: its ComposeAgent stays nil, and it has no ade module at all.
func wireAde(
	repositories *repos.Repos, registry *terminal.Registry, emitter appevent.Emitter, events *bridge.Events,
	git gitWired,
) (*ade.Tracker, *ade.Queue, *agenthooks.Manager) {
	tracker := ade.NewTracker(ade.TrackerDeps{
		Store: repositories.AdeSessions, LiveAgents: registry.AgentSessions,
		WriteTerminal: registry.Write, Now: time.Now,
		OnChange: func() { bridge.AdeSessionsChanged(events) },
	})
	if err := tracker.Recover(); err != nil {
		slog.Warn("ade: recover", "scope", "ade", "err", err)
	}

	// agentHooks is P129 Part 1 §4.3's own "always on" posture: the design has no toggle, and a
	// start failure (curl missing, a bind conflict) is logged, never fatal — sessions still spawn
	// and track, activity icons stay absent.
	hooks := agenthooks.NewManager(agenthooks.Options{OnEvent: func(ev agenthooks.Event) {
		tracker.HandleEvent(ev)
		bridge.EmitAgentEvent(emitter, ev)
	}})
	if err := hooks.Start(); err != nil {
		slog.Warn("agent hooks: start", "scope", "ade", "err", err)
	}
	tracker.SetHooks(hooks.ComposeLaunch)

	queue := ade.NewQueue(ade.QueueDeps{
		Store:         repositories.AdeQueue,
		Sessions:      adeSessionsFor(tracker),
		CodeRepo:      adeCodeRepoLookup(repositories),
		Registry:      git.registry,
		GitPath:       adeGitPathSetting(repositories),
		Askpass:       git.askpassBroker,
		CloseTerminal: adeCloseTerminal(registry),
		OnRepoChanged: func(codeRepoID string) { bridge.AdeRepoChanged(events, codeRepoID) },
		OnCredential:  func(payload any) { bridge.AdeCredentialRequested(events, payload) },
		// §6.4's own rebind signal reuses the same broadcast the tracker's own OnChange above fires
		// — either subsystem changing ade_sessions rows means the same "re-fetch Sessions" fact.
		OnSessionsChanged: func() { bridge.AdeSessionsChanged(events) },
		AutofetchMinutes:  adeAutofetchMinutes(repositories),
		Now:               time.Now,
	})

	return tracker, queue, hooks
}

// adeSessionsFor is QueueDeps.Sessions' own construction (§5.1): Tracker.List filtered to
// codeRepoID and mapped to ade.SessionRef, Part 1's own already-recorded session rows.
func adeSessionsFor(tracker *ade.Tracker) func(codeRepoID string) []ade.SessionRef {
	return func(codeRepoID string) []ade.SessionRef {
		sessions, err := tracker.List()
		if err != nil {
			slog.Warn("ade: list sessions for queue", "scope", "ade", "err", err)
			return nil
		}
		var out []ade.SessionRef
		for _, sess := range sessions {
			if sess.CodeRepoID != codeRepoID {
				continue
			}
			out = append(out, ade.SessionRef{
				ID: sess.ID, Branch: sess.Branch, NewWorkID: sess.NewWorkID,
				State: sess.State, TerminalID: sess.TerminalID, StartedAt: sess.StartedAt,
			})
		}
		return out
	}
}

// adeCodeRepoLookup is QueueDeps.CodeRepo's own construction — codeRepoId to its filesystem root,
// "" and false when it names no real repo.
func adeCodeRepoLookup(repositories *repos.Repos) func(id string) (string, bool) {
	return func(id string) (string, bool) {
		repo, err := repositories.CodeRepos.Get(id)
		if err != nil || repo == nil {
			return "", false
		}
		return repo.Root, true
	}
}

// adeGitPathSetting is QueueDeps.GitPath's own construction — git.gitPath's own configured value
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

// adeAutofetchMinutes is QueueDeps.AutofetchMinutes' own construction — echoes
// git.fetchAutoIntervalMinutes into AdeRepoSnapshot (§5.2), the same leaf gitRegistry.Settings
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

// adeCloseTerminal is QueueDeps.CloseTerminal's own construction — terminal.Registry.Close never
// errors, so this just satisfies the func(id string) error seam Archive's own stopRunningSessions
// expects.
func adeCloseTerminal(registry *terminal.Registry) func(id string) error {
	return func(id string) error {
		registry.Close(id)
		return nil
	}
}

// shutdownAde is wireAde's own teardown half (main.go's teardown func): flushes adeTracker's
// still-in-memory lastActive values, closes the queue's own Conn (releasing every repo it held),
// then stops the hooks listener — a plain helper so main's own gocognit score doesn't carry three
// more nested error checks for a call site used exactly once.
func shutdownAde(tracker *ade.Tracker, queue *ade.Queue, hooks *agenthooks.Manager) {
	if err := tracker.Close(); err != nil {
		slog.Warn("ade: close", "scope", "ade", "err", err)
	}
	queue.Close()
	if err := hooks.Stop(); err != nil {
		slog.Warn("agent hooks: stop", "scope", "ade", "err", err)
	}
}

// wireGit is Kira Studio's own wireGit (main.go), lifted wholesale onto this app's own
// repositories/config/buildinfo.
func wireGit(repositories *repos.Repos) gitWired {
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
		SetGitPath: func(gitPath string) error {
			_, err := repositories.Settings.Set(model.SettingsPatch{Git: &model.GitPatch{GitPath: &gitPath}})
			return err
		},
	})
	gitSock := gitsock.New(gitsock.Deps{
		SocketPath:    filepath.Join(config.KiraSpaceHome(), "git.sock"),
		LockPath:      filepath.Join(config.KiraSpaceHome(), "git.sock.lock"),
		Clients:       repositories.GitClients,
		Registry:      gitRegistry,
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
