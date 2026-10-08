// Package ade is Kira Space's ADE engine: the task board, the run engine and the Claude Code session
// tracker, over the shared internal/terminal and internal/agenthooks packages. No
// apps/kira-space/internal/bridge import (layering_test.go rule); bridge/adetask.go is the one
// place that turns it into a Wails-bound surface.
package ade

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// defaultGrace/defaultPendingTTL are TrackerDeps' own zero-value defaults, applied by NewTracker.
const (
	defaultGrace      = 30 * time.Second
	defaultPendingTTL = 2 * time.Minute
	// launchGuardWindow bounds how long an uncomposed intent blocks a repeat launch: it covers the
	// double-click and the terminal mount round trip, not an abandoned launch.
	launchGuardWindow = 10 * time.Second
	defaultClaudeBin  = "claude"
)

// Sentinel errors Prepare/Compose/Send return — bridge/adetask.go maps each to an invalid-input
// error; anything else is internal.
var (
	ErrSessionNotFound   = errors.New("ade: session not found")
	ErrSessionWrongTask  = errors.New("ade: session belongs to another task")
	ErrSessionRunning    = errors.New("ade: session is already running")
	ErrSessionNotRunning = errors.New("ade: session is not running")
	ErrCommandMismatch   = errors.New("ade: composed command does not match the prepared command")
	// ErrResumeCwdNotDir: a resume's recorded cwd exists but is a file, not a directory.
	ErrResumeCwdNotDir = errors.New("ade: resume cwd exists and is not a directory")
)

// TrackerDeps is everything Tracker needs from the rest of the app — a plain struct of seams, the
// same "declare small interfaces, pass funcs" discipline this app's bridge packages already use,
// so a test can fake each one independently (tracker_test.go passes an in-memory LiveAgents/
// WriteTerminal and a fixed Now).
type TrackerDeps struct {
	Store         *repos.AdeSessionsRepo
	LiveAgents    func() []terminal.AgentSession
	WriteTerminal func(terminalID string, data []byte) error
	Now           func() time.Time
	// OnChange is called whenever a persisted record's own state changes (a new or revived
	// session, a stop, a claude_session_id update after /clear) — main.go wires it to
	// bridge.AdeTaskSessionsChanged, never called with the lock held.
	OnChange func()
	// OnStopped is called with a record id after Reconcile marked it stopped (its terminal is gone);
	// the v2 engine releases per-session state here. Never called with the lock held.
	OnStopped func(recordID string)
	// Grace/PendingTTL default to defaultGrace/defaultPendingTTL when zero — a test shortens Grace
	// to make Reconcile's own grace-window behaviour observable in milliseconds, not 30 real
	// seconds.
	Grace      time.Duration
	PendingTTL time.Duration
	// ClaudeBin defaults to "claude" when empty. Exists only so ade_test.go's integration test can
	// point it at an absolute path to a fake script — this container's own login-shell PATH always
	// resolves a bare "claude" to the real installed CLI ahead of anything a test could prepend
	// (every /etc/profile.d/*.sh script re-prepends its own bin dir), which would make a hermetic
	// fake-CLI test impossible without this seam. Production never sets it.
	ClaudeBin string
}

// pendingIntent is one PrepareLaunch call's own record, keyed by the terminalId Prepare mints —
// consumed exactly once, by the Compose call the renderer's own openTerminalSession triggers.
type pendingIntent struct {
	RecordID                                   string
	ClaudeSessionID                            string
	Cwd                                        string
	Command                                    string // the exact base command Prepare returned; Compose refuses a mismatch
	Message                                    string
	Resume                                     bool
	CreatedAt                                  time.Time
	TaskID, BranchID, StageID, StepID, Resumes string
	Purpose                                    string
}

// PrepareArgs is Prepare's own argument shape. TaskID is required: the row is keyed to the task,
// branch ("" = task level), stage and step. Cwd is an absolute existing directory.
type PrepareArgs struct {
	Cwd string
	// Resume is "" for a new session, or an existing ade_sessions.id to resume.
	Resume  string
	Message string
	// Resumes is the Claude session id a new record continues (`claude --resume`), ExtraArgs are
	// added to the base command, quoted.
	TaskID, BranchID, StageID, StepID, Resumes string
	ExtraArgs                                  []string
	// Purpose is "" or model.AdeSessionPurposeReview for the task's review agent.
	Purpose string
}

