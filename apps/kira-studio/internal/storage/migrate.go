package storage

import (
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// migrate runs the forward-only schema_version runner via repo-root internal/sqlitex's shared
// mechanics (P100 Part 1) — same refusal (sqlitex.SchemaTooNewError, recognised by
// internal/startupfail's Classify via the same schemaTooNew duck-typed interface this package's
// own SchemaTooNewError used to satisfy directly) on a version newer than the binary knows, same
// one-transaction-per-step shape as migrate.ts.
func (db *DB) migrate() error {
	steps, err := migrations.All()
	if err != nil {
		return fmt.Errorf("storage: load migrations: %w", err)
	}
	sqlitexSteps := make([]sqlitex.Migration, len(steps))
	for i, m := range steps {
		sqlitexSteps[i] = sqlitex.Migration{Version: m.Version, Name: m.Name, SQL: m.SQL}
	}
	// Not wrapped: a *sqlitex.SchemaTooNewError must reach the caller as-is, since
	// internal/startupfail's Classify recognises it via a direct type assertion (err.(schemaTooNew)),
	// not errors.As — the same reason storage's own former SchemaTooNewError was never wrapped
	// either. sqlitex.Migrate's own errors already carry a "sqlitex:" prefix identifying their
	// source.
	return sqlitex.Migrate(db.DB, sqlitexSteps)
}
