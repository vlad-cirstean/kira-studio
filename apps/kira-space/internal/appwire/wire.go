package appwire

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/adeflow"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentnotify"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/buildinfo"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/claudeusage"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitcred"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/mobileterm"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/oplog"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/claudeheadless"
	"github.com/kirathecat/kira-studio/internal/memory"
	memembed "github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/memorycli"
	"github.com/kirathecat/kira-studio/internal/memory/modelstore"
	"github.com/kirathecat/kira-studio/internal/scriptruns"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// RunArgvShim runs the askpass, memory-mcp and memory-embed subcommands, before anything
// Wails-related, so they never start a window. memory-mcp is Claude Code's stdio MCP server; it runs
// before startupfail and the single-instance lock, so it works while the window is open.
// memory-embed is the ONNX embedding worker those processes and the app spawn; same ordering for
// the same reason.
func RunArgvShim(args []string) (code int, ok bool) {
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
	}
	return 0, false
}

// removeRetiredModels deletes model directories no feature loads any more (P224).
func removeRetiredModels() {
	if err := modelstore.RemoveRetired(memory.Home()); err != nil {
		slog.Warn("remove retired models", "scope", "memory", "err", err)
	}
}

// gitWired is wireGit's own result.
type gitWired struct {
	runner        gitclient.Runner
	discovery     *gitclient.Discovery
	registry      *gitsession.Registry
	askpassBroker *gitaskpass.Broker
	router        *gitrpc.Router
	opLog         *oplog.Log
}

