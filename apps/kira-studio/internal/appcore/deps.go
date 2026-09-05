// Package appcore is the Go analogue of src/main/ipc/deps.ts — the one Deps struct embedded by
// value into each bound service, and the startup-ordering entry point (src/main/index.ts).
package appcore

import (
	"database/sql"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/apivars"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/connections"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/tree"
)

// Emitter is the Go→renderer push seam (P56 D1/D4). internal/shell implements it over
// *application.App's Event.Emit/DispatchWailsEvent; bridge/events.go is its one real consumer
// package, so no bridge file has to import Wails. Deps carries the bare interface, not a
// *bridge.Events, since bridge already imports appcore — a *bridge.Events field here would be an
// import cycle. EmitTo (P8 C6) delivers to exactly one window by key — the mechanism the
// per-window close-flush handshake builds on. EmitFocused (P8 C9/D6) delivers to whichever window
// is currently key/focused, the successor to Electron's own sendToFocusedWindow — the menu's
// twelve signal channels use it so a background window no longer reacts to a command the user
// aimed at the window they were actually looking at.
type Emitter interface {
	Emit(name string, data any)
	EmitTo(windowKey string, name string, data any)
	EmitFocused(name string, data any)
}

// Deps is embedded by value into every bound service struct, matching src/main/ipc/deps.ts's
// IpcDeps shape as closely as each phase's scope allows. P52's deps.ts row also lists Secrets and
// Log; neither is added here: the cipher reaches the bridge through Connections.SecretsStatus()
// exactly as ipc/connections.ts:44 does today, and logging is slog.Default() (P53's seam, backed
// by internal/logging since P55 M0). internal/oplog and the metrics ticker have no bridge service
// yet (P55 §6.1, §7) so they are wired directly in main.go, not carried here.
type Deps struct {
	DB        *sql.DB
	StartedAt int64 // unix millis, for engineStatus/appInfo-style diagnostics later

	Repos       *repos.Repos
	Connections *connections.Service
	Tree        *tree.Service
	Router      *adapterhost.Router // PushCacheConfig's Go-side half (bridge/settings.go); A17
	Events      Emitter
	// ApiVars (P12 D3: renamed from HttpVars — it resolves gRPC targets too) is P5 D19 — the
	// gated variable/history reveal and stage 2 of the two-stage {{name}} substitution
	// (bridge/http.go's Send calls ResolveRequest directly; every other VariablesService method
	// wraps Repos.Variables instead, the same split CollectionsService already has between
	// Repos.Collections and nothing else).
	ApiVars *apivars.Service
}
