package bridge

import "github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"

// ChannelCodeSearch is C7 D7's own push channel — a repository-wide search's coalesced file
// groups, delivered with EmitTo (one window only).
const ChannelCodeSearch = "kira:code:search"

// ChannelGitPairing and ChannelGitClientsChanged are G1's own two push channels — the pairing
// prompt's live queue snapshot, and the Connected editors pane's list. P100 Part 2's own
// frontend/main.go work is what actually subscribes gitsock's OnPairingChanged/OnClientsChanged
// and pushes through these.
const (
	ChannelGitPairing        = "kira:git:pairing"
	ChannelGitClientsChanged = "kira:git:clients"
)

// ChannelSettingsChanged/ChannelLayoutChanged are SettingsService.Set/LayoutService.Set's own
// broadcasts — Kira Studio's own two channels of the same name, unchanged shape.
const (
	ChannelSettingsChanged = "kira:settings:changed"
	ChannelLayoutChanged   = "kira:layout:changed"
)

// ChannelFlushBeforeClose/ChannelWindowFlushBeforeClose are the quit-wide and per-window flush
// handshakes' own trigger channels — Kira Studio's own two channels of the same name
// (internal/shell/quit.go, internal/shell/closeflush.go).
const (
	ChannelFlushBeforeClose       = "kira:app:flush-before-close"
	ChannelWindowFlushBeforeClose = "kira:window:flush-before-close"
)

// ChannelTerminal is the embedded terminal's own push channel — Kira Studio's own
// ChannelTerminal (internal/bridge/terminal.go's own coalescer), EmitTo'd to the one window that
// opened it.
const ChannelTerminal = "kira:terminal:data"

// Events is the Go->renderer push wrapper every bridge service that emits goes through — Kira
// Studio's own bridge.Events (internal/bridge/events.go), trimmed: this app has no
// Connections/Oplog/Metrics/DbMcp producers to Attach, so this copy keeps only the signal/
// broadcast primitives and the settings/layout convenience wrappers those two services use.
type Events struct {
	emit appcore.Emitter
}

func NewEvents(e appcore.Emitter) *Events {
	return &Events{emit: e}
}

// Signal emits a payload-free channel to the focused window only — the menu's own commands.
func (ev *Events) Signal(channel string) {
	ev.emit.EmitFocused(channel, nil)
}

// SignalTo is Signal's single-window analogue, aimed by key rather than by focus — the per-window
// close-flush handshake's own trigger.
func (ev *Events) SignalTo(windowKey, channel string) {
	ev.emit.EmitTo(windowKey, channel, nil)
}

// Broadcast emits a payload-free channel to every window — the quit handshake's own trigger
// (ChannelFlushBeforeClose): every window must flush before quitting, not only the focused one.
func (ev *Events) Broadcast(channel string) {
	ev.emit.Emit(channel, nil)
}
