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
	ChannelFlushBeforeClose       = "kira:app:flush-before-close"
	ChannelWindowFlushBeforeClose = "kira:window:flush-before-close"
	ChannelConnectionState        = "kira:connection:state"
	ChannelMetadataInvalidated    = "kira:connection:metadataInvalidated"
	ChannelConnectionsChanged     = "kira:connections:changed"
	ChannelSettingsChanged        = "kira:settings:changed"
	ChannelLayoutChanged          = "kira:layout:changed"
	ChannelOpUpdate               = "kira:op:update"
	ChannelAppMetrics             = "kira:app:metrics"
)

// ChannelEngineState is declared for completeness and deliberately never emitted: nothing in
// src/main sends it and nothing in apps/kira-studio/frontend/src subscribes to it (P56 D5). P57 deletes it.
const ChannelEngineState = "kira:engine:state"

// Sources are the five push producers P55 left as seams (P55 D15). Each is a one-method
// interface so events_test.go can drive them without building a real service.
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

// Signal emits a payload-free channel (D6: nil, not {}) — Electron's sendToFocusedWindow(channel)
// sends no payload and preload's onSignal discards arguments (src/preload/index.ts:35-39). The
// menu and the quit handshake are its only callers.
func (ev *Events) Signal(channel string) {
	ev.emit.Emit(channel, nil)
}

// SignalTo is Signal's single-window analogue (P8 C6/D6's EmitTo): the per-window close-flush
// handshake's own trigger, delivered to exactly one window rather than broadcast.
func (ev *Events) SignalTo(windowKey, channel string) {
	ev.emit.EmitTo(windowKey, channel, nil)
}

// SettingsChanged broadcasts the merged settings unconditionally — SettingsService.Set's own
// job, factored out here so its own file stays a thin wrapper.
func (ev *Events) SettingsChanged(s model.Settings) {
	ev.emit.Emit(ChannelSettingsChanged, s)
}
