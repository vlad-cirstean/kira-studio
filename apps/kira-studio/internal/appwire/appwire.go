// Package appwire is Kira Studio's composition root: it builds the 28 bound services, the adapter
// router, the embedded modules and their teardown. main and the flow-test harness
// (internal/flowharness) both call Build, so a test cannot wire differently from production. It
// sits above internal/bridge in the layering, like internal/appshell.
package appwire

import (
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/localauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/maskrules"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/secrets"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/appupdate"
	"github.com/kirathecat/kira-studio/internal/docker"
	"github.com/kirathecat/kira-studio/internal/keepawake"
	"github.com/kirathecat/kira-studio/internal/logging"
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/kirathecat/kira-studio/internal/terminal"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Options carries the OS seams main owns; everything else is wired the same way in production and
// in the harness.
type Options struct {
	// DB is closed last by Teardown, after Repos.
	DB    *storage.DB
	Repos *repos.Repos
	// Cipher and Authorizer are shared by connections and variables, so a reveal grace is shared.
	Cipher     *secrets.Cipher
	Authorizer *localauth.Authorizer
	// Emitter is the window event sink (a deferred Wails emitter in production).
	Emitter         appevent.Emitter
	Dialogs         bridge.Dialogs
	KeepAwakeDriver keepawake.Driver
	McpInstaller    bridge.McpInstaller
	AppName         string
	Version         string
	// SmartTimeout replaces every smart script's own timeout (a flow-test seam); production leaves it zero.
	SmartTimeout time.Duration
}

// Wired is the built object graph.
type Wired struct {
	StartedAt  time.Time
	Repos      *repos.Repos
	Deps       appcore.Deps
	Router     *adapterhost.Router
	Events     *bridge.Events
	Windows    *shell.WindowRegistry
	CloseFlush *shell.CloseFlushCoordinator
	Quitter    *shell.Quitter
	// TerminalRegistry and OnWindowClosing are the window-close hooks the shell runs.
	TerminalRegistry *terminal.Registry
	OnWindowClosing  []func(string)

	App             *bridge.AppService
	Settings        *bridge.SettingsService
	Layout          *bridge.LayoutService
	Tabs            *bridge.TabsService
	WindowsSvc      *bridge.WindowsService
	Connections     *bridge.ConnectionsService
	MaskRules       *bridge.MaskRulesService
	Tree            *bridge.TreeService
	Ops             *bridge.OpsService
	Filters         *bridge.FiltersService
	Files           *bridge.FilesService
	Queries         *bridge.QueriesService
	Schema          *bridge.SchemaService
	Http            *bridge.HttpService
	Grpc            *bridge.GrpcService
	Collections     *bridge.CollectionsService
	Variables       *bridge.VariablesService
	ResponseHistory *bridge.ResponseHistoryService
	GrpcHistory     *bridge.GrpcHistoryService
	DataGrip        *bridge.DataGripService
	DbMcp           *bridge.DbMcpService
	KeepAwake       *bridge.KeepAwakeService
	Terminal        *bridge.TerminalService
	CustomScripts   *bridge.CustomScriptsService
	ScriptRuns      *bridge.ScriptRunsService
	Docker          *bridge.DockerService
	Update          *bridge.UpdateService
	Lifecycle       *bridge.LifecycleService

	beforeFlushOnce func()
	teardownOnce    func()
}

// Build wires every service. A settings read failure is the only error; main reports it fatal.
func Build(opts Options) (*Wired, error) {
	// P103 Part 3: repo-root internal/terminal's two process-constant vars, set once before any
	// Registry.Open: a spawned shell's TERM_PROGRAM/TERM_PROGRAM_VERSION env.
	terminal.TermProgram = opts.AppName
	terminal.TermProgramVersion = opts.Version

	startedAt := time.Now()
	repositories, db := opts.Repos, opts.DB

	secretsRepo := repos.NewSecrets(db.DB, opts.Cipher)
	// P5: the same "needs a Cipher, constructed separately from repos.New's aggregate" shape as
	// secretsRepo just above.
	repositories.Variables = repos.NewVariables(db.DB, opts.Cipher)
	// M5 §2.5/§3.2: the per-connection correlation key column, same "needs a Cipher" shape.
	maskKeysRepo := repos.NewMaskKeys(db.DB, opts.Cipher)
	maskRulesSvc := maskrules.New(repositories.MaskRules, maskKeysRepo)

	// P5 D8: the SAME authorizer instance connections.New below is given: that is what makes the
	// reveal grace genuinely shared between a connection-password reveal and a variable reveal.
	deps := appcore.Deps{
		DB:        db.DB,
		Home:      config.KiraHome(),
		StartedAt: startedAt.UnixMilli(),
		Repos:     repositories,
		ApiVars:   apivars.New(repositories.Variables, opts.Authorizer),
		MaskRules: maskRulesSvc,
	}

	// Read from the just-migrated (possibly still-default) settings row, same as production would
	// before any user override exists: the cache budget below needs it.
	settings, err := deps.Repos.Settings.GetAll()
	if err != nil {
		return nil, err
	}
	// P72 §9.2: match the stored advanced.logLevel rather than always booting at Info.
	logging.SetLevel(settings.Advanced.LogLevel)

	adaptersW := wireAdapters(&deps, settings, repositories, secretsRepo, opts.Cipher, opts.Authorizer, db)
	router, connectionsSvc := adaptersW.router, adaptersW.connectionsSvc
	oplogWiring, metricsTicker := adaptersW.oplogWiring, adaptersW.metricsTicker

	deps.Events = opts.Emitter

	// P66: the update-availability checker: no network call at all from a dev/test build
	// (appupdate's own isReleaseBuild guard); owns no goroutine, no ticker, no file handle, so
	// nothing is added to the quit teardown below.
	updateChecker := appupdate.NewChecker(appupdate.Studio.Name, opts.Version)
	// P119: the detached installer. It owns a child process only while staging: teardown below
	// cancels it so a Cmd+Q mid-download aborts the install rather than orphaning a bundle swap.
	updateInstaller := appupdate.NewInstaller(appupdate.Studio, opts.Version)

	embedded := wireEmbeddedServices(deps, opts.McpInstaller, opts.KeepAwakeDriver, connectionsSvc, oplogWiring, metricsTicker, opts.SmartTimeout)
	lifecycle := wireLifecycle(embedded.events, embedded.eventsDetach, metricsTicker, oplogWiring, connectionsSvc,
		embedded.dbMcpSvc, embedded.keepAwakeSvc, embedded.terminalSvc, updateInstaller, embedded.runs, repositories, db)

	w := &Wired{
		StartedAt: startedAt, Repos: repositories, Deps: deps, Router: router, Events: embedded.events,
		Windows: lifecycle.windows, CloseFlush: lifecycle.closeFlush, Quitter: lifecycle.quitter,
		TerminalRegistry: embedded.terminalSvc.Registry,
		OnWindowClosing: []func(string){func(key string) {
			docker.CloseWindowBound(embedded.dockerSvc.BoundService, key)
		}},

		App:             &bridge.AppService{Deps: deps},
		Settings:        &bridge.SettingsService{Deps: deps},
		Layout:          &bridge.LayoutService{Deps: deps},
		Tabs:            &bridge.TabsService{Deps: deps},
		WindowsSvc:      embedded.windowsSvc,
		Connections:     &bridge.ConnectionsService{Deps: deps},
		MaskRules:       &bridge.MaskRulesService{Deps: deps},
		Tree:            &bridge.TreeService{Deps: deps},
		Ops:             &bridge.OpsService{Deps: deps, Canceller: router},
		Filters:         &bridge.FiltersService{Deps: deps},
		Files:           &bridge.FilesService{Dialogs: opts.Dialogs},
		Queries:         &bridge.QueriesService{Deps: deps},
		Schema:          &bridge.SchemaService{Deps: deps},
		Http:            &bridge.HttpService{Deps: deps},
		Grpc:            &bridge.GrpcService{Deps: deps},
		Collections:     &bridge.CollectionsService{Deps: deps},
		Variables:       &bridge.VariablesService{Deps: deps},
		ResponseHistory: &bridge.ResponseHistoryService{Deps: deps},
		GrpcHistory:     &bridge.GrpcHistoryService{Deps: deps},
		DataGrip:        &bridge.DataGripService{Deps: deps},
		DbMcp:           embedded.dbMcpSvc,
		KeepAwake:       embedded.keepAwakeSvc,
		Terminal:        embedded.terminalSvc,
		CustomScripts:   &bridge.CustomScriptsService{Deps: deps},
		ScriptRuns:      embedded.scriptRuns,
		Docker:          embedded.dockerSvc,
		Update: &bridge.UpdateService{
			Checker: updateChecker, Installer: updateInstaller, Quit: lifecycle.quitter.RequestQuit,
		},
		Lifecycle: &bridge.LifecycleService{Flusher: lifecycle.quitter, WindowFlusher: lifecycle.closeFlush},

		beforeFlushOnce: lifecycle.beforeFlush,
		teardownOnce:    lifecycle.teardown,
	}
	return w, nil
}

// Bound returns the 28 bound services in registration order.
func (w *Wired) Bound() []application.Service {
	return []application.Service{
		application.NewService(w.App), application.NewService(w.Settings), application.NewService(w.Layout),
		application.NewService(w.Tabs), application.NewService(w.WindowsSvc), application.NewService(w.Connections),
		application.NewService(w.MaskRules), application.NewService(w.Tree), application.NewService(w.Ops),
		application.NewService(w.Filters), application.NewService(w.Files), application.NewService(w.Queries),
		application.NewService(w.Schema), application.NewService(w.Http), application.NewService(w.Grpc),
		application.NewService(w.Collections), application.NewService(w.Variables),
		application.NewService(w.ResponseHistory), application.NewService(w.GrpcHistory),
		application.NewService(w.DataGrip), application.NewService(w.DbMcp), application.NewService(w.KeepAwake),
		application.NewService(w.Terminal), application.NewService(w.CustomScripts), application.NewService(w.ScriptRuns), application.NewService(w.Docker),
		application.NewService(w.Update), application.NewService(w.Lifecycle),
	}
}

// BeforeFlush stops the metrics ticker and detaches window listeners; idempotent.
func (w *Wired) BeforeFlush() { w.beforeFlushOnce() }

// Teardown runs the ordered shutdown once; idempotent.
func (w *Wired) Teardown() { w.teardownOnce() }
