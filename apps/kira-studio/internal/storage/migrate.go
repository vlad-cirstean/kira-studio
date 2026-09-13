package storage

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/migrations"
)

// SchemaTooNewError is migrate's refusal when the database on disk was written by a build that
// understands a newer schema than this binary does (G29 D1) — continuing would risk this older
// binary writing to a database shape it does not fully understand. Found is the schema_version
// row's value; Known is the highest version this binary's own migrations.All() carries.
type SchemaTooNewError struct{ Found, Known int }

// Error's text is unchanged from the fmt.Errorf this type replaces — nothing that logs or
// displays it changes as a result of this type existing.
func (e *SchemaTooNewError) Error() string {
	return fmt.Sprintf(
		"storage: database schema_version (%d) is newer than this build knows about (%d) — "+
			"refusing to run against a downgraded app", e.Found, e.Known,
	)
}

// SchemaTooNew lets a caller recognise this specific refusal structurally — via a small duck-typed
// interface it defines locally — without importing internal/storage at all (G29 D1/D9's rationale:
// apps/kira-studio/internal/startupfail stays a leaf with no modernc.org/sqlite in its dependency
// graph). internal/gitreview's byte-identical refusal (gitreview/migrate.go) could satisfy the same
// interface for free if a future phase ever needs it to.
func (e *SchemaTooNewError) SchemaTooNew() (found, known int) { return e.Found, e.Known }

// migrate runs the forward-only schema_version runner: same refusal on a version newer than the
// binary knows, same one-transaction-per-step shape as migrate.ts.
func (db *DB) migrate() error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("storage: create schema_version: %w", err)
	}

	var current int
	row := db.QueryRow(`SELECT version FROM schema_version LIMIT 1`)
	switch err := row.Scan(&current); err {
	case sql.ErrNoRows:
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return fmt.Errorf("storage: seed schema_version: %w", err)
		}
		current = 0
	case nil:
		// current already populated by Scan.
	default:
		return fmt.Errorf("storage: read schema_version: %w", err)
	}

	steps, err := migrations.All()
	if err != nil {
		return fmt.Errorf("storage: load migrations: %w", err)
	}

	var maxVersion int
	for _, m := range steps {
		if m.Version > maxVersion {
			maxVersion = m.Version
		}
	}
	if current > maxVersion {
		return &SchemaTooNewError{Found: current, Known: maxVersion}
	}

	for _, m := range steps {
		if m.Version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("storage: begin migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(m.SQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("storage: apply migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(`UPDATE schema_version SET version = ?`, m.Version); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("storage: record migration %s: %w", m.Name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("storage: commit migration %s: %w", m.Name, err)
		}
	}
	return nil
}
