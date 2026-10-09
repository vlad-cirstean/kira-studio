// Package appwire is Kira Space's composition root: it builds the 22 bound services, the git router
// and socket, the ADE tracker and board, and their teardown. main and the flow-test harness
// (internal/flowharness) both call Build, so a test cannot wire differently from production. It sits
// above internal/bridge in the layering, like internal/appshell.
package appwire

import (
	"io"
	"io/fs"
	"log/slog"
	"net/netip"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentnotify"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/claudeusage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitcred"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitvsix"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/lannet"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileterm"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileweb"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/metrics"
	"github.com/kirathecat/kira-studio/internal/scriptruns"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/windowsvc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Options carries the OS seams main owns; everything else is wired the same way in production and
// in the harness.
type Options struct {
	Repos *repos.Repos
	// DB is closed last by Teardown, after Repos.
	DB io.Closer
	// Emitter is the window event sink (a deferred Wails emitter in production).
	Emitter appevent.Emitter
	Browser bridge.Browser
	Dialogs bridge.Dialogs
	// Locator resolves git.gitPath; main passes the platform locator.
	Locator         gitclient.Locator
	KeepAwakeDriver keepawake.Driver
	// MobileAssets is the embedded phone build, already rooted at its index.
	MobileAssets fs.FS
	// MobileIsLAN, MobileDetect, MobileFind and MobilePoll are the phone server's network seams;
	// nil/zero in production (lannet defaults).
	MobileIsLAN  func(netip.Addr) bool
	MobileDetect func() (lannet.Network, error)
	MobileFind   func(lannet.Identity) (lannet.Network, error)
	MobilePoll   time.Duration
	// GhLocator resolves the gh CLI; nil means the platform locator.
	GhLocator ghclient.Locator
	// TrackerGrace is how long the ADE tracker waits before it reads a spawned TUI session as
	// stopped; zero means the tracker default.
	TrackerGrace time.Duration
	// RebaseTimeout bounds one ADE rebase run; 0 keeps the default (20 minutes).
	RebaseTimeout time.Duration
}

// ShellHooks completes the window-manager seams once the shell exists. CloseWindow, FocusWindow and
// SetWindowTitle default to the window registry.
type ShellHooks struct {
	OpenWindow     func(rec shell.WindowRecord)
	OpenNewWindow  func()
	CloseWindow    func(key string) bool
	FocusWindow    func(key string) bool
	SetWindowTitle func(key, title string)
}

// Wired is the built object graph.
type Wired struct {
	Repos           *repos.Repos
	Deps            appcore.Deps
	Events          *bridge.Events
	Emitter         appevent.Emitter
	Windows         *shell.WindowRegistry
	CloseFlush      *shell.CloseFlushCoordinator
	Quitter         *shell.Quitter
	CredentialRelay *gitcred.Relay

	Git           gitWired
	Tracker       *ade.Tracker
	AgentHooks    *agenthooks.Manager
	AgentNotify   *agentnotify.Notifier
	TermBroker    *mobileterm.Broker
	TermRegistry  *terminal.Registry
	AdeBoard      *ade.TaskBoard
	KeepAwakeCtl  *keepawake.Controller
	Metrics       *metrics.Ticker
	UpdateInstall *appupdate.Installer

	GitClients     *bridge.GitClientsService
	GitCredential  *bridge.GitCredentialService
	GitHub         *bridge.GitHubService
	Link           *bridge.LinkService
	Files          *bridge.FilesService
	Settings       *bridge.SettingsService
	Layout         *bridge.LayoutService
	Tabs           *bridge.TabsService
	CustomScripts  *bridge.CustomScriptsService
	ScriptRuns     *bridge.ScriptRunsService
	Terminal       *bridge.TerminalService
	AdeTask        *bridge.AdeTaskService
	Ops            *bridge.OpsService
	Lifecycle      *bridge.LifecycleService
	KeepAwake      *bridge.KeepAwakeService
	Mobile         *bridge.MobileAccessService
	Memory         *bridge.MemoryService
	MemoryImport   *bridge.MemoryImportService
	WindowsSvc     *bridge.WindowsService
	Update         *bridge.UpdateService
	CodeWorkspace  *bridge.CodeWorkspaceService
	AgentNotifySvc *bridge.AgentNotifyService
	ClaudeUsage    *claudeusage.Service
	ClaudeUsageSvc *bridge.ClaudeUsageService

	detachMetrics   func()
	detachOpLog     func()
	detachGitPush   func()
	detachGitCred   func()
	detachMobile    func()
	beforeFlushOnce func()
	teardownOnce    func()
}

// Build wires every service. The git socket is already listening on return.
func Build(opts Options) *Wired {
	repositories := opts.Repos
	w := &Wired{Repos: repositories}

	credentialRelay := gitcred.New()
	git := wireGit(repositories, credentialRelay, opts.Locator, opts.GhLocator)
	w.Git, w.CredentialRelay = git, credentialRelay

	// The tap feeds every window-wide event to the phone event hub, which drops what is not allowlisted.
	mobileHub := mobileweb.NewHub()
	emitter := appevent.NewTap(opts.Emitter, mobileHub.Publish)
	deps := appcore.Deps{Repos: repositories, Home: config.KiraSpaceHome(), Events: emitter, GitRegistry: git.registry}
	events := bridge.NewEvents(emitter)
	w.Emitter, w.Deps, w.Events = emitter, deps, events
	w.detachOpLog = events.AttachOpLog(git.opLog)

	// P119: the update-availability checker and its detached installer.
	updateChecker := appupdate.NewChecker(appupdate.Space.Name, buildinfo.Version)
	updateInstaller := appupdate.NewInstaller(appupdate.Space, buildinfo.Version)
	w.UpdateInstall = updateInstaller

	w.CodeWorkspace = &bridge.CodeWorkspaceService{
		Deps: deps, Discovery: git.discovery, Runner: git.runner, Registry: codeworkspace.NewRegistry(),
		OnReposChanged: func() { bridge.AdeTaskReposChanged(events) },
	}
	w.GitClients = &bridge.GitClientsService{
		Deps: deps, Sock: git.sock, Broker: git.sock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{}),
	}
	w.detachGitPush = bridge.AttachGitClientsPush(w.GitClients)
	w.GitCredential = &bridge.GitCredentialService{Deps: deps, Relay: credentialRelay}
	w.detachGitCred = bridge.AttachGitCredentialPush(w.GitCredential)
	w.GitHub = &bridge.GitHubService{Deps: deps, Browser: opts.Browser}
	w.Link = &bridge.LinkService{Browser: opts.Browser}
	w.Settings = &bridge.SettingsService{Deps: deps}
	w.Layout = &bridge.LayoutService{Deps: deps}
	w.Tabs = &bridge.TabsService{Deps: deps}
	// terminalRegistry is shared by the terminal service and the ADE tracker (P129 Part 1 §4.3) — one
	// Registry, since Tracker.Reconcile/Send both need the same live-session set and PTYs.
	terminalRegistry := terminal.NewRegistry()
	w.TermRegistry = terminalRegistry
	w.AgentNotify = agentnotify.New(agentnotify.Deps{
		Prefs: notifyPrefs(repositories), Describe: w.describeAgent, TaskTitle: w.taskTitle, Reveal: w.revealNote,
		Alive: func(key string) bool { return slices.Contains(w.Windows.Keys(), key) },
	})
	w.AgentNotifySvc = &bridge.AgentNotifyService{N: w.AgentNotify}
	w.ClaudeUsage = claudeusage.New(claudeusage.Deps{
		Enabled: usageEnabled(repositories), Path: filepath.Join(config.KiraSpaceHome(), "claude-usage.json"),
		OnChange: func() { bridge.ClaudeUsageChanged(emitter, w.ClaudeUsage.Get()) },
	})
	w.ClaudeUsageSvc = &bridge.ClaudeUsageService{U: w.ClaudeUsage}
	adeTracker, agentHooks := wireTracker(repositories, terminalRegistry, emitter, events, opts.TrackerGrace, w.AgentNotify, w.ClaudeUsage)
	w.Tracker, w.AgentHooks = adeTracker, agentHooks

	// P128 §2.1: the bound terminal methods live once in internal/terminal.BoundService; this
	// app's own TerminalService only embeds it. ComposeAgent (P129 Part 1 §4.1) rewrites every
	// claude-code launch through adeTracker.Compose.
	termBroker := wireTermBroker(adeTracker, terminalRegistry, emitter)
	w.TermBroker = termBroker
	runs := &scriptruns.Service{
		Runs: repositories.ScriptRuns, Scripts: repositories.CustomScripts, Registry: terminalRegistry, Home: deps.Home, App: "Space",
		Emit: func(r scriptruns.Run) { emitter.Emit(bridge.ChannelScriptRunsChanged, r) },
	}
	if err := runs.Recover(); err != nil {
		slog.Warn("recover script runs", "scope", "startup", "err", err)
	}
	w.ScriptRuns = &bridge.ScriptRunsService{Bound: &scriptruns.Bound{Svc: runs}}
	w.Terminal = &bridge.TerminalService{BoundService: &terminal.BoundService{
		Emit: emitter, Registry: terminalRegistry, ComposeAgent: adeTracker.Compose, AbortAgent: adeTracker.Abort,
		Arbiter: termBroker, Scripts: runs,
	}}
	// P116 G5 keep-awake toggle plus P188's agent reason: the live Claude Code session count —
	// terminal agent tabs and running headless ade sessions — against claudeCode.keepAwakeWithAgents.
	w.KeepAwakeCtl = keepawake.New(opts.KeepAwakeDriver)
	w.KeepAwake = &bridge.KeepAwakeService{
		Emit: emitter, Toggle: &keepawake.Toggle{Ctl: w.KeepAwakeCtl},
		AgentCount: agentSessionCount(repositories, terminalRegistry),
		Settings:   repositories.Settings.GetAll,
	}
	w.Settings.OnChanged = func(model.Settings) { bridge.KeepAwakeRecompute(w.KeepAwake) }
	// memory.db opens on the Memory module's first call.
	w.Memory = bridge.NewMemoryService(emitter, mcpinstall.New(mcpinstall.Deps{}))
	go removeRetiredModels()

	// windows holds every open window; created here so Archive can close a task's review windows.
	w.Windows = shell.NewWindowRegistry()
	w.AdeBoard = wireAdeTask(repositories, events, git, adeTracker, adeCloseTerminal(terminalRegistry),
		closeTaskReviewWindows(repositories, func(key string) bool {
			// Through the bound hook, so a shell that overrides CloseWindow sees archive closes too.
			if w.AdeTask != nil && w.AdeTask.CloseWindow != nil {
				return w.AdeTask.CloseWindow(key)
			}
			return w.Windows.Close(key)
		}), credentialRelay, w.KeepAwake, w.AgentNotify, w.ClaudeUsage, opts.RebaseTimeout)
	w.AdeTask = &bridge.AdeTaskService{Engine: w.AdeBoard, Registry: terminalRegistry, Emit: emitter}
	// Registry.OnChange fires after every agent session registers or is removed (spawn and exit) —
	// Reconcile picks up both, and AgentSessionsChanged refreshes the P127 store's own live count
	// (P129 Part 1 §4.2 step 4).
	terminalRegistry.OnChange = func() {
		adeTracker.Reconcile()
		bridge.AgentSessionsChanged(emitter, terminalRegistry)
		bridge.KeepAwakeRecompute(w.KeepAwake)
	}
	bridge.KeepAwakeRecompute(w.KeepAwake)

	// OpenNewWindow is assigned by BindShell once the shell exists.
	w.WindowsSvc = &bridge.WindowsService{Service: &windowsvc.Service{Windows: deps.Repos.Windows}}

	// P116 G7: the status bar's CPU/memory readout.
	w.Metrics = metrics.NewAppTicker("Kira Space")
	w.Metrics.Start()
	w.detachMetrics = events.AttachMetrics(w.Metrics)

	w.AdeTask.FocusWindow = w.Windows.Focus
	w.CloseFlush = shell.NewCloseFlushCoordinator(events)

	mobileLaunches := &bridge.MobileLaunches{Emit: emitter, Window: w.Windows.AnyRealKey}
	w.Mobile = bridge.NewMobileAccessService(&bridge.MobileAccessService{
		Deps: deps, Reader: w.AdeTask, Hub: mobileHub, Broker: mobileweb.NewBroker(time.Now), Assets: opts.MobileAssets,
		AgentSessions: func() any { return w.Terminal.AgentSessions() },
		Writer:        &bridge.MobileWriter{Svc: w.AdeTask, Launches: mobileLaunches},
		Launches:      mobileLaunches,
		Terminals:     termBroker,
		Detect:        opts.MobileDetect, Find: opts.MobileFind, Poll: opts.MobilePoll,
		IsLAN: opts.MobileIsLAN,
	})
	w.detachMobile = bridge.AttachMobilePush(w.Mobile)

	w.beforeFlushOnce = sync.OnceFunc(func() {
		// The ticker stops before the flush wait rather than after it (P56 D3).
		w.Metrics.Stop()
		w.Windows.DetachAll()
	})
	w.teardownOnce = sync.OnceFunc(func() { w.teardown(opts.DB) })
	w.Quitter = shell.NewQuitter(events, w.beforeFlushOnce, w.teardownOnce, 2*time.Second, w.Windows.Keys)

	w.Files = &bridge.FilesService{Dialogs: opts.Dialogs}
	w.CustomScripts = &bridge.CustomScriptsService{Deps: deps}
	w.Ops = &bridge.OpsService{Log: git.opLog}
	w.Lifecycle = &bridge.LifecycleService{Flusher: w.Quitter, WindowFlusher: w.CloseFlush}
	w.MemoryImport = bridge.NewMemoryImportService(w.Memory, opts.Dialogs)
	w.Update = &bridge.UpdateService{Checker: updateChecker, Installer: updateInstaller, Quit: w.Quitter.RequestQuit}
	return w
}

