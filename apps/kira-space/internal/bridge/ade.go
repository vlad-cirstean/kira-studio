package bridge

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

// adeMaxMessageBytes bounds AdePrepareLaunchArgs.Message and AdeSendArgs.Message (§4.6) — the
// same 32 KiB figure the plan gives, generous for a prompt or a forwarded reply while keeping one
// bad paste from blowing past MaxCommandBytes once quoted and appended to the launch command.
const adeMaxMessageBytes = 32 * 1024

// adeMaxBranchBytes bounds AdePrepareLaunchArgs.Branch — a git ref name has no reason to approach
// this, so it exists only to reject a malformed/hostile value before it ever reaches Tracker.
const adeMaxBranchBytes = 255

// AgentSessionWire is terminal.AgentSession's own wire projection — AgentSessionsEvent's own list
// element. Byte-identical shape to Kira Studio's own deleted precedent (P127, d20bc970^).
type AgentSessionWire struct {
	TerminalID string `json:"terminalId"`
	Cwd        string `json:"cwd"`
}

// AgentSessionsEvent is ChannelAgentSessions' own payload, and AdeService.AgentSessions' own
// return shape (the boot-time hydrate: a window opened after every currently-live session already
// started needs a snapshot, since the channel only fires on change).
type AgentSessionsEvent struct {
	Sessions []AgentSessionWire `json:"sessions"`
}

func toWireAgentSessions(sessions []terminal.AgentSession) []AgentSessionWire {
	out := make([]AgentSessionWire, len(sessions))
	for i, s := range sessions {
		out[i] = AgentSessionWire{TerminalID: s.ID, Cwd: s.Cwd}
	}
	return out
}

// AdeSessionWire is model.AdeSession's own wire projection (§4.6) — TerminalID is "" once stopped,
// mirroring the stored row exactly (never synthesised). CwdMissing (P129 Part 7 §0.12) is the one
// exception: a fresh os.Stat per Sessions() call, never stored — a worktree directory can be
// deleted at any time outside this app (branch archive elsewhere, manual cleanup), so a cached bit
// would go stale between refreshes.
type AdeSessionWire struct {
	ID              string `json:"id"`
	ClaudeSessionID string `json:"claudeSessionId"`
	CodeRepoID      string `json:"codeRepoId"`
	Branch          string `json:"branch"`
	NewWorkID       string `json:"newWorkId"`
	Cwd             string `json:"cwd"`
	State           string `json:"state"`
	TerminalID      string `json:"terminalId"`
	StartedAt       int64  `json:"startedAt"`
	LastActiveAt    int64  `json:"lastActiveAt"`
	CwdMissing      bool   `json:"cwdMissing"`
}

func toWireAdeSession(s model.AdeSession) AdeSessionWire {
	return AdeSessionWire{
		ID: s.ID, ClaudeSessionID: s.ClaudeSessionID, CodeRepoID: s.CodeRepoID, Branch: s.Branch,
		NewWorkID: s.NewWorkID, Cwd: s.Cwd, State: s.State, TerminalID: s.TerminalID,
		StartedAt: s.StartedAt, LastActiveAt: s.LastActiveAt, CwdMissing: cwdMissing(s.Cwd),
	}
}

// cwdMissing reports whether a session's own recorded cwd no longer exists as a directory — a
// stat error other than "not exist" (permission, I/O) reads false, since Tracker.Prepare's own
// resume fallback (§0.12) only ever recreates a genuinely-missing directory; this stays consistent
// with that, rather than second-guessing an error the app can't act on differently.
func cwdMissing(cwd string) bool {
	info, err := os.Stat(cwd)
	if err != nil {
		return os.IsNotExist(err)
	}
	return !info.IsDir()
}

// AdeSessionsResult is Sessions' own return shape — every recorded session, newest-active first
// (ade.Tracker.List's own order).
type AdeSessionsResult struct {
	Sessions []AdeSessionWire `json:"sessions"`
}

// AdePrepareLaunchArgs is PrepareLaunch's own argument shape (§4.6). Exactly one of Branch/
// NewWorkID must be set; Resume is "" for a new session or an existing ade_sessions.id to resume.
type AdePrepareLaunchArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Branch     string `json:"branch"`
	NewWorkID  string `json:"newWorkId"`
	Cwd        string `json:"cwd"`
	Resume     string `json:"resume"`
	Message    string `json:"message"`
}

// Validate checks every wire-level rule §4.6 states, naming the offending field — the same
// discipline every other Args.Validate in this app follows. It does not check that CodeRepoID or
// Resume actually name an existing row; PrepareLaunch does that against the store, where the
// answer can change between calls.
//
// P129 Part 7 §0.2/§2.3: a resume (Resume != "") skips the branch/newWorkId and cwd checks below —
// the record Resume names governs all three (ade.Tracker.Prepare reads them off the stored row,
// never off these args), and the record's own cwd may legitimately not exist yet (§0.12's own
// recreate-if-missing fallback). CodeRepoID and the message-length check still apply.
func (a AdePrepareLaunchArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if a.Resume == "" {
		if (a.Branch == "") == (a.NewWorkID == "") {
			return ipcerr.New("E_INVALID", "exactly one of branch/newWorkId is required")
		}
		if a.Branch != "" {
			if len(a.Branch) > adeMaxBranchBytes {
				return ipcerr.New("E_INVALID", "branch is too long")
			}
			if strings.ContainsAny(a.Branch, "\x00\n") {
				return ipcerr.New("E_INVALID", "branch must not contain NUL or newline")
			}
		}
		if !filepath.IsAbs(a.Cwd) {
			return ipcerr.New("E_INVALID", "cwd must be an absolute path")
		}
		info, err := os.Stat(a.Cwd)
		if err != nil || !info.IsDir() {
			return ipcerr.New("E_INVALID", "cwd does not exist or is not a directory")
		}
	}
	if len(a.Message) > adeMaxMessageBytes {
		return ipcerr.New("E_INVALID", "message is too long")
	}
	return nil
}

// AdePrepareLaunchResult is PrepareLaunch's own return shape — the renderer mounts
// TerminalHostView for TerminalID with Command and launchKind: 'claude-code' (§4.2 step 2). Cwd is
// P129 Part 7 §0.12: the effective cwd (args.Cwd for a new launch, the recorded — and possibly
// just-recreated — cwd for a resume); the renderer opens the terminal there, never at its own guess.
type AdePrepareLaunchResult struct {
	TerminalID string `json:"terminalId"`
	SessionID  string `json:"sessionId"`
	Command    string `json:"command"`
	Cwd        string `json:"cwd"`
}

// AdeSendArgs is Send's own argument shape. SessionID is the ade_sessions record id (a stable
// handle the UI already holds), never the Claude session id, which can change across a /clear.
type AdeSendArgs struct {
	SessionID string `json:"sessionId"`
	Message   string `json:"message"`
}

func (a AdeSendArgs) Validate() error {
	if a.SessionID == "" {
		return ipcerr.New("E_INVALID", "sessionId is required")
	}
	if a.Message == "" {
		return ipcerr.New("E_INVALID", "message is required")
	}
	if len(a.Message) > adeMaxMessageBytes {
		return ipcerr.New("E_INVALID", "message is too long")
	}
	return nil
}

