package bridge

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/dbmcp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appevent"
	"github.com/kirathecat/kira-studio/internal/metrics"
)

// Channel holds today's exact IPC channel strings (packages/shared/protocol/ipc.ts's IPC const), which
// are the Wails event names verbatim (P52 §7.1) — the renderer's subscribe mechanism changes, the
// wire name does not. The ones re-exported below (P103 Part 3, widened P116) are byte-identical
// strings shared with Kira Space, now defined once in repo-root internal/appevent — re-exported
// under their own names here so no call site anywhere in this package has to change.
const (
	ChannelOpenSettings           = appevent.ChannelOpenSettings
	ChannelNewConnection          = "kira:menu:new-connection"
	ChannelNewRequest             = "kira:menu:new-request"
	ChannelImportPostman          = "kira:menu:import-postman"
	ChannelImportDataGrip         = "kira:menu:import-datagrip"
	ChannelToggleProjectPanel     = appevent.ChannelToggleProjectPanel
	ChannelToggleOperationsPanel  = "kira:menu:toggle-operations-panel"
	ChannelCommandPalette         = "kira:menu:command-palette"
	ChannelTabNext                = appevent.ChannelTabNext
	ChannelTabPrev                = appevent.ChannelTabPrev
	ChannelTabClose               = appevent.ChannelTabClose
	ChannelViewFind               = "kira:menu:view-find"
	ChannelViewRefresh            = "kira:menu:view-refresh"
	ChannelViewRun                = "kira:menu:view-run"
	ChannelViewRunAll             = "kira:menu:view-run-all"
	ChannelViewFormat             = "kira:menu:view-format"
	ChannelFlushBeforeClose       = appevent.ChannelFlushBeforeClose
	ChannelWindowFlushBeforeClose = appevent.ChannelWindowFlushBeforeClose
	ChannelConnectionState        = "kira:connection:state"
	ChannelMetadataInvalidated    = "kira:connection:metadataInvalidated"
	ChannelConnectionsChanged     = "kira:connections:changed"
	ChannelSettingsChanged        = appevent.ChannelSettingsChanged
	ChannelLayoutChanged          = appevent.ChannelLayoutChanged
	ChannelOpUpdate               = "kira:op:update"
	ChannelAppMetrics             = appevent.ChannelAppMetrics
	ChannelSchemaChanged          = "kira:schema:changed"
	// ChannelGrpcCall is P11 D8's own new push channel — a server-streaming call's coalesced
	// message batches, delivered with EmitTo (one window only, GrpcService.Call's own emitter
	// call) rather than through this file's Events/Sources machinery: it has exactly one producer
	// (the RunOp closure calling grpcclient.ServerStream), not a startup-wired long-lived source,
	// so it needs no Sources entry and no Attach subscription.
	ChannelGrpcCall = "kira:grpc:call"
	// ChannelDbMcpApproval is M2 §7.1's own push channel — the prompt-mode approval queue's live
	// snapshot: one FIFO of pending approvals, one presented at a time, each with its own timeout.
	ChannelDbMcpApproval = "kira:dbmcp:approval"
	// ChannelTerminal is P83's own push channel — one terminal's output and its exit, EmitTo'd to
	// the one window that opened it, flushed on the same 60ms/256-batch/terminal-event shape as
	// ChannelGrpcCall above (internal/bridge/terminal.go's own coalescer).
	ChannelTerminal = appevent.ChannelTerminal
	// ChannelCustomScriptsChanged is P85's own list-changed broadcast — CustomScriptsService's own
	// Create/Update/Remove Emit (not EmitTo) the full list, ChannelConnectionsChanged's own shape,
	// so every window's tab-strip dropdown stays in sync with a script added or removed elsewhere.
	ChannelCustomScriptsChanged = "kira:customScripts:changed"
	// ChannelMaskRulesChanged is P108 Part 12 F18's own push channel — MaskRulesService's own
	// Upsert/Remove/RegenerateKey Emit (not EmitTo) one connection's own rule set, ChannelSchemaChanged's
	// own per-connection shape rather than ChannelCustomScriptsChanged's flat app-wide list, so a
	// second window's Privacy tab / grid header menu / grid preview stay in sync with a rule changed
	// elsewhere.
	ChannelMaskRulesChanged = "kira:maskRules:changed"
	// ChannelAgentSessions is P86 §11's own app-wide broadcast — every live Claude Code session
	// across every window, Emit'd (not EmitTo) whenever terminal.Registry.OnChange fires, so the
	// status-bar widget in every window agrees on the same count.
	ChannelAgentSessions = "kira:agent:sessions"
	// ChannelAgentEvent is P86 §8.4's own per-hook broadcast — one Claude Code hook firing for one
	// tab, Emit'd (not EmitTo, unlike ChannelTerminal) since AgentHooksService.onEvent has no
	// window to address: a hook event is filtered by the receiving window against terminals it
	// owns instead (state/agentSessions.ts's own reducer, keyed by terminalId).
	ChannelAgentEvent = "kira:agent:event"
	// ChannelKeepAwake is P87 §3.2's own app-wide broadcast — the titlebar toggle's state, Emit'd
	// (not EmitTo) exactly like ChannelAgentSessions: one machine, one assertion, so every window's
	// titlebar button must agree. Process-scoped, never persisted: an OS power assertion that
	// outlives the reason a user made it is a surprise, and the persistent half of this feature is
	// the Settings toggle. P116: byte-identical to Kira Space's own channel of the same name,
	// hoisted to repo-root internal/appevent.
	ChannelKeepAwake = appevent.ChannelKeepAwake
	// ChannelApiDataChanged is P112's own broadcast — every API-client mutation (collections,
	// saved requests, variables, environments) Emits it with the scopes that mutation touched, so
	// every window's TanStack Query cache invalidates exactly those keys (apidata.go).
	ChannelApiDataChanged = "kira:api:dataChanged"
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
	DbMcp interface {
		OnApprovalChange(func(dbmcp.ApprovalSnapshot)) func()
	}
}