// PrepareResult is Prepare's own return shape. SessionID is the Claude session id (stable across
// Compose but not across a /clear inside the session); Command is the base launch, without hooks
// or a prompt — Compose adds both. Cwd is the effective cwd: args.Cwd for a new launch,
// existing.Cwd for a resume — the caller opens the terminal there, so the PTY and the record
// always agree.
type PrepareResult struct {
	TerminalID string
	// RecordID is the ade_sessions row id (the handle Send and FocusSession take); SessionID is the
	// Claude session id.
	RecordID  string
	SessionID string
	Command   string
	Cwd       string
}

// Tracker is Kira Space's own agent session tracker (§4.4) — one instance, constructed in main.go
// and shared by BoundService.ComposeAgent (via Compose), Registry.OnChange (via Reconcile),
// agenthooks.Manager's OnEvent (via HandleEvent) and AdeTaskService (via Send/Get).
type Tracker struct {
	deps TrackerDeps

	mu sync.Mutex
	// pending: terminalId -> intent, from Prepare, consumed by Compose, pruned after PendingTTL.
	pending map[string]pendingIntent
	// live/byRecord: the two directions of the same relationship, kept in sync under mu — live for
	// Reconcile's own "is this terminal still alive" walk, byRecord for Send's "which terminal does
	// this record write to" lookup.
	live     map[string]string // terminalId -> recordId
	byRecord map[string]string // recordId -> terminalId
	// spawnedAt is Compose's own grace-window clock (§4.4: Compose runs before the PTY registers,
	// so a Reconcile racing the spawn must not stop a record that only just started).
	spawnedAt map[string]time.Time
	// lastActive is the in-memory activity clock every hook event bumps; flushed to the DB only on
	// Stop/SessionEnd, on the grace-timeout Reconcile that stops a record, and on Close — not on
	// every event, which would be one DB write per tool call.
	lastActive map[string]int64
	// claudeSessionID caches each live record's own current Claude session id, so HandleEvent can
	// detect a SessionStart naming a different one (a /clear) without a DB read on every event.
	claudeSessionID map[string]string
	// fresh marks records Compose inserted (not resumed), so Abort deletes rather than stops them.
	fresh map[string]bool

	hooks func(terminalID, command string) (string, []string)

	// graceTimers are Compose's pending Reconcile timers, stopped by Close; graceWG waits for a
	// callback already running.
	graceTimers map[string]*time.Timer
	graceWG     sync.WaitGroup
	closed      bool
}

// NewTracker applies TrackerDeps' own defaults and constructs a Tracker with empty state.
// TaskBoard.Recover reconciles rows left by a previous process life.
func NewTracker(deps TrackerDeps) *Tracker {
	if deps.Grace <= 0 {
		deps.Grace = defaultGrace
	}
	if deps.PendingTTL <= 0 {
		deps.PendingTTL = defaultPendingTTL
	}
	if deps.ClaudeBin == "" {
		deps.ClaudeBin = defaultClaudeBin
	}
	return &Tracker{
		deps:            deps,
		pending:         map[string]pendingIntent{},
		live:            map[string]string{},
		byRecord:        map[string]string{},
		spawnedAt:       map[string]time.Time{},
		lastActive:      map[string]int64{},
		claudeSessionID: map[string]string{},
		fresh:           map[string]bool{},
		graceTimers:     map[string]*time.Timer{},
	}
}

// SetStoppedHandler installs TrackerDeps.OnStopped after construction: the handler's owner (the v2
// engine) is built after the tracker. Call it before any window exists.
func (t *Tracker) SetStoppedHandler(fn func(recordID string)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.deps.OnStopped = fn
}

// SetHooks installs the launch-composition callback (agenthooks.Manager.ComposeLaunch) — called
// once in main.go before any window exists, so Compose never races an unset hooks func with a
// real launch.
func (t *Tracker) SetHooks(fn func(terminalID, command string) (string, []string)) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hooks = fn
}

func (t *Tracker) hooksFn() func(string, string) (string, []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.hooks
}

