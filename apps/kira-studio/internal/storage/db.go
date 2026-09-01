// Package storage owns the Go build's SQLite database: opening it, migrating it, and the
// hot-path repo queries. Go analogue of src/main/storage/{db,migrate}.ts.
package storage

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	_ "modernc.org/sqlite"
)

// DB wraps the single *sql.DB connection this app ever opens.
//
// modernc.org/sqlite is a pure-Go transpilation of the same upstream SQLite amalgamation
// mattn/go-sqlite3 links via cgo — same engine, no cgo toolchain needed to build this binary
// (the sqlite adapter package already made this switch for the external-file browsing path;
// this is the same driver, same DSN-based pragma convention, applied to the app's own database).
// SetMaxOpenConns(1): this app's database is a small, single-writer configuration store, and
// serialising every statement onto one connection removes the SQLITE_BUSY class of bug entirely
// at no measurable cost (P52 §5.2).
type DB struct {
	*sql.DB
}

// buildDSN sets the four startup pragmas through the DSN query string rather than as Exec
// statements after Open — unlike mattn/go-sqlite3's Go-side options, modernc.org/sqlite takes
// pragmas this way (see adapters/sqlite/client.go's buildDSN), and doing it here means every
// connection the pool ever opens carries them, not just the first.
func buildDSN(path string) string {
	q := url.Values{}
	q.Set("_busy_timeout", "5000")
	q.Set("_foreign_keys", "1")
	q.Set("_journal_mode", "WAL")
	q.Set("_synchronous", "NORMAL")
	return "file:" + path + "?" + q.Encode()
}

// Open creates KIRA_HOME if needed, opens (or creates) the database file at the trimmed
// permissions the Electron build uses, applies the four startup pragmas, and runs every pending
// migration.
func Open() (*DB, error) {
	if err := config.EnsureLayout(); err != nil {
		return nil, fmt.Errorf("storage: ensure layout: %w", err)
	}

	path := config.DbPath()
	sqlDB, err := sql.Open("sqlite", buildDSN(path))
	if err != nil {
		return nil, fmt.Errorf("storage: open %s: %w", path, err)
	}
	sqlDB.SetMaxOpenConns(1)

	// database/sql's Open is lazy — the file does not exist on disk until the first real
	// connection, so Ping (which forces one, applying the DSN pragmas above) must run before the
	// chmod below, not after.
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("storage: open %s: %w", path, err)
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
