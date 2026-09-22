package storage

import (
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// migrate runs the forward-only schema_version runner via repo-root internal/sqlitex's shared
// mechanics — same refusal (sqlitex.SchemaTooNewError, recognised by internal/startupfail's
// Classify via the schemaTooNew duck-typed interface) on a version newer than the binary knows,
// same one-transaction-per-step shape as Kira Studio's own storage/migrate.go.
func (db *DB) migrate() error {
	steps, err := migrations.All()
	if err != nil {
		return fmt.Errorf("storage: load migrations: %w", err)
	}
	sqlitexSteps := make([]sqlitex.Migration, len(steps))
	for i, m := range steps {
		sqlitexSteps[i] = sqlitex.Migration{Version: m.Version, Name: m.Name, SQL: m.SQL}
	}
	// Not wrapped: a *sqlitex.SchemaTooNewError must reach the caller as-is — see Kira Studio's own
	// storage/migrate.go for why.
	return sqlitex.Migrate(db.DB, sqlitexSteps)
}