// Events is the Go analogue of the five push-side listeners src/main/index.ts wires (:58, :99-
// 102) plus the menu/quit signal channels. It is the only thing in this package that emits.
// Signal/SignalTo/Broadcast come from the embedded *appevent.Events core (P103 Part 3); emit is
// kept alongside it for Attach's five producer subscriptions and SettingsChanged below, neither of
// which the shared core exposes a raw Emit for.
type Events struct {
	*appevent.Events
	emit appcore.Emitter
}

func NewEvents(e appcore.Emitter) *Events {
	return &Events{Events: appevent.NewEvents(e), emit: e}
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
	unsubDbMcpApproval := s.DbMcp.OnApprovalChange(func(snap dbmcp.ApprovalSnapshot) {
		ev.emit.Emit(ChannelDbMcpApproval, toWireApprovalSnapshot(snap))
	})

	return func() {
		unsubState()
		unsubInvalidated()
		unsubList()
		unsubOplog()
		unsubMetrics()
		unsubDbMcpApproval()
	}
}

// Signal/SignalTo/Broadcast (D6: nil payloads, not {}) come from the embedded *appevent.Events
// core — Electron's own sendToFocusedWindow(channel) (18fe7bb^:src/main/menu.ts:5-8; preload's
// onSignal discards arguments, src/preload/index.ts:35-39). The menu's twelve signal channels are
// Signal's only caller (P8 C9): a background window no longer reacts to a command aimed at
// whichever window the user was actually looking at — Cmd+W closing a tab in every open window, or
// Cmd+Return running a console statement in a window the user never touched, were the concrete
// symptoms (F2). This is the split C9 exists for: Broadcast (the quit handshake's own trigger) and
// the six state-change broadcasts in Attach/SettingsChanged/LayoutService.Set all stay on Emit —
// every window genuinely needs those, unlike a menu command.

// SettingsChanged broadcasts the merged settings unconditionally — SettingsService.Set's own
// job, factored out here so its own file stays a thin wrapper.
func (ev *Events) SettingsChanged(s model.Settings) {
	ev.emit.Emit(ChannelSettingsChanged, s)
}