// pruneExpiredPendingLocked drops any pending intent older than PendingTTL — called with mu held,
// from Prepare, so an abandoned PrepareLaunch (the renderer never mounted the terminal) cannot
// accumulate forever. It returns the dropped intents' record ids for releaseExpired.
func (t *Tracker) pruneExpiredPendingLocked(now time.Time) []string {
	var expired []string
	for id, intent := range t.pending {
		if now.Sub(intent.CreatedAt) > t.deps.PendingTTL {
			delete(t.pending, id)
			expired = append(expired, intent.RecordID)
		}
	}
	return expired
}

// releaseExpired tells OnStopped about intents that never composed, so per-session state a launch
// registered (an agent MCP grant) goes with them. mu must not be held.
func (t *Tracker) releaseExpired(recordIDs []string) {
	if len(recordIDs) == 0 {
		return
	}
	t.mu.Lock()
	onStopped := t.deps.OnStopped
	t.mu.Unlock()
	if onStopped == nil {
		return
	}
	for _, id := range recordIDs {
		onStopped(id)
	}
}

// Prepare validates a launch request against the store (§4.4's own table), mints a fresh
// terminalId and records a pending intent for the Compose call the renderer's own
// openTerminalSession is about to trigger.
func (t *Tracker) Prepare(args PrepareArgs) (PrepareResult, error) {
	if args.TaskID == "" {
		return PrepareResult{}, fmt.Errorf("%w: taskId is required", ErrInvalidInput)
	}
	now := t.deps.Now()

	var recordID, claudeSessionID, cwd string
	if args.Resume == "" {
		recordID = uuid.NewString()
		claudeSessionID = uuid.NewString()
		if args.Resumes != "" {
			claudeSessionID = args.Resumes
		}
		cwd = args.Cwd
	} else {
		existing, err := t.deps.Store.Get(args.Resume)
		if err != nil {
			return PrepareResult{}, fmt.Errorf("ade: prepare: resume lookup: %w", err)
		}
		if existing == nil {
			return PrepareResult{}, ErrSessionNotFound
		}
		if existing.TaskID != args.TaskID {
			return PrepareResult{}, ErrSessionWrongTask
		}
		if existing.State != model.AdeSessionStateStopped {
			return PrepareResult{}, ErrSessionRunning
		}
		recordID = existing.ID
		claudeSessionID = existing.ClaudeSessionID
		// Resume always uses the recorded cwd, never args.Cwd — a session must not appear to resume
		// somewhere it never ran. A missing directory is an error.
		if info, err := os.Stat(existing.Cwd); err != nil {
			if !os.IsNotExist(err) {
				return PrepareResult{}, fmt.Errorf("ade: prepare: stat resume cwd: %w", err)
			}
			return PrepareResult{}, fmt.Errorf("%w: %s no longer exists", ErrInvalidInput, existing.Cwd)
		} else if !info.IsDir() {
			return PrepareResult{}, ErrResumeCwdNotDir
		}
		cwd = existing.Cwd
	}

	claudeBin := t.deps.ClaudeBin
	command := newCommand(claudeBin, claudeSessionID)
	if args.Resume != "" || args.Resumes != "" {
		command = resumeCommand(claudeBin, claudeSessionID)
	}
	for _, a := range args.ExtraArgs {
		command += " " + quotePOSIX(a)
	}

	terminalID := uuid.NewString()
	intent := pendingIntent{
		RecordID: recordID, ClaudeSessionID: claudeSessionID, Cwd: cwd, Command: command, Message: args.Message,
		Resume: args.Resume != "", CreatedAt: now,
		TaskID: args.TaskID, BranchID: args.BranchID, StageID: args.StageID, StepID: args.StepID, Resumes: args.Resumes, Purpose: args.Purpose,
	}

	t.mu.Lock()
	expired := t.pruneExpiredPendingLocked(now)
	if intent.Resume {
		if _, held := t.byRecord[recordID]; held {
			t.mu.Unlock()
			t.releaseExpired(expired)
			return PrepareResult{}, ErrSessionRunning
		}
		// A retry supersedes an abandoned launch; Compose guards the real double-resume race.
		for id, p := range t.pending {
			if p.RecordID == recordID {
				delete(t.pending, id)
			}
		}
	}
	t.pending[terminalID] = intent
	t.mu.Unlock()
	t.releaseExpired(expired)
	time.AfterFunc(t.deps.PendingTTL, func() { t.expirePending(terminalID) })

	return PrepareResult{TerminalID: terminalID, RecordID: recordID, SessionID: claudeSessionID, Command: command, Cwd: cwd}, nil
}

