// Package agentnotify turns Claude Code hook events and ADE headless run changes into desktop
// notifications. It decides whether to notify (preferences, wake tracking, focus, cooldown) and
// builds the text; a Sink posts it. The macOS sink lives in sink_darwin.go.
package agentnotify

import (
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/agenthooks"
)

// Kind is what a notification is about.
type Kind string

const (
	KindFinished   Kind = "finished"
	KindNeedsInput Kind = "needs-input"
	KindRunEnded   Kind = "run-ended"
	KindTest       Kind = "test"
)

// Note is one notification. The id fields round-trip through the OS notification so a click can
// find its target.
type Note struct {
	ID, Title, Body                         string
	Kind                                    Kind
	TerminalID, WindowKey, RecordID, TaskID string
}

// Sink posts a Note to the OS.
type Sink interface{ Send(Note) error }

// Prefs are the claudeCode.notify* settings.
type Prefs struct {
	Enabled, OnFinished, OnNeedsInput, OnRunEnded, IncludeMessage bool
}

// Target says what a hook event or run belongs to. Name is the task title, else the code
// repository name, else the cwd's basename.
type Target struct{ Name, WindowKey, RecordID, TaskID string }

// FocusState is what one window reports about what the user is looking at.
type FocusState struct {
	WindowKey        string
	Focused          bool
	Module           string
	ActiveTerminalID string
	AdeTaskID        string
}

// Deps are the seams the Notifier reads.
type Deps struct {
	Prefs     func() Prefs
	Describe  func(terminalID, cwd string) Target
	TaskTitle func(taskID string) string
	// Alive reports whether a window still exists; a closed window's last focus report is ignored.
	Alive  func(windowKey string) bool
	Focus  func(windowKey string) bool
	Reveal func(n Note)
	Now    func() time.Time
}

// Cooldown is the minimum gap between two notes of one kind for one terminal or run. A var so a
// flow test can shorten it.
var Cooldown = 10 * time.Second

const (
	maxBodyBytes = 200
	// maxTrackedRuns bounds the run-state map; a reset only costs one missed note per live run.
	maxTrackedRuns = 4096
	bodyFinished   = "Open Kira Space to read the reply"
	bodyInput      = "Open Kira Space to answer"
	bodyRun        = "Open Kira Space to see the result"
	bodyTest       = "Notifications are working."
)

// wakeTools mirrors workbench agentActivity.ts WAKE_TOOLS: a session that armed one waits on a
// wake-up, so its Stop is not "finished".
var wakeTools = map[string]bool{"Monitor": true, "ScheduleWakeup": true}

// Notifier is safe for concurrent use.
type Notifier struct {
	d Deps

	mu    sync.Mutex
	sink  Sink
	focus map[string]FocusState
	wake  map[string]bool
	runs  map[string]adewire.RunState
	last  map[string]time.Time
}

func New(d Deps) *Notifier {
	if d.Now == nil {
		d.Now = time.Now
	}
	return &Notifier{
		d: d, focus: map[string]FocusState{}, wake: map[string]bool{},
		runs: map[string]adewire.RunState{}, last: map[string]time.Time{},
	}
}

// SetSink installs the OS sink; nil drops every note.
func (n *Notifier) SetSink(s Sink) {
	n.mu.Lock()
	n.sink = s
	n.mu.Unlock()
}

// ReportFocus records what one window shows now.
func (n *Notifier) ReportFocus(f FocusState) {
	n.mu.Lock()
	n.focus[f.WindowKey] = f
	n.mu.Unlock()
}

// HandleEvent reacts to one hook event.
func (n *Notifier) HandleEvent(ev agenthooks.Event) {
	n.mu.Lock()
	armed := n.wake[ev.TerminalID]
	switch ev.Event {
	case "PreToolUse":
		if wakeTools[ev.ToolName] {
			n.wake[ev.TerminalID] = true
		}
		n.mu.Unlock()
		return
	case "UserPromptSubmit", "SessionStart":
		delete(n.wake, ev.TerminalID)
		n.mu.Unlock()
		return
	case "SessionEnd":
		delete(n.wake, ev.TerminalID)
		n.mu.Unlock()
		return
	case "Stop":
		delete(n.wake, ev.TerminalID)
	}
	n.mu.Unlock()

	switch ev.Event {
	case "Stop":
		if armed {
			return
		}
		n.notifyTerminal(KindFinished, ev, ev.LastAssistantMessage)
	case "Notification":
		if needsInput(ev) {
			n.notifyTerminal(KindNeedsInput, ev, ev.Message)
		}
	}
}

// needsInput: a permission or elicitation prompt, or an untyped message from an older CLI.
func needsInput(ev agenthooks.Event) bool {
	switch ev.NotificationType {
	case "permission_prompt", "elicitation_dialog":
		return true
	case "":
		return ev.Message != ""
	}
	return false
}

