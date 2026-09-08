package main

import (
	"embed"
	"fmt"
	"log"
	"log/slog"
	"os"
	"path/filepath"
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
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/enginecache"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitsock"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitvsix"
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
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
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

// main's startup order mirrors src/main/index.ts (P52 §4.1), with the upgradeLegacySecrets step
// deleted, not ported (P52 §6.4): config.EnsureLayout -> logging.Init/Sweep -> storage.Open
// (migrates) -> secrets.New -> repos.New + repos.NewSecrets -> Settings.GetAll ->
// adapterhost.NewRouter -> preconnect.New -> connections.New(...).Start -> tree.New ->
// router.PushCacheConfig -> oplog.New(...).Start -> metrics ticker Start -> shell.NewQuitter ->
// application.New(Services, ShouldQuit, OnShutdown) -> attach the deferred emitter and the
// Quitter to the now-real App -> menu -> engine stream -> reopen handler -> the main window ->
// app.Run() (P56 §4.11). There is no Node engine child to start any more (P58f M10 Phase 4).
func main() {
	// G7 D8: the askpass helper's whole entry point — four lines, unambiguous (a real GUI launch
	// has no argv), and returns before anything Wails-related runs, so it can never accidentally
	// start a window. The shim `main.go`'s own broker below writes execs this exact binary this way.
	if len(os.Args) > 1 && os.Args[1] == "askpass" {
		os.Exit(gitaskpass.RunHelper(os.Args[2:], os.Environ(), os.Stdout))
	}

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
	// P5: the same "needs a Cipher, constructed separately from repos.New's aggregate" shape as
	// secretsRepo just above.
	repositories.Variables = repos.NewVariables(db.DB, cipher)

	// G1 §3.7: the git socket listener. Start's error is logged, never fatal (D5) — the app must
	// boot even when the git socket could not, e.g. a second instance already serving it.
	// G2 D18/D19: repository lifecycle moves to a refcounted gitsession.Registry, shared across
	// every connection, with gitrpc rebuilt as a per-connection Router over it.
	gitRunner := gitclient.NewExecRunner()
	gitDiscovery := gitclient.NewDiscovery(gitclient.NewPlatformLocator(), gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
	// G7 D16: the server-owned settings a remote op reads fresh on every push pre-flight/run and
	// every auto-fetch tick — never cached, since a stale protected-branch list is a safety bug.
	gitRegistry.Settings = func() (protectedBranches []string, autoFetchMinutes int) {
		s, err := repositories.Settings.GetAll()
		if err != nil {
			slog.Warn("read git settings", "scope", "git", "err", err)
			return nil, 0
		}
		return s.Git.ProtectedBranches, s.Git.FetchAutoIntervalMinutes
	}
	// G7 D8: a broker that fails to start is logged and left nil — every remote op then runs with
	// no askpass interposition at all, D10's own already-supported "user's own askpass wins" path,
	// not a new failure mode. It must never be fatal to boot (same posture as the socket below).
	askpassBroker, err := gitaskpass.New(gitaskpass.Options{})
	if err != nil {
		slog.Warn("start askpass broker", "scope", "startup", "err", err)
		askpassBroker = nil
	}
	gitSock := gitsock.New(gitsock.Deps{
		SocketPath: filepath.Join(config.KiraHome(), "git.sock"),
		LockPath:   filepath.Join(config.KiraHome(), "git.sock.lock"),
		Clients:    repositories.GitClients,
		Registry:   gitRegistry,
		Router: gitrpc.New(gitrpc.Deps{
			Discovery: gitDiscovery, Runner: gitRunner, Registry: gitRegistry, ServerVersion: buildinfo.Version,
			Askpass: askpassBroker,
		}),
		ServerVersion: buildinfo.Version,
		Now:           time.Now,
	})
	if err := gitSock.Start(); err != nil {
		slog.Warn("git socket listener", "scope", "startup", "err", err)
	}
	// P5 D8: the SAME authorizer instance connections.New below is given — that is what makes the
	// reveal grace genuinely shared between a connection-password reveal and a variable reveal.
	apiVarsSvc := apivars.New(repositories.Variables, cipher, authorizer)

	deps := appcore.Deps{
		DB:        db.DB,
		StartedAt: startedAt.UnixMilli(),
		Repos:     repositories,
		ApiVars:   apiVarsSvc,
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
	eventsDetach := events.Attach(bridge.Sources{Connections: connectionsSvc, Oplog: oplogWiring, Metrics: metricsTicker, Git: gitSock})

	// windows holds every currently open window's shell.Attach cleanup, keyed by that window's own
	// identity (P8 C2, replacing the single detachWindow/mainWindow pair that only ever worked
	// because at most one window could exist at a time — F4). beforeFlush detaches every one of
	// them, not just the most recently created (P2 R1's finding, generalised past one window).
	windows := shell.NewWindowRegistry()

	// closeFlush routes each window's own "flush before close" ack back to whichever
	// shell.AttachCloseFlush hook is waiting for it (P8 C6, F8's fix) — a separate handshake from
	// the quit one below: at most one window is ever waiting at a time.
	closeFlush := shell.NewCloseFlushCoordinator()

	// G12 D8: assigned below, once `app` exists — declared here (nil until then) so `teardown`
	// (which is defined before `app` is) can still close over the real value by reference.
	var unsubscribePairing func()

	// teardown is today's OnShutdown, minus the ticker Stop (which moves to beforeFlush, run
	// before the flush wait rather than after it — P56 D3/index.ts:156).
	beforeFlush := sync.OnceFunc(func() {
		metricsTicker.Stop()
		windows.DetachAll()
	})
	teardown := sync.OnceFunc(func() {
		eventsDetach()
		if unsubscribePairing != nil {
			unsubscribePairing()
		}
		oplogWiring.Stop()
		connectionsSvc.Shutdown()
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

	// G12 D8: the pairing-request fallback when no Kira Studio window exists to focus. NOT
	// registered as a Wails service (application.NewService) — a service's ServiceStartup error
	// is fatal to the whole app (application.go's startup() returns it straight through Run()),
	// and this one's Startup fails by design outside a packaged, signed .app (checkBundleIdentifier,
	// notifications_darwin.go) as well as on any Linux desktop with no D-Bus session bus reachable
	// (confirmed here: registering it made the server binary exit 1 before ever starting). D8's
	// own text already expects RequestNotificationAuthorization/SendNotification to fail softly
	// outside a packaged app; the service's *registration* must never be what takes the app down
	// first. Calling its methods directly, with no Wails service lifecycle, sidesteps that.
	notifier := notifications.New()

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
			application.NewService(&bridge.HttpService{Deps: deps}),
			application.NewService(&bridge.GrpcService{Deps: deps}),
			application.NewService(&bridge.CollectionsService{Deps: deps}),
			application.NewService(&bridge.VariablesService{Deps: deps}),
			application.NewService(&bridge.ResponseHistoryService{Deps: deps}),
			application.NewService(&bridge.GrpcHistoryService{Deps: deps}),
			application.NewService(&bridge.DataGripService{Deps: deps}),
			application.NewService(&bridge.GitClientsService{Deps: deps, Sock: gitSock, Broker: gitSock.Broker(), Vsix: gitvsix.New(gitvsix.Deps{})}),
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
	// G12 D8 reuses this same "which window" resolution for the pairing activator below — the
	// only other place in the tree that legitimately answers the same question.
	windowToActOn := func() application.Window {
		if w := app.Window.Current(); w != nil {
			return w
		}
		return windows.Any()
	}
	attachDialogs(app, windowToActOn)

	// G12 D8/F4, revised by G14 D4: brings Kira Studio to the front the moment a pairing request is
	// enqueued, *and* posts a system notification the user can act on without ever finding that
	// window — window activation alone is routinely demoted to a bouncing Dock icon and is
	// invisible under a full-screen space or a second display (F6), so it is now the accompaniment
	// rather than the sole mechanism. Lives here, not in internal/gitsock, because it is the only
	// place in the tree that legitimately imports both gitsock and application (the layering
	// test's own rule).
	var lastPresentedPairingID string
	unsubscribePairing = gitSock.OnPairingChanged(func(snap gitsock.PairingSnapshot) {
		if snap.Pending == nil {
			// The request that was presented resolved (approved/denied/timed out) without a fresh
			// one taking its place — withdraw its notification so Notification Centre never keeps
			// a live Approve/Deny button for something already decided.
			if lastPresentedPairingID != "" {
				withdrawPairingNotification(notifier, lastPresentedPairingID)
			}
			lastPresentedPairingID = "" // the edge latch: a future request is a fresh "just arrived".
			return
		}
		// Only the head of the queue *newly arriving* is worth presenting again; a snapshot
		// emitted because the count behind it changed re-presents the same RequestID and is not.
		if snap.Pending.RequestID == lastPresentedPairingID {
			return
		}
		if lastPresentedPairingID != "" {
			withdrawPairingNotification(notifier, lastPresentedPairingID)
		}
		lastPresentedPairingID = snap.Pending.RequestID
		req := snap.Pending
		// Notify first, always — the user who is not looking at Kira Studio needs this to be
		// what tells them. Then, if a window exists, bring it forward too: a user who *is*
		// looking at Kira Studio still gets the in-app dialog in front of them.
		notifyPairingPending(notifier, req)
		if w := windowToActOn(); w != nil {
			// Runs on the broker's own goroutine — never block it on the UI thread.
			application.InvokeAsync(func() {
				w.Show()
				w.Restore()
				w.Focus()
			})
		}
	})

	// G14 D4: routes a tapped notification action straight onto the broker — the single authority
	// over a pairing decision (SPEC §3.3) — without any state of our own. A stale action (already
	// approved/denied/timed out in the window) is a lookup miss the broker itself already answers
	// with a non-Resolved PairingActionResult; that is not surfaced as an error here, since nothing
	// about the trust model changes and the broker already logged it. Tapping the notification's
	// body (not a button) is never an implicit approve — it only brings the window forward, same
	// as the fallback above, so the in-app dialog can answer it.
	notifier.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error != nil {
			slog.Debug("git pairing: notification response error", "scope", "gitsock", "err", result.Error)
			return
		}
		requestID, _ := result.Response.UserInfo["requestId"].(string)
		if requestID == "" {
			return
		}
		switch result.Response.ActionIdentifier {
		case pairingApproveActionID:
			gitSock.Broker().Approve(requestID)
		case pairingDenyActionID:
			gitSock.Broker().Deny(requestID)
		case notifications.DefaultActionIdentifier:
			if w := windowToActOn(); w != nil {
				application.InvokeAsync(func() {
					w.Show()
					w.Restore()
					w.Focus()
				})
			}
		}
	})

	shell.RegisterEngineStream(app, router)

	windowDeps := shell.WindowDeps{Windows: repositories.Windows, StartedAt: startedAt}

	// openWindow opens one workbench from an already-persisted record and registers it — the one
	// path every window (startup, reopen, "New Window") ultimately goes through. Its own
	// WindowClosing listener implements D5: delete the row only if another window remains open,
	// so closing the last window leaves it behind for the next Dock click or relaunch to restore.
	//
	// primaryWorkArea (shell.Options' first-launch size clamp, P22 D6(a)) is resolved fresh here,
	// on every call, rather than captured once before app.Run() — round-2 review finding 4:
	// GetPrimary() is backed by a cache macOS only starts populating once its native run loop's
	// ApplicationDidFinishLaunching fires (application_darwin.go's own `run()`), which happens
	// only after C.run() — i.e. strictly after app.Run() is called, never before. A value captured
	// before Run() is therefore permanently nil for every window opened this way, including
	// "New Window" and Dock-reopen, even though those happen well after Run() and the cache is
	// long since populated by the time they run. Resolving it per call fixes that for them.
	// It can NOT fix the very first window(s) opened at startup, below (line ~342): those are
	// still created before app.Run() ever runs, so no ordering of this lookup changes their
	// primaryWorkArea, which stays nil — first real launch keeps the unclamped 1280×800 default
	// until the window is resized once (DefaultBounds' own doc comment). Deferring startup window
	// creation until after ApplicationDidFinishLaunching would close that gap but is a materially
	// larger structural change, out of scope for this fix.
	openWindow := func(rec model.WindowRecord) {
		var primaryWorkArea *application.Rect
		if screen := app.Screen.GetPrimary(); screen != nil {
			primaryWorkArea = &screen.WorkArea
		}
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

// G14 D4: the category ID and the two action identifiers OnNotificationResponse switches on above.
const (
	pairingCategoryID      = "kira.git.pairing"
	pairingApproveActionID = "approve"
	pairingDenyActionID    = "deny"
)

// pairingNotificationID is the one ID both notifyPairingPending and withdrawPairingNotification
// address a request's notification by.
func pairingNotificationID(requestID string) string {
	return "kira-git-pairing-" + requestID
}

// notifyPairingPending is D4's system notification for a pairing request — SPEC §3.3 deliberately
// holds the request rather than spawning one, and this is now the *first* way the user learns
// about it (F6), not a fallback for "no window". It carries Approve/Deny actions, routed back onto
// the broker by OnNotificationResponse above. Two real limits, not bugs: it only works in a
// packaged, signed .app (notifications.New's darwin impl refuses without a bundle identifier —
// logged at Debug and otherwise ignored, since a developer running from source has a terminal and
// a window); and authorization is requested lazily here, on first actual use, never at startup —
// asking before the app has any reason to notify is exactly what a good macOS app avoids. A denial
// is terminal for this process and is logged once, via notificationsDenied.
var notificationsDenied bool

// pairingCategoryRegistered: the category is registered once, lazily, the first time a request
// needs it — never at startup, same rule as authorization above.
var pairingCategoryRegistered bool

// notifierCallGuard: everywhere else in this file, an unavailable notifications backend degrades
// softly because the pinned module reports it as an `error` (checked and logged at Debug above and
// below). Linux is the one exception, confirmed against the pinned module's own source rather than
// assumed: `RequestNotificationAuthorization` is a plain stub that always returns `(true, nil)`,
// with no check that a D-Bus session bus is actually reachable, so an unregistered notifier (G12
// D8's own deliberate choice, restated by D4 above) can panic on a nil D-Bus connection the moment
// a real send is attempted — not an error this file's own `if err != nil` handling ever sees. That
// is a real crash observed in this container (no session bus) — a platform this app does not
// target, but one its own dev loop and CI still run on, and a git pairing request must never be
// able to take the whole process down. recover() is what makes every notifier call below degrade
// exactly as softly as its documented-error siblings already do.
func notifierCallGuard(fn func() error) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("notifications backend panicked: %v", r)
		}
	}()
	return fn()
}

func notifyPairingPending(notifier *notifications.NotificationService, req *gitsock.PairingRequest) {
	if notificationsDenied {
		return
	}
	granted, err := notifier.RequestNotificationAuthorization()
	if err != nil {
		slog.Debug("git pairing: notification authorization unavailable", "scope", "gitsock", "err", err)
		return
	}
	if !granted {
		notificationsDenied = true
		slog.Info("git pairing: notification authorization denied; pairing requests will not surface a notification for the rest of this session")
		return
	}
	if !pairingCategoryRegistered {
		pairingCategoryRegistered = true
		if err := notifierCallGuard(func() error {
			return notifier.RegisterNotificationCategory(notifications.NotificationCategory{
				ID: pairingCategoryID,
				Actions: []notifications.NotificationAction{
					{ID: pairingApproveActionID, Title: "Approve"},
					{ID: pairingDenyActionID, Title: "Deny", Destructive: true},
				},
			})
		}); err != nil {
			slog.Debug("git pairing: register notification category", "scope", "gitsock", "err", err)
		}
	}
	if err := notifierCallGuard(func() error {
		return notifier.SendNotificationWithActions(notifications.NotificationOptions{
			ID:         pairingNotificationID(req.RequestID),
			Title:      "Kira Studio",
			Subtitle:   req.Label,
			Body:       "wants to connect to your git backend.",
			CategoryID: pairingCategoryID,
			Data:       map[string]any{"requestId": req.RequestID},
			// TimeSensitive, not Critical: this is what breaks through a Focus mode. Critical
			// additionally overrides Do Not Disturb *and mute*, needs a special Apple
			// entitlement, and is for alarms — a pairing prompt is not one.
			InterruptionLevel: notifications.InterruptionLevelTimeSensitive,
		})
	}); err != nil {
		slog.Debug("git pairing: send notification", "scope", "gitsock", "err", err)
	}
}

// withdrawPairingNotification removes a request's delivered notification once it has resolved
// elsewhere (approved/denied in-window, timed out, or superseded by a new head) — so Notification
// Centre never keeps a live Approve/Deny button for something already decided.
func withdrawPairingNotification(notifier *notifications.NotificationService, requestID string) {
	if err := notifierCallGuard(func() error {
		return notifier.RemoveDeliveredNotification(pairingNotificationID(requestID))
	}); err != nil {
		slog.Debug("git pairing: remove delivered notification", "scope", "gitsock", "err", err)
	}
}