// wireTracker constructs and starts the ade.Tracker and the agenthooks.Manager it drives, wired
// together before any window exists so Compose never races an unset hooks func with a real launch.
// Rows a previous process life left running are stopped by the task board's Recover.
func wireTracker(
	repositories *repos.Repos, registry *terminal.Registry, emitter appevent.Emitter, events *bridge.Events,
	grace time.Duration, notifier *agentnotify.Notifier, usage *claudeusage.Service,
) (*ade.Tracker, *agenthooks.Manager) {
	tracker := ade.NewTracker(ade.TrackerDeps{
		Store: repositories.AdeSessions, LiveAgents: registry.AgentSessions,
		WriteTerminal: registry.Write, Now: time.Now, Grace: grace,
		OnChange: func() { bridge.AdeTaskSessionsChanged(events) },
	})

	// Hooks are always on: a start failure (curl missing, a bind conflict) is logged, never fatal —
	// sessions still spawn and track, activity icons stay absent.
	hooks := agenthooks.NewManager(agenthooks.Options{
		OnEvent: func(ev agenthooks.Event) {
			tracker.HandleEvent(ev)
			bridge.EmitAgentEvent(emitter, ev)
			notifier.HandleEvent(ev)
		},
		StatusLine: usageEnabled(repositories),
		OnStatusLine: func(_ string, rl agenthooks.RateLimits) {
			var five, seven *claudeusage.Window
			if rl.FiveHour != nil {
				five = claudeusage.FromSession(rl.FiveHour.UsedPercentage, rl.FiveHour.ResetsAt)
			}
			if rl.SevenDay != nil {
				seven = claudeusage.FromSession(rl.SevenDay.UsedPercentage, rl.SevenDay.ResetsAt)
			}
			usage.Ingest(claudeusage.SourceSession, five, seven)
		},
	})
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
func closeTaskReviewWindows(repositories *repos.Repos, closeWindow func(key string) bool) func(taskID string) {
	return func(taskID string) {
		keys, err := repositories.AdeReview.KeysByTask(taskID)
		if err != nil {
			slog.Warn("ade: list review windows", "scope", "ade", "task", taskID, "err", err)
			return
		}
		for _, k := range keys {
			closeWindow(k)
		}
	}
}

// wireAdeTask builds the v2 task board engine (P144): its own Conn, the workflow reader over
// <home>/workflows, and the cached git discovery gating merge-tree checks. It recovers rows a
// restart left running, then starts the board.
func wireAdeTask(
	repositories *repos.Repos, events *bridge.Events, git gitWired, tracker *ade.Tracker, closeTerminal func(string) error,
	closeReviewWindows func(taskID string), credentials *gitcred.Relay, keepAwake *bridge.KeepAwakeService,
	notifier *agentnotify.Notifier, usage *claudeusage.Service, rebaseTimeout time.Duration, runs *scriptruns.Service,
) *ade.TaskBoard {
	userHome, err := os.UserHomeDir()
	if err != nil {
		slog.Warn("ade: user home", "scope", "ade", "err", err)
	}
	gitPath := adeGitPathSetting(repositories)
	board := ade.NewTaskBoard(ade.TaskBoardDeps{
		Tasks: repositories.AdeTasks, Backlog: repositories.AdeBacklog, RepoConfig: repositories.AdeRepoConfig,
		CodeRepos: repositories.CodeRepos, GitRepoSettings: repositories.GitRepoSettings.Get,
		Registry:        git.registry,
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
		OnRuns: func(ev adewire.RunsChangedEvent) {
			bridge.AdeTaskRunsChanged(events, ev)
			notifier.HandleRuns(ev.Runs)
		},
		OnLog: func(ev adewire.LogEvent) { bridge.AdeTaskLogAppended(events, ev) },
		OnRateLimits: func(rl claudeheadless.RateLimits) {
			var five, seven *claudeusage.Window
			if rl.FiveHour != nil {
				five = claudeusage.FromRun(rl.FiveHour.Utilization, rl.FiveHour.ResetsAt)
			}
			if rl.SevenDay != nil {
				seven = claudeusage.FromRun(rl.SevenDay.Utilization, rl.SevenDay.ResetsAt)
			}
			usage.Ingest(claudeusage.SourceRun, five, seven)
		},
		OnSessions: func() {
			bridge.AdeTaskSessionsChanged(events)
			bridge.KeepAwakeRecompute(keepAwake)
		},
		CustomScripts: runs.Scripts, ScriptsHome: runs.Home,
		ScriptRunsOf: func(taskID string, limit int) ([]scriptruns.Run, error) { return runs.List(limit, taskID) },
		AgentDir:     filepath.Join(config.KiraSpaceHome(), "ade", "runs"),
		HeadlessSettingSources: func() string {
			settings, err := repositories.Settings.GetAll()
			if err != nil {
				return ""
			}
			return settings.Ade.HeadlessSettingSources
		},
		AutofetchMinutes: adeAutofetchMinutes(repositories),
		HomeDir:          userHome,
		RebaseTimeout:    rebaseTimeout,
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

// adeGitPathSetting reads git.gitPath verbatim ("" by default). Not an executable: only
// Discovery.Status resolves it to one, so the board opens repos with GitStatus().Path.
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
// git.fetchAutoIntervalMinutes into the board, the same leaf gitRegistry.Settings (wireGit)
// already reads.
func adeAutofetchMinutes(repositories *repos.Repos) func() int {
	return func() int {
		settings, err := repositories.Settings.GetAll()
		if err != nil {
			return 0
		}
		return settings.Git.FetchAutoIntervalMinutes
	}
}

// adeCloseTerminal is the board's CloseTerminal seam — terminal.Registry.Close never errors, so
// this just satisfies the func(id string) error signature.
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

// wireGit builds the git runner, discovery (over locator), session registry and router.
func wireGit(repositories *repos.Repos, locator gitclient.Locator, ghLocator ghclient.Locator) gitWired {
	gitRunner := gitclient.NewExecRunner()
	gitDiscovery := gitclient.NewDiscovery(locator, gitRunner, gitclient.NewRealClock())
	gitRegistry := gitsession.NewRegistry(gitRunner)
	if ghLocator != nil {
		gitRegistry.Gh = ghclient.NewClient(
			ghclient.NewDiscovery(ghLocator, ghclient.NewExecRunner(), ghclient.NewRealClock()), ghclient.NewExecRunner())
	}
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
	return gitWired{
		runner: gitRunner, discovery: gitDiscovery, registry: gitRegistry,
		askpassBroker: askpassBroker, router: gitRouter, opLog: opLog,
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

// notifyPrefs reads the claudeCode.notify* leaves; a read failure turns notifications off.
// usageEnabled reads claudeCode.usageEnabled fresh; a read failure counts as on (the default).
func usageEnabled(repositories *repos.Repos) func() bool {
	return func() bool {
		s, err := repositories.Settings.GetAll()
		if err != nil {
			return true
		}
		return s.ClaudeCode.UsageEnabled
	}
}

func notifyPrefs(repositories *repos.Repos) func() agentnotify.Prefs {
	return func() agentnotify.Prefs {
		s, err := repositories.Settings.GetAll()
		if err != nil {
			slog.Warn("notify: read settings", "scope", "notify", "err", err)
			return agentnotify.Prefs{}
		}
		c := s.ClaudeCode
		return agentnotify.Prefs{
			Enabled: c.NotifyEnabled, OnFinished: c.NotifyOnFinished, OnNeedsInput: c.NotifyOnNeedsInput,
			OnRunEnded: c.NotifyOnRunEnded, IncludeMessage: c.NotifyIncludeMessage,
		}
	}
}

// describeAgent names what a hook event belongs to: the ADE task, else the code repository whose
// root holds cwd, else cwd's basename. Terminal tabs are not persisted, so no tab row exists.
func (w *Wired) describeAgent(terminalID, cwd string) agentnotify.Target {
	t := agentnotify.Target{}
	t.WindowKey, _ = w.TermRegistry.WindowOf(terminalID)
	if recordID, ok := w.Tracker.RecordOf(terminalID); ok {
		t.RecordID = recordID
		if rec, err := w.Tracker.Get(recordID); err == nil && rec != nil {
			t.TaskID = rec.TaskID
			if title := w.taskTitle(rec.TaskID); title != "" {
				t.Name = title
			}
		}
	}
	if t.Name == "" {
		t.Name = w.repoNameFor(cwd)
	}
	return t
}

func (w *Wired) taskTitle(taskID string) string {
	task, err := w.Repos.AdeTasks.GetTask(taskID)
	if err != nil {
		return ""
	}
	return task.Title
}

// repoNameFor is the name of the code repository with the longest root holding cwd.
func (w *Wired) repoNameFor(cwd string) string {
	if cwd == "" {
		return "Claude session"
	}
	repoList, err := w.Repos.CodeRepos.List()
	best, name := -1, ""
	if err == nil {
		for _, r := range repoList {
			if r.Root != "" && (cwd == r.Root || strings.HasPrefix(cwd, strings.TrimRight(r.Root, "/")+"/")) && len(r.Root) > best {
				best, name = len(r.Root), r.Name
			}
		}
	}
	if name == "" {
		return filepath.Base(cwd)
	}
	return name
}

// revealNote answers a notification click: focus the owning window and tell it what to show.
func (w *Wired) revealNote(n agentnotify.Note) {
	focus := w.AdeTask.FocusWindow
	if focus == nil {
		focus = w.Windows.Focus
	}
	if n.RecordID != "" {
		if ok, err := w.AdeTask.FocusSession(context.Background(), adewire.FocusSessionArgs{SessionID: n.RecordID}); err == nil && ok {
			return
		}
	}
	if n.TerminalID != "" {
		if key, ok := w.TermRegistry.WindowOf(n.TerminalID); ok && focus(key) {
			w.Emitter.EmitTo(key, bridge.ChannelAgentRevealTerminal, map[string]string{"terminalId": n.TerminalID})
			return
		}
	}
	if key, ok := w.Windows.MainKey(); ok {
		focus(key)
		if n.ScriptRunID != "" {
			w.Emitter.EmitTo(key, bridge.ChannelAgentRevealScriptRun, map[string]string{"runId": n.ScriptRunID, "label": n.Title})
			return
		}
		if n.TaskID != "" {
			w.Emitter.EmitTo(key, bridge.ChannelAgentRevealTask, map[string]string{"taskId": n.TaskID})
		}
	}
}
