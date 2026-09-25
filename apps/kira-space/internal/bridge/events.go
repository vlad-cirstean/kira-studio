package bridge

import "github.com/kirathecat/kira-studio/internal/appevent"

// ChannelCodeSearch is C7 D7's own push channel — a repository-wide search's coalesced file
// groups, delivered with EmitTo (one window only). P103 Part 3: byte-identical to Kira Studio's
// own channel of the same name, hoisted to repo-root internal/appevent and re-exported here so no
// call site in this package has to change.
const ChannelCodeSearch = appevent.ChannelCodeSearch

// ChannelGitPairing and ChannelGitClientsChanged are G1's own two push channels — the pairing
// prompt's live queue snapshot, and the Connected editors pane's list. GitClientsService.AttachPush
// (gitclients.go) subscribes gitsock's Broker.Subscribe/OnClientsChanged and pushes through these;
// main.go calls it once at startup.
const (
	ChannelGitPairing        = "kira:git:pairing"
	ChannelGitClientsChanged = "kira:git:clients"
)

// ChannelSettingsChanged/ChannelLayoutChanged are SettingsService.Set/LayoutService.Set's own
// broadcasts — Kira Studio's own two channels of the same name, unchanged shape.
const (
	ChannelSettingsChanged = appevent.ChannelSettingsChanged
	ChannelLayoutChanged   = appevent.ChannelLayoutChanged
)

// ChannelFlushBeforeClose/ChannelWindowFlushBeforeClose are the quit-wide and per-window flush
// handshakes' own trigger channels — Kira Studio's own two channels of the same name
// (internal/shell/quit.go, internal/shell/closeflush.go).
const (
	ChannelFlushBeforeClose       = appevent.ChannelFlushBeforeClose
	ChannelWindowFlushBeforeClose = appevent.ChannelWindowFlushBeforeClose
)

// ChannelTerminal is the embedded terminal's own push channel — Kira Studio's own
// ChannelTerminal (internal/bridge/terminal.go's own coalescer), EmitTo'd to the one window that
// opened it.
const ChannelTerminal = appevent.ChannelTerminal

// The five below are P116's own window-chrome-parity channels (G1-G5/G7) — Kira Studio's own
// channels of the same name, hoisted to repo-root internal/appevent.
const (
	ChannelOpenSettings       = appevent.ChannelOpenSettings
	ChannelToggleProjectPanel = appevent.ChannelToggleProjectPanel
	ChannelTabNext            = appevent.ChannelTabNext
	ChannelTabPrev            = appevent.ChannelTabPrev
	ChannelTabClose           = appevent.ChannelTabClose
	ChannelKeepAwake          = appevent.ChannelKeepAwake
	ChannelAppMetrics         = appevent.ChannelAppMetrics
)

// Events is the Go->renderer push wrapper every bridge service that emits goes through — Kira
// Studio's own bridge.Events (internal/bridge/events.go), trimmed: this app has no
// Connections/Oplog/Metrics/DbMcp producers to Attach. Signal/SignalTo/Broadcast come entirely
// from the embedded *appevent.Events core (P103 Part 3) — this app has no per-service wrapper
// method that needs a raw Emit of its own, unlike Kira Studio's SettingsChanged.
type Events struct {
	*appevent.Events
}

func NewEvents(e appevent.Emitter) *Events {
	return &Events{Events: appevent.NewEvents(e)}
}
