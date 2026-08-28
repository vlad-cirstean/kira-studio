// Package storage owns the Go build's SQLite database: opening it, migrating it, and the
// hot-path repo queries. Go analogue of src/main/storage/{db,migrate}.ts.
package storage

import (
	"database/sql"
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/shell/internal/config"
	"github.com/kirathecat/kira-studio/shell/internal/storage/migrations"
	_ "github.com/mattn/go-sqlite3"
)

// DB wraps the single *sql.DB connection this app ever opens.
//
// mattn/go-sqlite3 links the real, unmodified upstream SQLite amalgamation — the same engine
// node:sqlite embeds — so the migrations and every query behave identically to the Electron
// build with nothing to re-validate (P52 §2.2). SetMaxOpenConns(1): this app's database is a
// small, single-writer configuration store, and serialising every statement onto one connection
// removes the SQLITE_BUSY class of bug entirely at no measurable cost (P52 §5.2).
type DB struct {
	*sql.DB
}

// Open creates KIRA_HOME if needed, opens (or creates) the database file at the trimmed
// permissions the Electron build uses, applies the four startup pragmas, and runs every pending
// migration.
func Open() (*DB, error) {
	if err := config.EnsureLayout(); err != nil {
		return nil, fmt.Errorf("storage: ensure layout: %w", err)
	}

	path := config.DbPath()
	sqlDB, err := sql.Open("sqlite3", path)
	if err != nil {
		return nil, fmt.Errorf("storage: open %s: %w", path, err)
	}
	sqlDB.SetMaxOpenConns(1)

	// database/sql's Open is lazy — the file does not exist on disk until the first real query,
	// so the pragmas (which force that first connection) must run before the chmod below, not
	// after.
	pragmas := []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA foreign_keys = ON",
		"PRAGMA busy_timeout = 5000",
	}
	for _, p := range pragmas {
		if _, err := sqlDB.Exec(p); err != nil {
			_ = sqlDB.Close()
			return nil, fmt.Errorf("storage: %s: %w", p, err)
		}
	}

	// Unconditional, not only on create: tightens permissions on an existing loose file too,
	// mirroring db.ts's own comment.
	if err := os.Chmod(path, 0o600); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("storage: chmod %s: %w", path, err)
	}

	db := &DB{sqlDB}
	if err := db.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return db, nil
}

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
		return fmt.Errorf(
			"storage: database schema_version (%d) is newer than this build knows about (%d) — "+
				"refusing to run against a downgraded app", current, maxVersion,
		)
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