// AdeService is Kira Space's own agent runtime surface (P129 Part 1 §4.6): the launch/tracking
// half of the "agent merge queue" (Parts 2-7 add the queue's own git-facts and UI surface on top).
// It never carries KIRA_AGENT_HOOK_TOKEN or any other hook env var — Tracker.Compose/Prepare never
// return one, and neither wire type above has a field that could.
type AdeService struct {
	Deps     appcore.Deps
	Tracker  *ade.Tracker
	Registry *terminal.Registry
	// Queue is P129 Part 2's own addition — the merge-queue's git-facts and persistence surface
	// (internal/ade.Queue), nil in a fixture that only exercises Part 1's launch/tracking methods.
	Queue *ade.Queue
	// FocusWindow is P129 Part 7's own addition (§0.9) — main.go assigns it to
	// shell.WindowRegistry.Focus once that registry exists (the same two-step
	// windowsSvc.OpenNewWindow's own field uses), nil in a fixture that never calls FocusSession.
	// A func field, not a method: Wails' binding generator only sees exported *methods* on the
	// registered type (§1.7's FQN rule), so this never grows the bound-call surface.
	FocusWindow func(key string) bool
}

// AgentSessions is the boot-time hydrate for the P127 agent-activity store (§1.1) — a window
// opened after every currently-live session already started needs a snapshot, since
// ChannelAgentSessions only fires on change.
func (s *AdeService) AgentSessions() AgentSessionsEvent {
	return AgentSessionsEvent{Sessions: toWireAgentSessions(s.Registry.AgentSessions())}
}

// Sessions returns every session this app has ever recorded, running or stopped.
func (s *AdeService) Sessions() (AdeSessionsResult, error) {
	sessions, err := s.Tracker.List()
	if err != nil {
		return AdeSessionsResult{}, ipcerr.InternalErr(err)
	}
	out := make([]AdeSessionWire, len(sessions))
	for i, sess := range sessions {
		out[i] = toWireAdeSession(sess)
	}
	return AdeSessionsResult{Sessions: out}, nil
}

// AdeFocusSessionArgs is FocusSession's own argument shape (§0.9). ItemID is "" for an orphan row
// (All agents §0.6 rule 3) — the caller then only wants the repo tab shown, not a specific item
// selected.
type AdeFocusSessionArgs struct {
	SessionID string `json:"sessionId"`
	ItemID    string `json:"itemId"`
}

func (a AdeFocusSessionArgs) Validate() error {
	if a.SessionID == "" {
		return ipcerr.New("E_INVALID", "sessionId is required")
	}
	if len(a.ItemID) > adeMaxBranchBytes {
		return ipcerr.New("E_INVALID", "itemId is too long")
	}
	if strings.ContainsAny(a.ItemID, "\x00\n") {
		return ipcerr.New("E_INVALID", "itemId must not contain NUL or newline")
	}
	return nil
}

// FocusSession is the All agents row's own cross-window Open (§0.9, §0.8's local-window fallback
// covers the rest): sessionId's own terminal may be owned by a window other than the caller's, so
// this brings that window forward and tells it what to show, rather than trying to attach a
// TerminalHostView to a foreign id (Part 6 §0.18's own "never cross windows" rule). Returns false
// — never an error — for every reason the caller's own local-window fallback already exists to
// handle: the session already stopped, or its owning window closed between the row rendering and
// the click.
func (s *AdeService) FocusSession(args AdeFocusSessionArgs) (bool, error) {
	if err := args.Validate(); err != nil {
		return false, err
	}
	record, err := s.Tracker.Get(args.SessionID)
	if err != nil {
		return false, ipcerr.InternalErr(err)
	}
	if record == nil {
		return false, adeTrackerError(ade.ErrSessionNotFound)
	}
	if record.State != model.AdeSessionStateRunning {
		return false, nil
	}
	windowKey, ok := s.Registry.WindowOf(record.TerminalID)
	if !ok {
		return false, nil
	}
	if s.FocusWindow == nil || !s.FocusWindow(windowKey) {
		return false, nil
	}
	AdeOpenSession(s.Deps.Events, windowKey, AdeOpenSessionEvent{
		CodeRepoID: record.CodeRepoID, ItemID: args.ItemID, SessionID: args.SessionID,
	})
	return true, nil
}

// ChannelAdeOpenSession is FocusSession's own push channel (§0.9) — EmitTo'd to the window
// FocusWindow just brought forward, telling it which repo/item/session to show. Space-only, no
// Kira Studio equivalent (it has no ade module).
const ChannelAdeOpenSession = "kira:ade:open-session"

// AdeOpenSessionEvent is ChannelAdeOpenSession's own payload. ItemID is "" for an orphan row.
type AdeOpenSessionEvent struct {
	CodeRepoID string `json:"codeRepoId"`
	ItemID     string `json:"itemId"`
	SessionID  string `json:"sessionId"`
}

// AdeOpenSession is FocusSession's own emit half, split out to match every other Channel's own
// named send-helper (AdeSessionsChanged/AdeRepoChanged/AdeCredentialRequested) — EmitTo, since this
// is addressed to one specific window (the one FocusWindow just brought forward), never the focused
// window or every window. Takes the bare Emitter, not *Events: AdeService only ever holds
// Deps.Events (appcore.Emitter), never the app's own *Events wrapper the other three helpers take.
func AdeOpenSession(e appcore.Emitter, windowKey string, payload AdeOpenSessionEvent) {
	e.EmitTo(windowKey, ChannelAdeOpenSession, payload)
}

// adeTrackerError maps a Tracker sentinel error to E_INVALID with its own message (a caller
// mistake: an unknown or wrong-state resume target), or wraps anything else as internal.
func adeTrackerError(err error) error {
	switch err {
	case ade.ErrSessionNotFound, ade.ErrSessionWrongRepo, ade.ErrSessionRunning,
		ade.ErrSessionNotRunning, ade.ErrCommandMismatch, ade.ErrResumeCwdNotDir:
		return ipcerr.New("E_INVALID", err.Error())
	default:
		return ipcerr.InternalErr(err)
	}
}

// PrepareLaunch validates args, confirms codeRepoId names a real repo, and records a pending
// launch intent (§4.2 step 1) — the renderer mounts TerminalHostView with the returned command
// next, which drives the actual spawn through the unchanged terminal open path.
func (s *AdeService) PrepareLaunch(args AdePrepareLaunchArgs) (AdePrepareLaunchResult, error) {
	if err := args.Validate(); err != nil {
		return AdePrepareLaunchResult{}, err
	}
	repo, err := s.Deps.Repos.CodeRepos.Get(args.CodeRepoID)
	if err != nil {
		return AdePrepareLaunchResult{}, ipcerr.InternalErr(err)
	}
	if repo == nil {
		return AdePrepareLaunchResult{}, ipcerr.New("E_INVALID", "codeRepoId does not exist")
	}

	res, err := s.Tracker.Prepare(ade.PrepareArgs{
		CodeRepoID: args.CodeRepoID, Branch: args.Branch, NewWorkID: args.NewWorkID,
		Cwd: args.Cwd, Resume: args.Resume, Message: args.Message,
	})
	if err != nil {
		return AdePrepareLaunchResult{}, adeTrackerError(err)
	}
	return AdePrepareLaunchResult{
		TerminalID: res.TerminalID, SessionID: res.SessionID, Command: res.Command, Cwd: res.Cwd,
	}, nil
}

