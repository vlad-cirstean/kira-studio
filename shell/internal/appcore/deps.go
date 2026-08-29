// Package appcore is the Go analogue of src/main/ipc/deps.ts — the one Deps struct embedded by
// value into each bound service, and the startup-ordering entry point (src/main/index.ts).
package appcore

import (
	"database/sql"

	"github.com/kirathecat/kira-studio/shell/internal/connections"
	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
	"github.com/kirathecat/kira-studio/shell/internal/tree"
)

// Deps is embedded by value into every bound service struct, matching src/main/ipc/deps.ts's
// IpcDeps shape as closely as each phase's scope allows. P52's deps.ts row also lists Secrets,
// Log and Events; none is added here (P55 §7): the cipher reaches the bridge through
// Connections.SecretsStatus() exactly as ipc/connections.ts:44 does today, logging is
// slog.Default() (P53's seam, backed by internal/logging since P55 M0), and Events is P56's
// bridge/events.go. internal/oplog and the metrics ticker have no bridge service yet (P55 §6.1,
// §7) so they are wired directly in main.go, not carried here.
type Deps struct {
	DB          *sql.DB
	EngineHost  *enginehost.Host
	NodeVersion string
	StartedAt   int64 // unix millis, for engineStatus/appInfo-style diagnostics later

	Repos       *repos.Repos
	Connections *connections.Service
	Tree        *tree.Service
}