// expirePending releases an intent that never composed within PendingTTL, so an abandoned launch's
// grant does not wait for the next Prepare to be pruned.
func (t *Tracker) expirePending(terminalID string) {
	t.mu.Lock()
	intent, ok := t.pending[terminalID]
	if ok {
		delete(t.pending, terminalID)
	}
	closed := t.closed
	t.mu.Unlock()
	if ok && !closed {
		t.releaseExpired([]string{intent.RecordID})
	}
}

// hasPending reports whether a launch matching the filter was prepared within launchGuardWindow and
// still awaits its Compose; an older one is presumed abandoned and lets a retry through.
func (t *Tracker) hasPending(match func(pendingIntent) bool) bool {
	t.mu.Lock()
	now := t.deps.Now()
	expired := t.pruneExpiredPendingLocked(now)
	found := false
	for _, p := range t.pending {
		if now.Sub(p.CreatedAt) <= launchGuardWindow && match(p) {
			found = true
			break
		}
	}
	t.mu.Unlock()
	t.releaseExpired(expired)
	return found
}

// Compose is BoundService.ComposeAgent's own target (wired in main.go) — internal/terminal.Open
// calls it for every claude-code launch, composed or not. No intent for terminalID (a claude-code
// launch not started through Prepare; this app has none today) means hooks-only composition, no
// record — §4.4's own explicit fallback.
func (t *Tracker) Compose(terminalID, command string) (string, []string, error) {
	t.mu.Lock()
	intent, ok := t.pending[terminalID]
	if ok {
		delete(t.pending, terminalID)
	}
	t.mu.Unlock()

	if !ok {
		hooks := t.hooksFn()
		if hooks == nil {
			return command, nil, nil
		}
		composed, env := hooks(terminalID, command)
		return composed, env, nil
	}

	if command != intent.Command {
		return "", nil, ErrCommandMismatch
	}

	// Build the final command first: Open rejects an over-long one after this returns, which would
	// leave a persisted row for a conversation that never ran.
	composed, env := command, []string(nil)
	if hooks := t.hooksFn(); hooks != nil {
		composed, env = hooks(terminalID, command)
	}
	if intent.Message != "" {
		// The command can end in a variadic flag (--add-dir a b), which would swallow the prompt.
		composed += " -- " + quotePOSIX(normalizeMessage(intent.Message))
	}
	if len(composed) > terminal.MaxCommandBytes {
		return "", nil, fmt.Errorf("%w: command is too long", ErrInvalidInput)
	}

	now := t.deps.Now()
	if intent.Resume {
		// Reserve before MarkRunning so two concurrent composes cannot both resume one record;
		// Reconcile ignores it until spawnedAt is set below.
		t.mu.Lock()
		if _, held := t.byRecord[intent.RecordID]; held {
			t.mu.Unlock()
			return "", nil, ErrSessionRunning
		}
		t.byRecord[intent.RecordID] = terminalID
		t.mu.Unlock()
		if err := t.deps.Store.MarkRunning(intent.RecordID, terminalID, now.UnixMilli()); err != nil {
			t.mu.Lock()
			delete(t.byRecord, intent.RecordID)
			t.mu.Unlock()
			return "", nil, fmt.Errorf("ade: compose: %w", err)
		}
	} else {
		rec := model.AdeSession{
			ID: intent.RecordID, ClaudeSessionID: intent.ClaudeSessionID, Cwd: intent.Cwd,
			State: model.AdeSessionStateRunning, TerminalID: terminalID,
			StartedAt: now.UnixMilli(), LastActiveAt: now.UnixMilli(),
			Mode: model.AdeSessionModeTUI, TaskID: intent.TaskID, BranchID: intent.BranchID,
			StageID: intent.StageID, StepID: intent.StepID, Resumes: intent.Resumes, Purpose: intent.Purpose,
		}
		if err := t.deps.Store.InsertTUI(rec); err != nil {
			return "", nil, fmt.Errorf("ade: compose: %w", err)
		}
	}

	t.mu.Lock()
	t.live[terminalID] = intent.RecordID
	t.byRecord[intent.RecordID] = terminalID
	t.spawnedAt[intent.RecordID] = now
	t.claudeSessionID[intent.RecordID] = intent.ClaudeSessionID
	if !intent.Resume {
		t.fresh[intent.RecordID] = true
	}
	t.armGraceLocked(intent.RecordID)
	t.mu.Unlock()

	// The grace window exists because Compose runs before the PTY is registered with Registry: a
	// Reconcile racing the spawn (Registry.OnChange fires on both open and exit) must not stop a
	// record that only just started (§4.4).

	if t.deps.OnChange != nil {
		t.deps.OnChange()
	}

	return composed, env, nil
}

