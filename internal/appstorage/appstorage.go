// Package appstorage is the storage-layer mechanics both apps' own internal/storage packages hand-
// rolled identically (P107 T2-10): opening the sqlite file and running its migrations, the
// `windows`/`ui_layout` table helpers, and the tab-state envelope check. Each app's own migration
// set, its own extra tables (Studio's connections/collections/grpc/secrets and Space's
// gitclients/coderepos) and its own `//go:embed` (kept per package — P103 §2.3: a bound service
// type's own package must own its own embed) stay put; only the shared shape moves here.
package appstorage

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// OpenAt opens the sqlite file at path (sqlitex.Open's own six-pragma/SetMaxOpenConns(1)/chmod
// 0600 dance) and runs steps against it (sqlitex.Migrate) — each app's own storage.OpenAt resolves
// its own home dir and migrations.All() first, then calls this with the result. Folds what used to
// be each app's own storage/migrate.go.
//
// A migration error is returned as-is, never wrapped: internal/startupfail's Classify recognises
// *sqlitex.SchemaTooNewError via a direct type assertion (err.(schemaTooNew)), not errors.As.
func OpenAt(path string, steps []sqlitex.Migration) (*sql.DB, error) {
	db, err := sqlitex.Open(path)
	if err != nil {
		return nil, fmt.Errorf("appstorage: %w", err)
	}
	if err := sqlitex.Migrate(db, steps); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// CloseStmts closes every prepared statement a Repos aggregate holds, stopping at (and returning)
// the first error — both apps' own repos.Repos.Close did this same loop identically.
func CloseStmts(stmts []*sql.Stmt) error {
	for _, stmt := range stmts {
		if err := stmt.Close(); err != nil {
			return fmt.Errorf("appstorage: close statement: %w", err)
		}
	}
	return nil
}