// Send forwards a message to sessionId's own live terminal (§4.5) — a bracketed paste followed by
// Enter, refused when the session is not currently running.
func (s *AdeService) Send(args AdeSendArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	if err := s.Tracker.Send(args.SessionID, args.Message); err != nil {
		return adeTrackerError(err)
	}
	return nil
}

// AgentSessionsChanged is Registry.OnChange's own target for the ade-aware wiring (main.go) — a
// package-level function rather than a call to an exported method, the same "Wails binds every
// exported method of a registered service" reasoning Kira Studio's deleted
// TerminalAgentSessionsChanged followed (P127, d20bc970^): emit itself must never become
// renderer-triggerable.
func AgentSessionsChanged(s *AdeService) {
	s.Deps.Events.Emit(ChannelAgentSessions, s.AgentSessions())
}

// EmitAgentEvent is agenthooks.Options.OnEvent's own broadcast half (main.go wires it alongside
// Tracker.HandleEvent) — emitted verbatim: agenthooks.Event's JSON tags already match
// ChannelAgentEvent's own payload shape field for field (packages/shared/domain/agent.ts's
// AgentEvent), so no separate wire-projection type is needed, matching Kira Studio's own deleted
// precedent (P127, d20bc970^).
func EmitAgentEvent(e appevent.Emitter, ev agenthooks.Event) {
	e.Emit(ChannelAgentEvent, ev)
}

// AdeSessionsChanged is ade.TrackerDeps.OnChange's own target (main.go) — a payload-free broadcast
// to every window, ChannelKeepAwake's own shape (appevent.go's doc comment): a process-wide fact,
// not addressed to whichever window happens to be focused.
func AdeSessionsChanged(ev *Events) {
	ev.Broadcast(ChannelAdeSessions)
}

// --- Queue wire types (P129 Part 2 §5.2) --------------------------------------------------------

// AdeMain is RepoSnapshot.Main's own wire shape — nil means main is unresolved (§0.6).
type AdeMain struct {
	Name string `json:"name"`
	Ref  string `json:"ref"`
	Tip  string `json:"tip"`
}

type AdeFile struct {
	Path    string `json:"path"`
	Added   *int   `json:"added,omitempty"`
	Deleted *int   `json:"deleted,omitempty"`
	Binary  bool   `json:"binary"`
}

type AdeCommit struct {
	Sha     string `json:"sha"`
	Message string `json:"message"`
}

type AdeDirty struct {
	Code string `json:"code"`
	Path string `json:"path"`
}

// AdeJira is a branch's or new-work item's own read-side Jira link — always present, empty fields
// meaning "none set".
type AdeJira struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

type AdeBranchWire struct {
	ID             string      `json:"id"`
	Branch         string      `json:"branch"`
	Kind           string      `json:"kind"`
	WorkType       string      `json:"workType"`
	Name           string      `json:"name"`
	DraftTitle     string      `json:"draftTitle"`
	StartFrom      string      `json:"startFrom"`
	Exists         bool        `json:"exists"`
	Ref            string      `json:"ref"`
	Tip            string      `json:"tip"`
	Owner          string      `json:"owner"`
	AuthorEmail    string      `json:"authorEmail"`
	IsMine         bool        `json:"isMine"`
	LastCommitAt   int64       `json:"lastCommitAt"`
	Base           string      `json:"base"`
	Ahead          int         `json:"ahead"`
	Behind         int         `json:"behind"`
	Merged         bool        `json:"merged"`
	MergedAt       *int64      `json:"mergedAt,omitempty"`
	Worktree       string      `json:"worktree"`
	Files          []AdeFile   `json:"files"`
	Commits        []AdeCommit `json:"commits"`
	CommitCount    int         `json:"commitCount"`
	Dirty          []AdeDirty  `json:"dirty"`
	Upstream       string      `json:"upstream"`
	UpstreamAhead  int         `json:"upstreamAhead"`
	UpstreamBehind int         `json:"upstreamBehind"`
	Jira           AdeJira     `json:"jira"`
	PrURL          string      `json:"prUrl"`
	Est            string      `json:"est"`
	Notes          string      `json:"notes"`
	AddedAt        int64       `json:"addedAt"`
}

type AdeNewWorkWire struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	WorkType         string   `json:"workType"`
	StartFrom        string   `json:"startFrom"`
	BranchName       string   `json:"branchName"`
	Est              string   `json:"est"`
	Notes            string   `json:"notes"`
	Jira             AdeJira  `json:"jira"`
	CreatedAt        int64    `json:"createdAt"`
	BranchCandidates []string `json:"branchCandidates,omitempty"`
}

type AdePlanWire struct {
	Day         map[string]*string `json:"day"`
	Order       []string           `json:"order"`
	QueuedAfter map[string]string  `json:"queuedAfter"`
	Unpushed    map[string]bool    `json:"unpushed"`
}

type AdePair struct {
	A         string   `json:"a"`
	B         string   `json:"b"`
	Shared    []string `json:"shared"`
	Conflicts []string `json:"conflicts"`
}

