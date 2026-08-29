// Package storage owns the Go build's SQLite database: opening it, migrating it, and the
// hot-path repo queries. Go analogue of src/main/storage/{db,migrate}.ts.
package storage

import (
	"database/sql"
	"fmt"
	"os"

	"github.com/kirathecat/kira-studio/shell/internal/config"
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