// Abort is BoundService.AbortAgent's own target: Open failed after Compose, so the terminal never
// ran. A fresh record is deleted (its Claude session never existed, so a resume would fail); a
// resumed one goes back to stopped. A terminal Compose tracked nothing for is a no-op.
func (t *Tracker) Abort(terminalID string) {
	t.mu.Lock()
	recordID, ok := t.live[terminalID]
	if !ok {
		t.mu.Unlock()
		return
	}
	fresh := t.fresh[recordID]
	delete(t.live, terminalID)
	delete(t.byRecord, recordID)
	delete(t.spawnedAt, recordID)
	delete(t.lastActive, recordID)
	delete(t.claudeSessionID, recordID)
	delete(t.fresh, recordID)
	if timer := t.graceTimers[recordID]; timer != nil {
		timer.Stop()
		delete(t.graceTimers, recordID)
	}
	now := t.deps.Now().UnixMilli()
	t.mu.Unlock()

	var err error
	if fresh {
		err = t.deps.Store.Delete(recordID)
	} else {
		err = t.deps.Store.MarkStopped(recordID, now)
	}
	if err != nil {
		slog.Warn("ade: abort", "scope", "ade", "recordId", recordID, "err", err)
	} else if t.deps.OnChange != nil {
		t.deps.OnChange()
	}
	// Release per-session state (Take over binding, MCP config, token) even when the store write fails.
	t.mu.Lock()
	onStopped := t.deps.OnStopped
	t.mu.Unlock()
	if onStopped != nil {
		onStopped(recordID)
	}
}

// armGraceLocked schedules the Reconcile that follows a record's grace window; mu is held.
func (t *Tracker) armGraceLocked(recordID string) {
	if t.closed {
		return
	}
	if old := t.graceTimers[recordID]; old != nil {
		old.Stop()
	}
	t.graceTimers[recordID] = time.AfterFunc(t.deps.Grace, func() {
		t.mu.Lock()
		if t.closed {
			t.mu.Unlock()
			return
		}
		delete(t.graceTimers, recordID)
		t.graceWG.Add(1)
		t.mu.Unlock()
		defer t.graceWG.Done()
		t.Reconcile()
	})
}

// Reconcile reads the live agent set and stops every tracked record whose terminal is gone and
// whose grace window has elapsed — called after every Registry.OnChange (spawn and exit) and once,
// scheduled, after each Compose's own grace window. Idempotent and safe to call from any
// goroutine (main.go's Registry.OnChange closure, the AfterFunc timer, and tests all call it
// directly).
func (t *Tracker) Reconcile() {
	live := t.deps.LiveAgents()
	liveSet := make(map[string]bool, len(live))
	for _, a := range live {
		liveSet[a.ID] = true
	}

	now := t.deps.Now()
	t.mu.Lock()
	var toStop []string
	for recordID, spawnedAt := range t.spawnedAt {
		terminalID, ok := t.byRecord[recordID]
		if !ok {
			continue
		}
		if liveSet[terminalID] {
			continue
		}
		if now.Sub(spawnedAt) < t.deps.Grace {
			continue
		}
		toStop = append(toStop, recordID)
	}
	flushed := make(map[string]int64, len(toStop))
	for _, recordID := range toStop {
		terminalID := t.byRecord[recordID]
		delete(t.byRecord, recordID)
		delete(t.live, terminalID)
		delete(t.spawnedAt, recordID)
		if v, ok := t.lastActive[recordID]; ok {
			flushed[recordID] = v
			delete(t.lastActive, recordID)
		} else {
			flushed[recordID] = now.UnixMilli()
		}
		delete(t.claudeSessionID, recordID)
		delete(t.fresh, recordID)
	}
	t.mu.Unlock()

	var stopped []string
	for _, recordID := range toStop {
		if err := t.deps.Store.MarkStopped(recordID, flushed[recordID]); err != nil {
			slog.Warn("ade: reconcile: mark stopped", "scope", "ade", "recordId", recordID, "err", err)
			continue
		}
		stopped = append(stopped, recordID)
	}
	if len(stopped) > 0 && t.deps.OnChange != nil {
		t.deps.OnChange()
	}
	t.mu.Lock()
	onStopped := t.deps.OnStopped
	t.mu.Unlock()
	if onStopped != nil {
		for _, recordID := range stopped {
			onStopped(recordID)
		}
	}
}

