package gitreview

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitreview/migrations"
)

// migrate is internal/storage/migrate.go's forward-only schema_version runner, copied rather than
// shared (D4): the alternative — exporting a generic storage.RunMigrations and importing
// internal/storage from gitreview — would make a studio-module package a compile-time dependency
// of a git-module package in exchange for a `for` loop, which SPEC's own module-boundary rule
// forecloses. Same refusal on a version newer than this binary knows, same one-transaction-per-step
// shape.
func migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("gitreview: create schema_version: %w", err)
	}

	var current int
	row := db.QueryRow(`SELECT version FROM schema_version LIMIT 1`)
	switch err := row.Scan(&current); err {
	case sql.ErrNoRows:
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (0)`); err != nil {
			return fmt.Errorf("gitreview: seed schema_version: %w", err)
		}
		current = 0
	case nil:
		// current already populated by Scan.
	default:
		return fmt.Errorf("gitreview: read schema_version: %w", err)
	}

	steps, err := migrations.All()
	if err != nil {
		return fmt.Errorf("gitreview: load migrations: %w", err)
	}

	var maxVersion int
	for _, m := range steps {
		if m.Version > maxVersion {
			maxVersion = m.Version
		}
	}
	if current > maxVersion {
		return fmt.Errorf(
			"gitreview: review.db schema_version (%d) is newer than this build knows about (%d) — "+
				"refusing to run against a downgraded app", current, maxVersion,
		)
	}

	for _, m := range steps {
		if m.Version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("gitreview: begin migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(m.SQL); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("gitreview: apply migration %s: %w", m.Name, err)
		}
		if _, err := tx.Exec(`UPDATE schema_version SET version = ?`, m.Version); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("gitreview: record migration %s: %w", m.Name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("gitreview: commit migration %s: %w", m.Name, err)
		}
	}
	return nil
}
