package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/metrics"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// Channel holds today's exact IPC channel strings (packages/shared/protocol/ipc.ts's IPC const), which
// are the Wails event names verbatim (P52 §7.1) — the renderer's subscribe mechanism changes, the
// wire name does not.
const (
	ChannelOpenSettings           = "kira:open-settings"
	ChannelNewConnection          = "kira:menu:new-connection"
	ChannelToggleProjectPanel     = "kira:menu:toggle-project-panel"
	ChannelToggleOperationsPanel  = "kira:menu:toggle-operations-panel"
	ChannelCommandPalette         = "kira:menu:command-palette"
	ChannelTabNext                = "kira:menu:tab-next"
	ChannelTabPrev                = "kira:menu:tab-prev"
	ChannelTabClose               = "kira:menu:tab-close"
	ChannelViewFind               = "kira:menu:view-find"
	ChannelViewRefresh            = "kira:menu:view-refresh"
	ChannelViewRun                = "kira:menu:view-run"
	ChannelViewRunAll             = "kira:menu:view-run-all"
	ChannelViewFormat             = "kira:menu:view-format"
	ChannelFlushBeforeClose       = "kira:app:flush-before-close"
	ChannelWindowFlushBeforeClose = "kira:window:flush-before-close"
	ChannelConnectionState        = "kira:connection:state"
	ChannelMetadataInvalidated    = "kira:connection:metadataInvalidated"
	ChannelConnectionsChanged     = "kira:connections:changed"
	ChannelSettingsChanged        = "kira:settings:changed"
	ChannelLayoutChanged          = "kira:layout:changed"
	ChannelOpUpdate               = "kira:op:update"
	ChannelAppMetrics             = "kira:app:metrics"
	ChannelSchemaChanged          = "kira:schema:changed"
)

// ChannelEngineState is declared for completeness and deliberately never emitted: nothing in
// src/main sends it and nothing in apps/kira-studio/frontend/src subscribes to it (P56 D5). P57 deletes it.
const ChannelEngineState = "kira:engine:state"

// Sources are the five push producers P55 left as seams (P55 D15). Each is a one-method
// interface, small enough to drive with a plain recorder rather than a real service — there is
// no dedicated events_test.go in this package (P56's own test-bar pruning removed it; this
// comment used to still claim otherwise, corrected here per P8 C8).
type Sources struct {
	Connections interface {
		OnStateChange(func(model.ConnectionState)) func()
		OnMetadataInvalidated(func(string)) func()
		OnListChanged(func([]model.ConnectionSummary)) func()
	}
	Oplog interface {
		OnUpdate(func(model.OpRecord)) func()
	}
	Metrics interface {
		OnSample(func(metrics.Sample)) func()
	}
}

// Events is the Go analogue of the five push-side listeners src/main/index.ts wires (:58, :99-
// 102) plus the menu/quit signal channels. It is the only thing in this package that emits.
type Events struct {
	emit appcore.Emitter
}

func NewEvents(e appcore.Emitter) *Events {
	return &Events{emit: e}
}

// Attach subscribes to every producer in s and returns one detach that unsubscribes all of them.
// It is called once at startup and detached first in the quit teardown (P56 D3), so nothing
// emits into a half-torn-down app.
func (ev *Events) Attach(s Sources) (detach func()) {
	unsubState := s.Connections.OnStateChange(func(st model.ConnectionState) {
		ev.emit.Emit(ChannelConnectionState, st)
	})
	unsubInvalidated := s.Connections.OnMetadataInvalidated(func(connectionID string) {
		ev.emit.Emit(ChannelMetadataInvalidated, connectionID)
	})
	unsubList := s.Connections.OnListChanged(func(list []model.ConnectionSummary) {
		ev.emit.Emit(ChannelConnectionsChanged, list)
	})
	unsubOplog := s.Oplog.OnUpdate(func(rec model.OpRecord) {
		ev.emit.Emit(ChannelOpUpdate, rec)
	})
	unsubMetrics := s.Metrics.OnSample(func(sample metrics.Sample) {
		ev.emit.Emit(ChannelAppMetrics, sample)
	})

	return func() {
		unsubState()
		unsubInvalidated()
		unsubList()
		unsubOplog()
		unsubMetrics()
	}
}

// Signal emits a payload-free channel (D6: nil, not {}) to the focused window only — Electron's
// own sendToFocusedWindow(channel) (18fe7bb^:src/main/menu.ts:5-8; preload's onSignal discards
// arguments, src/preload/index.ts:35-39). The menu's twelve signal channels are its only caller
// (P8 C9): a background window no longer reacts to a command aimed at whichever window the user
// was actually looking at — Cmd+W closing a tab in every open window, or Cmd+Return running a
// console statement in a window the user never touched, were the concrete symptoms (F2).
//
// This is the split C9 exists for: Broadcast below (the quit handshake's own trigger) and the six
// state-change broadcasts in Attach/SettingsChanged/LayoutService.Set all stay on Emit — every
// window genuinely needs those, unlike a menu command.
func (ev *Events) Signal(channel string) {
	ev.emit.EmitFocused(channel, nil)
}

// SignalTo is Signal's single-window analogue, aimed by key rather than by focus (P8 C6/D6's
// EmitTo): the per-window close-flush handshake's own trigger.
func (ev *Events) SignalTo(windowKey, channel string) {
	ev.emit.EmitTo(windowKey, channel, nil)
}

// Broadcast emits a payload-free channel to every window — the quit handshake's own trigger
// (ChannelFlushBeforeClose): every window genuinely must flush before quitting, not only the
// focused one, so this deliberately does not go through Signal's focused-only delivery.
func (ev *Events) Broadcast(channel string) {
	ev.emit.Emit(channel, nil)
}

// SettingsChanged broadcasts the merged settings unconditionally — SettingsService.Set's own
// job, factored out here so its own file stays a thin wrapper.
func (ev *Events) SettingsChanged(s model.Settings) {
	ev.emit.Emit(ChannelSettingsChanged, s)
}