// BindShell points the window-manager seams at the shell, which exists only after Build.
func (w *Wired) BindShell(h ShellHooks) {
	closeWindow, focusWindow, setTitle := h.CloseWindow, h.FocusWindow, h.SetWindowTitle
	if closeWindow == nil {
		closeWindow = w.Windows.Close
	}
	if focusWindow == nil {
		focusWindow = w.Windows.Focus
	}
	if setTitle == nil {
		setTitle = func(key, title string) { w.Windows.SetTitle(key, title) }
	}
	w.AdeTask.OpenWindow = h.OpenWindow
	w.AdeTask.CloseWindow = closeWindow
	w.AdeTask.FocusWindow = focusWindow
	w.AdeTask.SetWindowTitle = setTitle
	w.WindowsSvc.OpenNewWindow = h.OpenNewWindow
}

// StartMobile starts the phone server when settings enable it; call after the shell is up.
func (w *Wired) StartMobile() { bridge.StartMobileIfEnabled(w.Mobile) }

// Bound returns the 22 bound services in registration order.
func (w *Wired) Bound() []application.Service {
	return []application.Service{
		application.NewService(w.GitClients), application.NewService(w.GitCredential),
		application.NewService(w.CodeWorkspace), application.NewService(w.GitHub), application.NewService(w.Link),
		application.NewService(w.Files), application.NewService(w.Settings), application.NewService(w.Layout),
		application.NewService(w.Tabs), application.NewService(w.CustomScripts), application.NewService(w.ScriptRuns), application.NewService(w.Terminal),
		application.NewService(w.AdeTask), application.NewService(w.Ops), application.NewService(w.Lifecycle),
		application.NewService(w.KeepAwake), application.NewService(w.Mobile), application.NewService(w.Memory),
		application.NewService(w.MemoryImport), application.NewService(w.WindowsSvc), application.NewService(w.Update),
		application.NewService(w.AgentNotifySvc), application.NewService(w.ClaudeUsageSvc),
	}
}

