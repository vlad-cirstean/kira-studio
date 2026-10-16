package gitreview

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview/migrations"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// migrate runs review.db's schema_version steps through sqlitex.Migrate — internal/storage's own
// forward-only runner, generalized (P107 I2-32; T1-8 named this residue, this finishes it). Then
// runs the idempotent Go sweep below, unconditionally, every lazy-open. sqlitex.Migrate's error is
// returned unwrapped, like storage.OpenAt's own: a *sqlitex.SchemaTooNewError must reach the
// caller as-is for internal/startupfail's Classify to recognise it (a direct type assertion, not
// errors.As).
func migrate(db *sql.DB) error {
	steps, err := migrations.All()
	if err != nil {
		return fmt.Errorf("gitreview: load migrations: %w", err)
	}
	if err := sqlitex.Migrate(db, steps); err != nil {
		return err
	}

	// G27 D8: an idempotent Go sweep, not a SQL migration step — it needs no schema_version of its
	// own precisely because it is idempotent (normalize.go's own doc comment), so it runs
	// unconditionally here, every lazy-open, after the SQL loop above has brought the schema itself
	// up to date.
	if err := normalizeStoredPaths(db); err != nil {
		return fmt.Errorf("gitreview: normalize stored paths: %w", err)
	}
	return nil
}
