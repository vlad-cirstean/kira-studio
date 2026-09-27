package bridge

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/ade"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
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
// mirroring the stored row exactly (never synthesised).
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
}

func toWireAdeSession(s model.AdeSession) AdeSessionWire {
	return AdeSessionWire{
		ID: s.ID, ClaudeSessionID: s.ClaudeSessionID, CodeRepoID: s.CodeRepoID, Branch: s.Branch,
		NewWorkID: s.NewWorkID, Cwd: s.Cwd, State: s.State, TerminalID: s.TerminalID,
		StartedAt: s.StartedAt, LastActiveAt: s.LastActiveAt,
	}
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
func (a AdePrepareLaunchArgs) Validate() error {
	if a.CodeRepoID == "" {
		return ipcerr.New("E_INVALID", "codeRepoId is required")
	}
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
	if len(a.Message) > adeMaxMessageBytes {
		return ipcerr.New("E_INVALID", "message is too long")
	}
	return nil
}

// AdePrepareLaunchResult is PrepareLaunch's own return shape — the renderer mounts
// TerminalHostView for TerminalID with Command and launchKind: 'claude-code' (§4.2 step 2).
type AdePrepareLaunchResult struct {
	TerminalID string `json:"terminalId"`
	SessionID  string `json:"sessionId"`
	Command    string `json:"command"`
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

// adeTrackerError maps a Tracker sentinel error to E_INVALID with its own message (a caller
// mistake: an unknown or wrong-state resume target), or wraps anything else as internal.
func adeTrackerError(err error) error {
	switch err {
	case ade.ErrSessionNotFound, ade.ErrSessionWrongRepo, ade.ErrSessionRunning,
		ade.ErrSessionNotRunning, ade.ErrCommandMismatch:
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
	return AdePrepareLaunchResult{TerminalID: res.TerminalID, SessionID: res.SessionID, Command: res.Command}, nil
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