// GitRouter is the router the git stream serves.
func (w *Wired) GitRouter() *gitrpc.Router { return w.Git.router }

// GitSock is the VS Code pairing socket server.
func (w *Wired) GitSock() *gitsock.Server { return w.Git.sock }

// BeforeFlush stops the metrics ticker and detaches window listeners; idempotent.
func (w *Wired) BeforeFlush() { w.beforeFlushOnce() }

// Teardown runs the ordered shutdown once; idempotent.
func (w *Wired) Teardown() { w.teardownOnce() }

func (w *Wired) teardown(db io.Closer) {
	// P119: a Cmd+Q mid-download aborts the install rather than leaving an orphan that later
	// swaps a bundle the user quit away from. After hand-off this is a no-op.
	w.UpdateInstall.Cancel()
	w.detachMetrics()
	w.detachOpLog()
	// P87 §4: killing the assertion early keeps the window between "app is quitting" and
	// "caffeinate is dead" as short as possible.
	w.KeepAwakeCtl.Close()
	// terminal.ShutdownBound first: every PTY dies, and each one's own exit fires Registry.OnChange
	// (Reconcile marks its row stopped) while the DB is still open. Then shutdownTracker flushes
	// whatever last-active time is still only in memory and stops the hooks listener.
	terminal.ShutdownBound(w.Terminal.BoundService)
	shutdownTracker(w.Tracker, w.AgentHooks)
	w.AdeBoard.Close()
	w.detachGitPush()
	w.detachGitCred()
	// Before gitSock/DB close: ends open streams and aborts parked pairing requests.
	bridge.StopMobile(w.Mobile)
	w.detachMobile()
	if err := w.Git.sock.Close(); err != nil {
		slog.Warn("close git socket", "scope", "shutdown", "err", err)
	}
	// F6: gitSock.Close() only reaches the registry's Close itself when this instance actually won
	// the listen — a second instance's entries, watchers, auto-fetch timers and review.db stayed
	// open until process exit. Registry.Close is idempotent, so calling it again is always safe.
	w.Git.registry.Close()
	if w.Git.askpassBroker != nil {
		if err := w.Git.askpassBroker.Close(); err != nil {
			slog.Warn("close askpass broker", "scope", "shutdown", "err", err)
		}
	}
	// F5: stops every open codeworkspace.Session (cat-file pairs, in-flight searches) — before
	// repositories.Close(), since a running search still reads settings through Deps.Repos.
	w.CodeWorkspace.Shutdown()
	bridge.CloseMemory(w.Memory)
	if err := w.Repos.Close(); err != nil {
		slog.Warn("close repos", "scope", "shutdown", "err", err)
	}
	if err := db.Close(); err != nil {
		slog.Warn("close db", "scope", "shutdown", "err", err)
	}
}
