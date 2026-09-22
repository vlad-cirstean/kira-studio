package main

import (
	"embed"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
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
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/shell"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/terminal"
	"github.com/kirathecat/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/internal/startupfail"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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
// terminal, no keep-awake, no Claude Code hooks, no update checker, no system notifications for
// pairing requests (gitsock.OnPairingChanged is wired by nothing yet — Part 2's own frontend is
// what gives the pairing prompt/Connected-editors pane somewhere to push to) — none of that is
// this app's own module.
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

	startedAt := time.Now()

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

	browserOpener, attachBrowser := shell.NewDeferredBrowser()

	codeWorkspaceSvc := &bridge.CodeWorkspaceService{
		Deps: deps, Discovery: gitDiscovery, Runner: gitRunner, Registry: codeworkspace.NewRegistry(),
	}
	gitClientsSvc := &bridge.GitClientsService{
		Deps: deps, Sock: gitSock, Broker: gitSock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{}),
	}
	gitHubSvc := &bridge.GitHubService{Deps: deps, Browser: browserOpener}
	settingsSvc := &bridge.SettingsService{Deps: deps}
	layoutSvc := &bridge.LayoutService{Deps: deps}
	tabsSvc := &bridge.TabsService{Deps: deps}
	// P100 Part 2: internal/terminal is duplicated (not hoisted — Go's internal/ rule) from Kira
	// Studio's own package, trimmed of its AgentHooks integration (bridge/terminal.go's own doc
	// comment) — this app has no Claude Code hook-reporting toggle in scope.
	terminalSvc := &bridge.TerminalService{Emit: emitter, Registry: terminal.NewRegistry()}

	// windows/closeFlush are P100 Part 2's own addition — Part 1 had no per-window flush to
	// coordinate (no tabs, no layout); the quit-wide handshake below needs windows.Keys, and each
	// window's own close needs closeFlush's ack routing (shell/closeflush.go).
	windows := shell.NewWindowRegistry()
	closeFlush := shell.NewCloseFlushCoordinator()

	beforeFlush := sync.OnceFunc(func() {
		windows.DetachAll()
	})
	teardown := sync.OnceFunc(func() {
		terminalSvc.Shutdown()
		if err := gitSock.Close(); err != nil {
			slog.Warn("close git socket", "scope", "shutdown", "err", err)
		}
		if askpassBroker != nil {
			if err := askpassBroker.Close(); err != nil {
				slog.Warn("close askpass broker", "scope", "shutdown", "err", err)
			}
		}
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
			application.NewService(settingsSvc),
			application.NewService(layoutSvc),
			application.NewService(tabsSvc),
			application.NewService(terminalSvc),
			application.NewService(&bridge.LifecycleService{Flusher: quitter, WindowFlusher: closeFlush}),
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

	shell.RegisterGitStream(app, gitRouter)

	opener := &windowOpener{
		app:          app,
		windowDeps:   shell.WindowDeps{Windows: repositories.Windows, StartedAt: startedAt},
		windows:      windows,
		events:       events,
		closeFlush:   closeFlush,
		quitter:      quitter,
		terminalSvc:  terminalSvc,
		repositories: repositories,
	}
	shell.AttachReopen(app, opener.reopen)

	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Space", Quit: quitter.RequestQuit, NewWindow: opener.openNew,
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
		opener.open(rec)
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
}

// wireGit is Kira Studio's own wireGit (main.go), lifted wholesale onto this app's own
// repositories/config/buildinfo.
func wireGit(repositories *repos.Repos) gitWired {
	gitRunner := gitclient.NewExecRunner()
	gitDiscovery := gitclient.NewDiscovery(gitclient.NewPlatformLocator(), gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
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
		askpassBroker: askpassBroker, router: gitRouter, sock: gitSock,
	}
}

// windowOpener is Kira Studio's own windowOpener (main.go), grown in P100 Part 2 to carry
// events/closeFlush/quitter/terminalSvc — Part 1's own trimmed copy had none of the three yet
// (no tabs/layout to flush, no terminal registry to tear down).
type windowOpener struct {
	app          *application.App
	windowDeps   shell.WindowDeps
	windows      *shell.WindowRegistry
	events       *bridge.Events
	closeFlush   *shell.CloseFlushCoordinator
	quitter      *shell.Quitter
	terminalSvc  *bridge.TerminalService
	repositories *repos.Repos
}

// open opens one workbench from an already-persisted record and registers it. Its own
// WindowClosing listener keeps Kira Studio's own D5 rule: delete the row only if another window
// remains open, so closing the last window leaves it behind for the next Dock click or relaunch
// to restore.
func (o *windowOpener) open(rec model.WindowRecord) {
	var primaryWorkArea *application.Rect
	if screen := o.app.Screen.GetPrimary(); screen != nil {
		primaryWorkArea = &screen.WorkArea
	}
	win := o.app.Window.NewWithOptions(shell.Options(shell.Harden(), rec, primaryWorkArea))
	detach := shell.Attach(win, o.windowDeps, rec.Key)
	o.windows.Add(rec.Key, win, detach)
	shell.AttachCloseFlush(win, rec.Key, o.events, o.closeFlush, func() bool { return o.windows.Count() == 1 })
	win.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		// A window that closes mid-quit-handshake without ever acking through the flush channel is
		// removed from the pending set here rather than being waited out for the full timeout — a
		// no-op when no quit is in flight (Quitter.Flushed ignores a key it isn't waiting on).
		o.quitter.Flushed(rec.Key)
		o.terminalSvc.Registry.CloseWindow(rec.Key)
		if o.windows.RemoveAndCount(rec.Key) > 0 {
			if err := o.repositories.Windows.Delete(rec.Key); err != nil {
				slog.Warn("delete window row", "scope", "window", "key", rec.Key, "err", err)
			}
		}
	})
}

// openNew is the New Window menu command: a fresh workbench, ordered after every existing one,
// cascaded from whichever window is currently focused.
func (o *windowOpener) openNew() {
	records, err := o.repositories.Windows.List()
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
	rec := model.WindowRecord{Key: uuid.NewString(), Order: order, Bounds: shell.CascadeFrom(o.app.Window.Current())}
	if err := o.repositories.Windows.Create(rec); err != nil {
		slog.Error("create window", "scope", "window", "err", err)
		return
	}
	o.open(rec)
}

// reopen is the Dock-reopen path: bring back the highest-order stored workbench, or mint a fresh
// one if every window row was somehow deleted.
func (o *windowOpener) reopen() {
	records, err := o.repositories.Windows.List()
	if err != nil {
		slog.Error("list windows for reopen", "scope", "window", "err", err)
		return
	}
	if len(records) == 0 {
		rec := model.WindowRecord{Key: uuid.NewString(), Order: 0}
		if err := o.repositories.Windows.Create(rec); err != nil {
			slog.Error("create window for reopen", "scope", "window", "err", err)
			return
		}
		o.open(rec)
		return
	}
	best := records[0]
	for _, r := range records[1:] {
		if r.Order > best.Order {
			best = r
		}
	}
	o.open(best)
}
