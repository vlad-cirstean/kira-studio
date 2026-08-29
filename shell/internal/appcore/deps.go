// Package appcore is the Go analogue of src/main/ipc/deps.ts — the one Deps struct embedded by
// value into each bound service, and the startup-ordering entry point (src/main/index.ts).
package appcore

import (
	"database/sql"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// Deps is embedded by value into every bound service struct, matching src/main/ipc/deps.ts's
// IpcDeps shape as closely as each phase's scope allows. connections/secrets/tree services land
// in P55; this is P53's storage core plus P52's walking-skeleton scaffolding.
type Deps struct {
	DB          *sql.DB
	EngineHost  *enginehost.Host
	NodeVersion string
	StartedAt   int64 // unix millis, for engineStatus/appInfo-style diagnostics later

	Repos *repos.Repos
}