func (n *Notifier) notifyTerminal(kind Kind, ev agenthooks.Event, message string) {
	p := n.d.Prefs()
	if !p.Enabled || (kind == KindFinished && !p.OnFinished) || (kind == KindNeedsInput && !p.OnNeedsInput) {
		return
	}
	t := n.d.Describe(ev.TerminalID, ev.Cwd)
	fallback, verb := bodyFinished, "finished"
	if kind == KindNeedsInput {
		fallback, verb = bodyInput, "needs input"
	}
	note := Note{
		ID: string(kind) + ":" + ev.TerminalID, Kind: kind, Title: "Claude " + verb + " · " + t.Name,
		Body: body(p, message, fallback), TerminalID: ev.TerminalID, WindowKey: t.WindowKey,
		RecordID: t.RecordID, TaskID: t.TaskID,
	}
	n.mu.Lock()
	if n.watchedLocked(t, ev.TerminalID) || !n.admitLocked(note.ID) {
		n.mu.Unlock()
		return
	}
	sink := n.sink
	n.mu.Unlock()
	n.send(sink, note)
}

// HandleRuns reacts to changed ADE headless runs.
func (n *Notifier) HandleRuns(runs []adewire.Run) {
	var ended []adewire.Run
	n.mu.Lock()
	if len(n.runs) > maxTrackedRuns {
		n.runs = map[string]adewire.RunState{}
	}
	for _, r := range runs {
		prev, seen := n.runs[r.ID]
		n.runs[r.ID] = r.State
		if seen && !runEnded(prev) && runEnded(r.State) {
			ended = append(ended, r)
		}
	}
	n.mu.Unlock()
	if len(ended) == 0 {
		return
	}
	p := n.d.Prefs()
	if !p.Enabled || !p.OnRunEnded {
		return
	}
	for _, r := range ended {
		name := n.d.TaskTitle(r.TaskID)
		detail := r.Summary
		if detail == "" {
			detail = r.Note
		}
		note := Note{
			ID: string(KindRunEnded) + ":" + r.ID, Kind: KindRunEnded, TaskID: r.TaskID,
			Title: "ADE run " + string(r.State) + " · " + name, Body: body(p, detail, bodyRun),
		}
		n.mu.Lock()
		if n.watchedRunLocked(r.TaskID) || !n.admitLocked(note.ID) {
			n.mu.Unlock()
			continue
		}
		sink := n.sink
		n.mu.Unlock()
		n.send(sink, note)
	}
}

func runEnded(s adewire.RunState) bool {
	return s == "done" || s == "failed" || s == "stuck"
}

// SendTest posts a test note, ignoring cooldown and focus; it honours the master switch.
func (n *Notifier) SendTest() {
	if !n.d.Prefs().Enabled {
		return
	}
	n.mu.Lock()
	sink := n.sink
	n.mu.Unlock()
	n.send(sink, Note{ID: "test:kira", Kind: KindTest, Title: "Kira Space notifications", Body: bodyTest})
}

// Click routes an OS notification click back to the window that should show its target.
func (n *Notifier) Click(data map[string]any) {
	str := func(k string) string {
		s, _ := data[k].(string)
		return s
	}
	note := Note{
		Kind: Kind(str("kind")), TerminalID: str("terminalId"), WindowKey: str("windowKey"),
		RecordID: str("recordId"), TaskID: str("taskId"),
	}
	if n.d.Reveal != nil {
		n.d.Reveal(note)
	}
}

func (n *Notifier) send(sink Sink, note Note) {
	if sink == nil {
		return
	}
	// A failed post (denied permission, missing bundle) is the sink's to log; the next event retries.
	_ = sink.Send(note)
}

// watchedLocked reports whether the user already looks at the session behind t.
func (n *Notifier) watchedLocked(t Target, terminalID string) bool {
	f, ok := n.focus[t.WindowKey]
	if !ok || !f.Focused {
		return false
	}
	if f.ActiveTerminalID != "" && f.ActiveTerminalID == terminalID {
		return true
	}
	return t.TaskID != "" && f.Module == "ade" && f.AdeTaskID == t.TaskID
}

func (n *Notifier) watchedRunLocked(taskID string) bool {
	for key, f := range n.focus {
		if f.Focused && f.Module == "ade" && f.AdeTaskID == taskID && (n.d.Alive == nil || n.d.Alive(key)) {
			return true
		}
	}
	return false
}

// admitLocked applies the cooldown to key and records the post.
func (n *Notifier) admitLocked(key string) bool {
	now := n.d.Now()
	if at, ok := n.last[key]; ok && now.Sub(at) < Cooldown {
		return false
	}
	for k, at := range n.last {
		if now.Sub(at) >= Cooldown {
			delete(n.last, k)
		}
	}
	n.last[key] = now
	return true
}

func body(p Prefs, message, fallback string) string {
	if !p.IncludeMessage {
		return fallback
	}
	if line := oneLine(message); line != "" {
		return line
	}
	return fallback
}

// oneLine collapses whitespace and bounds the result on a rune boundary.
func oneLine(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) <= maxBodyBytes {
		return s
	}
	s = s[:maxBodyBytes]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