type AdeHistoryItem struct {
	Item       string `json:"item"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	Branch     string `json:"branch"`
	MergedAt   *int64 `json:"mergedAt,omitempty"`
	ArchivedAt int64  `json:"archivedAt"`
}

type AdeRepoSnapshot struct {
	CodeRepoID string   `json:"codeRepoId"`
	GitRepoID  string   `json:"gitRepoId"`
	Main       *AdeMain `json:"main,omitempty"`
	// Remote is P129 Part 4 §2.2's own addition — the repo's own default remote, empty when none.
	Remote           string              `json:"remote"`
	Branches         []AdeBranchWire     `json:"branches"`
	NewWork          []AdeNewWorkWire    `json:"newWork"`
	Plan             AdePlanWire         `json:"plan"`
	Colors           map[string]int      `json:"colors"`
	Pairs            []AdePair           `json:"pairs"`
	History          []AdeHistoryItem    `json:"history"`
	Dependencies     []AdeDependencyWire `json:"dependencies"`
	LastFetchAt      *int64              `json:"lastFetchAt,omitempty"`
	AutofetchMinutes int                 `json:"autofetchMinutes"`
	WorktreeBasePath string              `json:"worktreeBasePath"`
}

// AdeDependencyWire is ade.DependencyFact's own wire projection (P135 §4.4) — no git field of any
// kind.
type AdeDependencyWire struct {
	ID         string   `json:"id"`
	Title      string   `json:"title"`
	WaitingOn  string   `json:"waitingOn"`
	ExpectedBy *string  `json:"expectedBy,omitempty"`
	CreatedAt  int64    `json:"createdAt"`
	Blocks     []string `json:"blocks"`
}

type AdeCandidateBranch struct {
	Name         string `json:"name"`
	Author       string `json:"author"`
	LastCommitAt int64  `json:"lastCommitAt"`
	RemoteOnly   bool   `json:"remoteOnly"`
	Mine         bool   `json:"mine"`
}

// AdePr is RepoPrs.Branches' own value shape — ResolveBranchPr's raw state, verbatim.
type AdePr struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	State  string `json:"state"`
}

type AdeRepoPrs struct {
	Kind     string            `json:"kind"` // "ok" | "disabled" | "unavailable"
	Branches map[string]*AdePr `json:"branches"`
	// WebURL is the repo's own web root (P129 Part 6 §0.8), "" when unlinked.
	WebURL string `json:"webUrl"`
}

type AdeForcePushResult struct {
	Branch string                    `json:"branch"`
	OK     bool                      `json:"ok"`
	Error  *gitsession.RemoteOpError `json:"error,omitempty"`
}

type AdeRefreshResult struct {
	RefsChanged int                       `json:"refsChanged"`
	NewlyMerged []string                  `json:"newlyMerged"`
	Error       *gitsession.RemoteOpError `json:"error,omitempty"`
}

type AdeArchiveRiskResult struct {
	Dirty    []AdeDirty `json:"dirty"`
	Unmerged int        `json:"unmerged"`
	Worktree string     `json:"worktree"`
	Blocked  string     `json:"blocked,omitempty"`
}

func toWireAdeMain(m *ade.Main) *AdeMain {
	if m == nil {
		return nil
	}
	return &AdeMain{Name: m.Name, Ref: m.Ref, Tip: m.Tip}
}

func toWireAdeFiles(files []ade.FileDelta) []AdeFile {
	out := make([]AdeFile, len(files))
	for i, f := range files {
		out[i] = AdeFile{Path: f.Path, Added: f.Added, Deleted: f.Deleted, Binary: f.Binary}
	}
	return out
}

func toWireAdeCommits(commits []ade.Commit) []AdeCommit {
	out := make([]AdeCommit, len(commits))
	for i, c := range commits {
		out[i] = AdeCommit{Sha: c.Sha, Message: c.Message}
	}
	return out
}

func toWireAdeDirty(dirty []ade.DirtyEntry) []AdeDirty {
	out := make([]AdeDirty, len(dirty))
	for i, d := range dirty {
		out[i] = AdeDirty{Code: d.Code, Path: d.Path}
	}
	return out
}

func toWireAdeJira(j ade.Jira) AdeJira {
	return AdeJira{Key: j.Key, URL: j.URL}
}

func toWireAdeBranch(b ade.BranchFact) AdeBranchWire {
	return AdeBranchWire{
		ID: b.ID, Branch: b.Branch, Kind: b.Kind, WorkType: b.WorkType, Name: b.Name, DraftTitle: b.DraftTitle,
		StartFrom: b.StartFrom, Exists: b.Exists, Ref: b.Ref, Tip: b.Tip, Owner: b.Owner,
		AuthorEmail: b.AuthorEmail, IsMine: b.IsMine, LastCommitAt: b.LastCommitAt, Base: b.Base,
		Ahead: b.Ahead, Behind: b.Behind, Merged: b.Merged, MergedAt: b.MergedAt, Worktree: b.Worktree,
		Files: toWireAdeFiles(b.Files), Commits: toWireAdeCommits(b.Commits), CommitCount: b.CommitCount,
		Dirty: toWireAdeDirty(b.Dirty), Upstream: b.Upstream, UpstreamAhead: b.UpstreamAhead,
		UpstreamBehind: b.UpstreamBehind, Jira: toWireAdeJira(b.Jira), PrURL: b.PrURL, Est: b.Est,
		Notes: b.Notes, AddedAt: b.AddedAt,
	}
}

func toWireAdeNewWork(w ade.NewWorkFact) AdeNewWorkWire {
	return AdeNewWorkWire{
		ID: w.ID, Title: w.Title, WorkType: w.WorkType, StartFrom: w.StartFrom, BranchName: w.BranchName, Est: w.Est,
		Notes: w.Notes, Jira: toWireAdeJira(w.Jira), CreatedAt: w.CreatedAt,
		BranchCandidates: w.BranchCandidates,
	}
}

func toWireAdePlan(p ade.PlanFact) AdePlanWire {
	return AdePlanWire{Day: p.Day, Order: p.Order, QueuedAfter: p.QueuedAfter, Unpushed: p.Unpushed}
}

func toWireAdePairs(pairs []ade.PairFact) []AdePair {
	out := make([]AdePair, len(pairs))
	for i, p := range pairs {
		out[i] = AdePair{A: p.A, B: p.B, Shared: p.Shared, Conflicts: p.Conflicts}
	}
	return out
}

func toWireAdeHistory(items []ade.HistoryItem) []AdeHistoryItem {
	out := make([]AdeHistoryItem, len(items))
	for i, h := range items {
		out[i] = AdeHistoryItem{Item: h.Item, Kind: h.Kind, Title: h.Title, Branch: h.Branch, MergedAt: h.MergedAt, ArchivedAt: h.ArchivedAt}
	}
	return out
}

func toWireAdeDependency(d ade.DependencyFact) AdeDependencyWire {
	blocks := d.Blocks
	if blocks == nil {
		blocks = []string{}
	}
	return AdeDependencyWire{ID: d.ID, Title: d.Title, WaitingOn: d.WaitingOn, ExpectedBy: d.ExpectedBy, CreatedAt: d.CreatedAt, Blocks: blocks}
}

func toWireAdeDependencies(deps []ade.DependencyFact) []AdeDependencyWire {
	out := make([]AdeDependencyWire, len(deps))
	for i, d := range deps {
		out[i] = toWireAdeDependency(d)
	}
	return out
}

func toWireAdeSnapshot(s ade.RepoSnapshot) AdeRepoSnapshot {
	branches := make([]AdeBranchWire, len(s.Branches))
	for i, b := range s.Branches {
		branches[i] = toWireAdeBranch(b)
	}
	newWork := make([]AdeNewWorkWire, len(s.NewWork))
	for i, w := range s.NewWork {
		newWork[i] = toWireAdeNewWork(w)
	}
	return AdeRepoSnapshot{
		CodeRepoID: s.CodeRepoID, GitRepoID: s.GitRepoID, Main: toWireAdeMain(s.Main), Remote: s.Remote,
		Branches: branches, NewWork: newWork, Plan: toWireAdePlan(s.Plan), Colors: s.Colors,
		Pairs: toWireAdePairs(s.Pairs), History: toWireAdeHistory(s.History),
		Dependencies: toWireAdeDependencies(s.Dependencies), LastFetchAt: s.LastFetchAt,
		AutofetchMinutes: s.AutofetchMinutes, WorktreeBasePath: s.WorktreeBasePath,
	}
}

func toWireAdePrs(p ade.RepoPrs) AdeRepoPrs {
	out := make(map[string]*AdePr, len(p.Branches))
	for branch, pr := range p.Branches {
		out[branch] = &AdePr{Number: pr.Number, Title: pr.Title, URL: pr.URL, State: pr.State}
	}
	return AdeRepoPrs{Kind: p.Kind, Branches: out, WebURL: p.WebURL}
}

func toWireAdeCandidates(candidates []ade.CandidateBranch) []AdeCandidateBranch {
	out := make([]AdeCandidateBranch, len(candidates))
	for i, c := range candidates {
		out[i] = AdeCandidateBranch{Name: c.Name, Author: c.Author, LastCommitAt: c.LastCommitAt, RemoteOnly: c.RemoteOnly, Mine: c.Mine}
	}
	return out
}

func toWireAdeForcePushResults(results []ade.ForcePushResult) []AdeForcePushResult {
	out := make([]AdeForcePushResult, len(results))
	for i, r := range results {
		out[i] = AdeForcePushResult{Branch: r.Branch, OK: r.OK, Error: r.Error}
	}
	return out
}

func toWireAdeRefreshResult(r ade.RefreshResult) AdeRefreshResult {
	return AdeRefreshResult{RefsChanged: r.RefsChanged, NewlyMerged: r.NewlyMerged, Error: r.Error}
}

func toWireAdeArchiveRisk(r ade.ArchiveRisk) AdeArchiveRiskResult {
	return AdeArchiveRiskResult{Dirty: toWireAdeDirty(r.Dirty), Unmerged: r.Unmerged, Worktree: r.Worktree, Blocked: r.Blocked}
}

// --- Queue validation (P129 Part 2 §5.3) --------------------------------------------------------

var (
	adeJiraKeyRe = regexp.MustCompile(`^[A-Z][A-Z0-9]+-\d+$`)
	adeEstRe     = regexp.MustCompile(`^\d+(\.\d+)?[hd]$`)
	adePullPath  = regexp.MustCompile(`/pull/\d+`)
)

const (
	adeMaxNotesBytes = 1 << 20 // 1 MiB
	adeMaxNameBytes  = 500
	adeMaxURLBytes   = 2048
)

// validateAdeBranchName checks a value that must name a real git ref (branch/branchName/
// startFrom): non-empty, no NUL/space/`:`/leading `-`, <= 255 bytes — real ref validity is git's
// own (an unresolved branch comes back `exists: false` rather than erroring here).
func validateAdeBranchName(value, field string) error {
	if value == "" {
		return ipcerr.New("E_INVALID", field+" is required")
	}
	if len(value) > adeMaxBranchBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if strings.ContainsAny(value, "\x00 :") || strings.HasPrefix(value, "-") {
		return ipcerr.New("E_INVALID", field+" is invalid")
	}
	return nil
}

// validateAdeItemID checks a value naming a queue item (a branch, or a new-work id — "nw:<uuid>",
// which itself carries a `:` — so this is deliberately looser than validateAdeBranchName's own
// git-ref shape: item and after (§5.3's own "Items in SetPlan/SetQueuedAfter..." rule) name either
// kind of item, never only a branch).
func validateAdeItemID(value, field string) error {
	if value == "" {
		return ipcerr.New("E_INVALID", field+" is required")
	}
	if len(value) > adeMaxBranchBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if strings.ContainsAny(value, "\x00\n") {
		return ipcerr.New("E_INVALID", field+" must not contain NUL or newline")
	}
	return nil
}

// validateAdeDependencyID checks a value naming a dependency: validateAdeItemID plus the "dep:"
// prefix (P135 §4.4).
func validateAdeDependencyID(value, field string) error {
	if err := validateAdeItemID(value, field); err != nil {
		return err
	}
	if !strings.HasPrefix(value, "dep:") {
		return ipcerr.New("E_INVALID", field+" must be a dependency id")
	}
	return nil
}

// validateAdeWorkItemID checks a value naming a branch or new-work item, never a dependency:
// validateAdeItemID plus refusing the "dep:" prefix (P135 §4.4) — a dependency never gets a plan
// row, a queue-after link or an archive, even from a hand-built call.
func validateAdeWorkItemID(value, field string) error {
	if err := validateAdeItemID(value, field); err != nil {
		return err
	}
	if strings.HasPrefix(value, "dep:") {
		return ipcerr.New("E_INVALID", field+" must not be a dependency id")
	}
	return nil
}

func validateAdeName(value, field string) error {
	if len(value) > adeMaxNameBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	return nil
}

func validateAdeNotes(notes string) error {
	if len(notes) > adeMaxNotesBytes {
		return ipcerr.New("E_INVALID", "notes is too long")
	}
	return nil
}

func validateAdeEst(est string) error {
	if est == "" {
		return nil
	}
	if !adeEstRe.MatchString(est) {
		return ipcerr.New("E_INVALID", "est is invalid")
	}
	return nil
}

func validateAdeURL(value, field string) error {
	if value == "" {
		return nil
	}
	if len(value) > adeMaxURLBytes {
		return ipcerr.New("E_INVALID", field+" is too long")
	}
	if !strings.HasPrefix(value, "http://") && !strings.HasPrefix(value, "https://") {
		return ipcerr.New("E_INVALID", field+" must be http or https")
	}
	return nil
}

func validateAdeJira(key, url string) error {
	if key != "" && !adeJiraKeyRe.MatchString(key) {
		return ipcerr.New("E_INVALID", "jiraKey is invalid")
	}
	return validateAdeURL(url, "jiraUrl")
}

func validateAdePrURL(prURL string) error {
	if prURL == "" {
		return nil
	}
	if err := validateAdeURL(prURL, "prUrl"); err != nil {
		return err
	}
	if !adePullPath.MatchString(prURL) {
		return ipcerr.New("E_INVALID", "prUrl must contain /pull/<number>")
	}
	return nil
}

func validateAdeISODate(value string) error {
	if _, err := time.Parse("2006-01-02", value); err != nil {
		return ipcerr.New("E_INVALID", "date must be YYYY-MM-DD")
	}
	return nil
}

// adeQueueError maps a Queue/store error to E_INVALID for the two sentinel caller mistakes
// (repos.ErrQueued/ErrArchived, both wrapped with %w, so errors.Is still sees them) — every other
// error is internal. Nil-safe, adeTrackerError's own shape for the Queue surface.
func adeQueueError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, repos.ErrQueued) || errors.Is(err, repos.ErrArchived) ||
		errors.Is(err, repos.ErrNotBlockable) || errors.Is(err, repos.ErrDependencyGone) ||
		errors.Is(err, repos.ErrEstimateShrink) || errors.Is(err, repos.ErrWorkTypeBlocked) ||
		errors.Is(err, repos.ErrWorkTypeInvalid) {
		return ipcerr.New("E_INVALID", err.Error())
	}
	return ipcerr.InternalErr(err)
}

// --- Queue args (P129 Part 2 §5.3) --------------------------------------------------------------

type AdeCodeRepoArgs struct {
	CodeRepoID string `json:"codeRepoId"`
}

func (a AdeCodeRepoArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	return nil
}

type AdeAddBranchArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Branch     string `json:"branch"`
	Kind       string `json:"kind,omitempty"`
}

func (a AdeAddBranchArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeBranchName(a.Branch, "branch"); err != nil {
		return err
	}
	if a.Kind != "" && !model.ValidAdeBranchKind(a.Kind) {
		return ipcerr.New("E_INVALID", "kind is invalid")
	}
	return nil
}

type AdeAddNewWorkArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Title      string `json:"title"`
	JiraKey    string `json:"jiraKey"`
	JiraURL    string `json:"jiraUrl"`
	StartFrom  string `json:"startFrom"`
	Notes      string `json:"notes"`
	Est        string `json:"est"`
}

func (a AdeAddNewWorkArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if a.Title == "" && a.JiraKey == "" {
		return ipcerr.New("E_INVALID", "title or jiraKey is required")
	}
	if err := validateAdeName(a.Title, "title"); err != nil {
		return err
	}
	if err := validateAdeJira(a.JiraKey, a.JiraURL); err != nil {
		return err
	}
	if a.StartFrom != "" {
		if err := validateAdeBranchName(a.StartFrom, "startFrom"); err != nil {
			return err
		}
	}
	if err := validateAdeNotes(a.Notes); err != nil {
		return err
	}
	return validateAdeEst(a.Est)
}

// AdeJiraPatch is the wire's own nested Jira half of AdeNewWorkPatchArgs/AdeBranchMetaPatchArgs
// (§5.3's own "patch{..., jira, ...}") — the store's flat JiraKey/JiraURL pointer pair, grouped to
// match the read side's own nested Jira field.
type AdeJiraPatch struct {
	Key *string `json:"key,omitempty"`
	URL *string `json:"url,omitempty"`
}

func (p *AdeJiraPatch) key() string {
	if p == nil || p.Key == nil {
		return ""
	}
	return *p.Key
}

func (p *AdeJiraPatch) url() string {
	if p == nil || p.URL == nil {
		return ""
	}
	return *p.URL
}

type AdeNewWorkPatchArgs struct {
	Title      *string       `json:"title,omitempty"`
	Jira       *AdeJiraPatch `json:"jira,omitempty"`
	StartFrom  *string       `json:"startFrom,omitempty"`
	Notes      *string       `json:"notes,omitempty"`
	Est        *string       `json:"est,omitempty"`
	BranchName *string       `json:"branchName,omitempty"`
}

func (p AdeNewWorkPatchArgs) validate() error {
	if p.Title != nil {
		if err := validateAdeName(*p.Title, "title"); err != nil {
			return err
		}
	}
	if p.Jira != nil {
		if err := validateAdeJira(p.Jira.key(), p.Jira.url()); err != nil {
			return err
		}
	}
	// §0.13: "" means main (AddNewWork's own convention) — only a non-empty value must name a real
	// ref, matching AdeAddNewWorkArgs.Validate's own "if a.StartFrom != """ gate.
	if p.StartFrom != nil && *p.StartFrom != "" {
		if err := validateAdeBranchName(*p.StartFrom, "startFrom"); err != nil {
			return err
		}
	}
	if p.Notes != nil {
		if err := validateAdeNotes(*p.Notes); err != nil {
			return err
		}
	}
	if p.Est != nil {
		if err := validateAdeEst(*p.Est); err != nil {
			return err
		}
	}
	if p.BranchName != nil {
		if err := validateAdeBranchName(*p.BranchName, "branchName"); err != nil {
			return err
		}
	}
	return nil
}

func (p AdeNewWorkPatchArgs) toModel() model.AdeNewWorkPatch {
	out := model.AdeNewWorkPatch{
		Title: p.Title, StartFrom: p.StartFrom, Notes: p.Notes, Est: p.Est, BranchName: p.BranchName,
	}
	if p.Jira != nil {
		out.JiraKey, out.JiraURL = p.Jira.Key, p.Jira.URL
	}
	return out
}

type AdeUpdateNewWorkArgs struct {
	CodeRepoID string              `json:"codeRepoId"`
	ID         string              `json:"id"`
	Patch      AdeNewWorkPatchArgs `json:"patch"`
}

func (a AdeUpdateNewWorkArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeItemID(a.ID, "id"); err != nil {
		return err
	}
	return a.Patch.validate()
}

// AdeBranchMetaPatchArgs is SetBranchMeta's own patch shape — Kind only ever "mine"/"parked" here
// (§0.11: SetBranchMeta never turns a branch back into "review"; SetWorkType is the review path).
type AdeBranchMetaPatchArgs struct {
	Name  *string       `json:"name,omitempty"`
	Kind  *string       `json:"kind,omitempty"`
	Jira  *AdeJiraPatch `json:"jira,omitempty"`
	PrURL *string       `json:"prUrl,omitempty"`
	Est   *string       `json:"est,omitempty"`
	Notes *string       `json:"notes,omitempty"`
}

func (p AdeBranchMetaPatchArgs) validate() error {
	if p.Name != nil {
		if err := validateAdeName(*p.Name, "name"); err != nil {
			return err
		}
	}
	if p.Kind != nil && *p.Kind != model.AdeBranchKindMine && *p.Kind != model.AdeBranchKindParked {
		return ipcerr.New("E_INVALID", "kind must be mine or parked")
	}
	if p.Jira != nil {
		if err := validateAdeJira(p.Jira.key(), p.Jira.url()); err != nil {
			return err
		}
	}
	if p.PrURL != nil {
		if err := validateAdePrURL(*p.PrURL); err != nil {
			return err
		}
	}
	if p.Est != nil {
		if err := validateAdeEst(*p.Est); err != nil {
			return err
		}
	}
	if p.Notes != nil {
		if err := validateAdeNotes(*p.Notes); err != nil {
			return err
		}
	}
	return nil
}

func (p AdeBranchMetaPatchArgs) toModel() model.AdeBranchMetaPatch {
	out := model.AdeBranchMetaPatch{Name: p.Name, Kind: p.Kind, PrURL: p.PrURL, Est: p.Est, Notes: p.Notes}
	if p.Jira != nil {
		out.JiraKey, out.JiraURL = p.Jira.Key, p.Jira.URL
	}
	return out
}

type AdeSetBranchMetaArgs struct {
	CodeRepoID string                 `json:"codeRepoId"`
	Branch     string                 `json:"branch"`
	Patch      AdeBranchMetaPatchArgs `json:"patch"`
}

func (a AdeSetBranchMetaArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeBranchName(a.Branch, "branch"); err != nil {
		return err
	}
	return a.Patch.validate()
}

// AdeSetWorkTypeArgs is SetWorkType's own argument shape (P136 §3.5).
type AdeSetWorkTypeArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Item       string `json:"item"`
	WorkType   string `json:"workType"`
}

func (a AdeSetWorkTypeArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeWorkItemID(a.Item, "item"); err != nil {
		return err
	}
	if !model.ValidAdeWorkType(a.WorkType) {
		return ipcerr.New("E_INVALID", "workType must be work, investigate, review or test")
	}
	return nil
}

type AdeSetPlanArgs struct {
	CodeRepoID string             `json:"codeRepoId"`
	Days       map[string]*string `json:"days"`
	Order      []string           `json:"order"`
}

func (a AdeSetPlanArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	for item, day := range a.Days {
		if err := validateAdeWorkItemID(item, "days item"); err != nil {
			return err
		}
		if day != nil {
			if err := validateAdeISODate(*day); err != nil {
				return err
			}
		}
	}
	for _, item := range a.Order {
		if err := validateAdeWorkItemID(item, "order item"); err != nil {
			return err
		}
	}
	return nil
}

type AdeSetQueuedAfterArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Item       string `json:"item"`
	After      string `json:"after"`
}

func (a AdeSetQueuedAfterArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeWorkItemID(a.Item, "item"); err != nil {
		return err
	}
	if a.After == "" {
		return nil
	}
	if err := validateAdeWorkItemID(a.After, "after"); err != nil {
		return err
	}
	if a.After == a.Item {
		return ipcerr.New("E_INVALID", "after must not equal item")
	}
	return nil
}

type AdeBindNewWorkArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	ID         string `json:"id"`
	Branch     string `json:"branch"`
}

func (a AdeBindNewWorkArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeItemID(a.ID, "id"); err != nil {
		return err
	}
	return validateAdeBranchName(a.Branch, "branch")
}

type AdeForcePushArgs struct {
	CodeRepoID       string   `json:"codeRepoId"`
	Branches         []string `json:"branches"`
	ConfirmProtected []string `json:"confirmProtected,omitempty"`
}

func (a AdeForcePushArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	for _, b := range a.Branches {
		if err := validateAdeBranchName(b, "branches"); err != nil {
			return err
		}
	}
	for _, b := range a.ConfirmProtected {
		if err := validateAdeBranchName(b, "confirmProtected"); err != nil {
			return err
		}
	}
	return nil
}

type AdeItemArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Item       string `json:"item"`
}

func (a AdeItemArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	return validateAdeWorkItemID(a.Item, "item")
}

type AdeArchiveArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Item       string `json:"item"`
	Discard    bool   `json:"discard"`
}

func (a AdeArchiveArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	return validateAdeWorkItemID(a.Item, "item")
}

// AdeAddDependencyArgs is AddDependency's own argument shape (P135 §4.4). Blocks names the items
// linked as blocked by this dependency at creation, at most 50.
type AdeAddDependencyArgs struct {
	CodeRepoID string   `json:"codeRepoId"`
	Title      string   `json:"title"`
	WaitingOn  string   `json:"waitingOn"`
	ExpectedBy string   `json:"expectedBy"`
	Blocks     []string `json:"blocks"`
}

const adeMaxDependencyBlocks = 50

func (a AdeAddDependencyArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if a.Title == "" {
		return ipcerr.New("E_INVALID", "title is required")
	}
	if err := validateAdeName(a.Title, "title"); err != nil {
		return err
	}
	if err := validateAdeNotes(a.WaitingOn); err != nil {
		return err
	}
	if a.ExpectedBy != "" {
		if err := validateAdeISODate(a.ExpectedBy); err != nil {
			return err
		}
	}
	if len(a.Blocks) > adeMaxDependencyBlocks {
		return ipcerr.New("E_INVALID", "blocks has too many items")
	}
	for _, item := range a.Blocks {
		if err := validateAdeWorkItemID(item, "blocks item"); err != nil {
			return err
		}
	}
	return nil
}

// AdeDependencyPatchArgs is UpdateDependency's own patch shape (§4.4) — pointer fields, present
// only when the caller means to change them. ExpectedBy of "" clears the date.
type AdeDependencyPatchArgs struct {
	Title      *string `json:"title,omitempty"`
	WaitingOn  *string `json:"waitingOn,omitempty"`
	ExpectedBy *string `json:"expectedBy,omitempty"`
}

func (p AdeDependencyPatchArgs) validate() error {
	if p.Title != nil {
		if *p.Title == "" {
			return ipcerr.New("E_INVALID", "title is required")
		}
		if err := validateAdeName(*p.Title, "title"); err != nil {
			return err
		}
	}
	if p.WaitingOn != nil {
		if err := validateAdeNotes(*p.WaitingOn); err != nil {
			return err
		}
	}
	if p.ExpectedBy != nil && *p.ExpectedBy != "" {
		if err := validateAdeISODate(*p.ExpectedBy); err != nil {
			return err
		}
	}
	return nil
}

func (p AdeDependencyPatchArgs) toModel() model.AdeDependencyPatch {
	return model.AdeDependencyPatch{Title: p.Title, WaitingOn: p.WaitingOn, ExpectedBy: p.ExpectedBy}
}

type AdeUpdateDependencyArgs struct {
	CodeRepoID string                 `json:"codeRepoId"`
	ID         string                 `json:"id"`
	Patch      AdeDependencyPatchArgs `json:"patch"`
}

func (a AdeUpdateDependencyArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeDependencyID(a.ID, "id"); err != nil {
		return err
	}
	return a.Patch.validate()
}

// AdeDependencyArgs names one dependency (Resolve).
type AdeDependencyArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	ID         string `json:"id"`
}

func (a AdeDependencyArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	return validateAdeDependencyID(a.ID, "id")
}

// AdeSetBlockerArgs links or unlinks one dependency to one work item (P135 §4.4).
type AdeSetBlockerArgs struct {
	CodeRepoID string `json:"codeRepoId"`
	Dependency string `json:"dependency"`
	Item       string `json:"item"`
	Linked     bool   `json:"linked"`
}

func (a AdeSetBlockerArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
	if err := validateAdeDependencyID(a.Dependency, "dependency"); err != nil {
		return err
	}
	return validateAdeWorkItemID(a.Item, "item")
}

type AdeProvideCredentialArgs struct {
	RequestID string  `json:"requestId"`
	Secret    *string `json:"secret,omitempty"`
}

func (a AdeProvideCredentialArgs) Validate() error {
	if a.RequestID == "" {
		return ipcerr.New("E_INVALID", "requestId is required")
	}
	return nil
}

// --- Queue methods (P129 Part 2 §5.3) -----------------------------------------------------------

// RepoSnapshot is the queue board's own full read (§5.1) — every queued branch/new-work item's
// assembled facts, the plan, colors, pairs and history.
func (s *AdeService) RepoSnapshot(ctx context.Context, args AdeCodeRepoArgs) (AdeRepoSnapshot, error) {
	if err := args.Validate(); err != nil {
		return AdeRepoSnapshot{}, err
	}
	snap, err := s.Queue.Snapshot(ctx, args.CodeRepoID)
	if err != nil {
		return AdeRepoSnapshot{}, adeQueueError(err)
	}
	return toWireAdeSnapshot(snap), nil
}

// RepoPrs resolves every queued branch's own PR state (§5.3) — a separate call from RepoSnapshot
// since it's the slower, best-effort half (ResolveBranchPr may be disabled/unavailable).
func (s *AdeService) RepoPrs(ctx context.Context, args AdeCodeRepoArgs) (AdeRepoPrs, error) {
	if err := args.Validate(); err != nil {
		return AdeRepoPrs{}, err
	}
	prs, err := s.Queue.Prs(ctx, args.CodeRepoID)
	if err != nil {
		return AdeRepoPrs{}, adeQueueError(err)
	}
	return toWireAdePrs(prs), nil
}

// CandidateBranches lists every branch not yet queued or archived (§5.3), newest commit first.
func (s *AdeService) CandidateBranches(ctx context.Context, args AdeCodeRepoArgs) ([]AdeCandidateBranch, error) {
	if err := args.Validate(); err != nil {
		return nil, err
	}
	candidates, err := s.Queue.Candidates(ctx, args.CodeRepoID)
	if err != nil {
		return nil, adeQueueError(err)
	}
	return toWireAdeCandidates(candidates), nil
}

// AddBranch queues an existing branch (§5.3) — kind defaults to mine/review by author-email match
// when Kind is "".
func (s *AdeService) AddBranch(ctx context.Context, args AdeAddBranchArgs) (string, error) {
	if err := args.Validate(); err != nil {
		return "", err
	}
	id, err := s.Queue.AddBranch(ctx, args.CodeRepoID, args.Branch, args.Kind)
	if err != nil {
		return "", adeQueueError(err)
	}
	return id, nil
}

// AddNewWork queues a piece of work with no branch yet (§0.10).
func (s *AdeService) AddNewWork(args AdeAddNewWorkArgs) (string, error) {
	if err := args.Validate(); err != nil {
		return "", err
	}
	id, err := s.Queue.AddNewWork(args.CodeRepoID, ade.NewWorkInput{
		Title: args.Title, JiraKey: args.JiraKey, JiraURL: args.JiraURL,
		StartFrom: args.StartFrom, Notes: args.Notes, Est: args.Est,
	})
	if err != nil {
		return "", adeQueueError(err)
	}
	return id, nil
}

func (s *AdeService) UpdateNewWork(args AdeUpdateNewWorkArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.UpdateNewWork(args.CodeRepoID, args.ID, args.Patch.toModel()))
}

func (s *AdeService) SetBranchMeta(args AdeSetBranchMetaArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.SetBranchMeta(args.CodeRepoID, args.Branch, args.Patch.toModel()))
}

func (s *AdeService) SetWorkType(args AdeSetWorkTypeArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.SetWorkType(args.CodeRepoID, args.Item, args.WorkType))
}

func (s *AdeService) SetPlan(args AdeSetPlanArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.SetPlan(args.CodeRepoID, args.Days, args.Order))
}

func (s *AdeService) SetQueuedAfter(args AdeSetQueuedAfterArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.SetQueuedAfter(args.CodeRepoID, args.Item, args.After))
}

// BindNewWork is §0.10's own explicit resolution path for the ambiguous-candidates case.
func (s *AdeService) BindNewWork(ctx context.Context, args AdeBindNewWorkArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.BindNewWork(ctx, args.CodeRepoID, args.ID, args.Branch))
}

// Refresh fetches the repo's default remote and recomputes facts (§6.1).
func (s *AdeService) Refresh(ctx context.Context, args AdeCodeRepoArgs) (AdeRefreshResult, error) {
	if err := args.Validate(); err != nil {
		return AdeRefreshResult{}, err
	}
	res, err := s.Queue.Refresh(ctx, args.CodeRepoID)
	if err != nil {
		return AdeRefreshResult{}, adeQueueError(err)
	}
	return toWireAdeRefreshResult(res), nil
}

// ForcePush runs --force-with-lease --force-if-includes per branch (§6.2); confirmProtected names
// the branches whose own protected-branch confirm prompt the caller already answered.
func (s *AdeService) ForcePush(ctx context.Context, args AdeForcePushArgs) ([]AdeForcePushResult, error) {
	if err := args.Validate(); err != nil {
		return nil, err
	}
	res, err := s.Queue.ForcePush(ctx, args.CodeRepoID, args.Branches, args.ConfirmProtected)
	if err != nil {
		return nil, adeQueueError(err)
	}
	return toWireAdeForcePushResults(res), nil
}

// ArchiveRisk previews Archive's own consequences (dirty files, unmerged commits, a blocking
// worktree state) before the caller confirms (§6.3).
func (s *AdeService) ArchiveRisk(ctx context.Context, args AdeItemArgs) (AdeArchiveRiskResult, error) {
	if err := args.Validate(); err != nil {
		return AdeArchiveRiskResult{}, err
	}
	risk, err := s.Queue.ArchiveRisk(ctx, args.CodeRepoID, args.Item)
	if err != nil {
		return AdeArchiveRiskResult{}, adeQueueError(err)
	}
	return toWireAdeArchiveRisk(risk), nil
}

// Archive moves item to history — discard true removes a linked worktree's own uncommitted
// changes rather than refusing (§6.3).
func (s *AdeService) Archive(ctx context.Context, args AdeArchiveArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.Archive(ctx, args.CodeRepoID, args.Item, args.Discard))
}

// AddDependency creates a new external dependency, optionally linking it as a blocker of the given
// items at creation (P135 §4.4). No openRepo, no git access of any kind.
func (s *AdeService) AddDependency(args AdeAddDependencyArgs) (string, error) {
	if err := args.Validate(); err != nil {
		return "", err
	}
	id, err := s.Queue.AddDependency(args.CodeRepoID, ade.DependencyInput{
		Title: args.Title, WaitingOn: args.WaitingOn, ExpectedBy: args.ExpectedBy, Blocks: args.Blocks,
	})
	if err != nil {
		return "", adeQueueError(err)
	}
	return id, nil
}

func (s *AdeService) UpdateDependency(args AdeUpdateDependencyArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.UpdateDependency(args.CodeRepoID, args.ID, args.Patch.toModel()))
}

// ResolveDependency ends a dependency's lifecycle (§4.2): sets resolved_at, deletes its links,
// moves it to History. No confirmation, no "unresolve".
func (s *AdeService) ResolveDependency(args AdeDependencyArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.ResolveDependency(args.CodeRepoID, args.ID))
}

func (s *AdeService) SetBlocker(args AdeSetBlockerArgs) error {
	if err := args.Validate(); err != nil {
		return err
	}
	return adeQueueError(s.Queue.SetBlocker(args.CodeRepoID, args.Dependency, args.Item, args.Linked))
}

// ProvideCredential answers a pending kira:ade:credential prompt (§6.5) — true when requestId
// named a still-pending request.
func (s *AdeService) ProvideCredential(args AdeProvideCredentialArgs) (bool, error) {
	if err := args.Validate(); err != nil {
		return false, err
	}
	return s.Queue.ProvideCredential(args.RequestID, args.Secret), nil
}

// AdeRepoChanged is Queue.OnRepoChanged's own target (main.go) — a debounced per-repo signal
// (§5.1's own 250ms) telling every window "re-fetch RepoSnapshot for this codeRepoId", all windows
// since more than one can have the same repo's queue board open.
func AdeRepoChanged(ev *Events, codeRepoID string) {
	ev.emit.Emit(ChannelAdeRepo, AdeRepoChangedEvent{CodeRepoID: codeRepoID})
}

// AdeRepoChangedEvent is ChannelAdeRepo's own payload.
type AdeRepoChangedEvent struct {
	CodeRepoID string `json:"codeRepoId"`
}

// AdeCredentialRequested is Queue.OnCredential's own target (main.go) — EmitFocused, since a
// credential prompt belongs to whichever window is driving the op that triggered it (§6.5), the
// same "addressed to the focused window" reasoning appevent.Events.Signal already documents.
func AdeCredentialRequested(ev *Events, payload any) {
	ev.emit.EmitFocused(ChannelAdeCredential, payload)
}