// HandleEvent is agenthooks.Options.OnEvent's own target — an event for a terminal this tracker
// does not know (not live, or already reconciled away) is ignored, never an error: agenthooks has
// no notion of ade sessions, and a stray event racing a stop is expected, not a bug.
func (t *Tracker) HandleEvent(ev agenthooks.Event) {
	t.mu.Lock()
	recordID, ok := t.live[ev.TerminalID]
	if !ok {
		t.mu.Unlock()
		return
	}
	now := t.deps.Now()
	nowMs := now.UnixMilli()
	t.lastActive[recordID] = nowMs

	sessionChanged := false
	// The id lands in a later shell command line; only a real UUID is trusted.
	if _, perr := uuid.Parse(ev.SessionID); ev.Event == "SessionStart" && perr == nil && t.claudeSessionID[recordID] != ev.SessionID {
		t.claudeSessionID[recordID] = ev.SessionID
		sessionChanged = true
	}
	flushNow := ev.Event == "Stop" || ev.Event == "SessionEnd"
	t.mu.Unlock()

	if sessionChanged {
		if err := t.deps.Store.SetClaudeSessionID(recordID, ev.SessionID); err != nil {
			slog.Warn("ade: handle event: set claude session id", "scope", "ade", "recordId", recordID, "err", err)
		}
	}
	if flushNow {
		if err := t.deps.Store.SetLastActive(recordID, nowMs); err != nil {
			slog.Warn("ade: handle event: set last active", "scope", "ade", "recordId", recordID, "err", err)
		}
	}
	if sessionChanged && t.deps.OnChange != nil {
		t.deps.OnChange()
	}
}

// Send forwards message to sessionID's own live terminal as a bracketed paste followed by Enter
// (§4.5) — sessionID is the ade_sessions record id, not the (mutable, across /clear) Claude
// session id, since the record id is what the UI holds as a stable handle for a session it is
// looking at.
func (t *Tracker) Send(sessionID, message string) error {
	t.mu.Lock()
	terminalID, ok := t.byRecord[sessionID]
	t.mu.Unlock()
	if !ok {
		return ErrSessionNotRunning
	}

	paste, enter := pasteBytes(message)
	if err := t.deps.WriteTerminal(terminalID, paste); err != nil {
		return fmt.Errorf("ade: send: %w", err)
	}
	if err := t.deps.WriteTerminal(terminalID, enter); err != nil {
		return fmt.Errorf("ade: send: %w", err)
	}
	return nil
}

// Get returns id's own recorded session, nil if none exists — AdeTaskService.FocusSession's own
// lookup. It reads State/TerminalID only, neither touched by the in-memory lastActive clock.
func (t *Tracker) Get(id string) (*model.AdeSession, error) {
	return t.deps.Store.Get(id)
}

// Close flushes every still-in-memory lastActive value to the store — main.go's own teardown,
// after TerminalService.Shutdown has already closed every PTY (whose own exit notifications may
// still be racing Reconcile) but before the database closes.
func (t *Tracker) Close() error {
	t.mu.Lock()
	t.closed = true
	for _, timer := range t.graceTimers {
		timer.Stop()
	}
	t.graceTimers = map[string]*time.Timer{}
	t.mu.Unlock()
	t.graceWG.Wait()

	t.mu.Lock()
	toFlush := make(map[string]int64, len(t.lastActive))
	for id, v := range t.lastActive {
		toFlush[id] = v
	}
	t.mu.Unlock()

	var errs []error
	for recordID, ms := range toFlush {
		if err := t.deps.Store.SetLastActive(recordID, ms); err != nil {
			errs = append(errs, fmt.Errorf("ade: close: flush %s: %w", recordID, err))
		}
	}
	return errors.Join(errs...)
}
