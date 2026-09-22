// Package storage owns the Go build's SQLite database: opening it, migrating it, and the
// hot-path repo queries. Go analogue of src/main/storage/{db,migrate}.ts.
package storage

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
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

// Open creates KIRA_HOME if needed, opens (or creates) the database file at the trimmed
// permissions the Electron build uses, applies the four startup pragmas, and runs every pending
// migration.
func Open() (*DB, error) {
	return OpenAt(config.KiraHome())
}

// OpenAt is Open against an explicit home dir instead of $KIRA_HOME. Exists so a test can pass its
// own t.TempDir() directly rather than t.Setenv("KIRA_HOME", …) — Go's testing package panics if
// t.Setenv runs in a test that called t.Parallel() (or whose parent did), so a test wanting both
// isolation and parallelism needs the dir threaded explicitly (v1.4 P1).
func OpenAt(home string) (*DB, error) {
	if err := config.EnsureLayoutAt(home); err != nil {
		return nil, fmt.Errorf("storage: ensure layout: %w", err)
	}

	path := config.DbPathAt(home)
	// sqlitex.Open runs the four steps db.go used to run inline (open with the six DSN pragmas,
	// SetMaxOpenConns(1), Ping to force the lazy first connection — which is what actually creates
	// the file and applies the DSN pragmas — then chmod 0600 unconditionally, not only on create)
	// against repo-root internal/sqlitex, shared with apps/kira-space's own storage package
	// (P100 Part 1).
	sqlDB, err := sqlitex.Open(path)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}

	db := &DB{sqlDB}
	if err := db.migrate(); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}
	return db, nil
}
