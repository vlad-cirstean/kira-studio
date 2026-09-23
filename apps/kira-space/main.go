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
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/appsettings"
	"github.com/kirathecat/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/startupfail"
	"github.com/kirathecat/kira-studio/internal/terminal"
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
	rawDialogs, attachDialogs := shell.NewDeferredDialogs()
	dialogsSvc := appshell.NewDialogs(rawDialogs)

	codeWorkspaceSvc := &bridge.CodeWorkspaceService{
		Deps: deps, Discovery: gitDiscovery, Runner: gitRunner, Registry: codeworkspace.NewRegistry(),
	}
	gitClientsSvc := &bridge.GitClientsService{
		Deps: deps, Sock: gitSock, Broker: gitSock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{}),
	}
	gitHubSvc := &bridge.GitHubService{Deps: deps, Browser: browserOpener}
	linkSvc := &bridge.LinkService{Browser: browserOpener}
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
	closeFlush := shell.NewCloseFlushCoordinator(events)

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
			application.NewService(linkSvc),
			application.NewService(&bridge.FilesService{Dialogs: dialogsSvc}),
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
	shell.AttachReopen(app, func() { shell.ReopenWindows(winDeps) })

	app.Menu.Set(shell.BuildMenu(shell.MenuDeps{
		AppName: "Kira Space", Template: appshell.BuildTemplate("Kira Space"),
		Quit: quitter.RequestQuit, NewWindow: openNew,
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
			b := shell.WindowBounds(*rec.Bounds)
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
			_, err := repositories.Settings.Set(model.SettingsPatch{Git: &appsettings.GitPatch{GitPath: &gitPath}})
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
