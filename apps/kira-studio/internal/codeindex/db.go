// Package codeindex is the SQLite-backed symbol/reference cache C1 builds over internal/
// codeparse's output (docs/v1.5/plans/C1-tree-sitter-sqlite-cache.md). Pure Go on every platform
// except its own darwin watcher backend (watch_fsevents_darwin.go, darwin && cgo — the same
// exception gitclient's own repo watcher makes, with the same working !darwin || !cgo companion);
// codeparse is the only package this phase adds that is unconditionally cgo.
package codeindex

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	_ "modernc.org/sqlite"
)

// maxOpenConns matches §8's worker-pool bound (min(4, runtime.NumCPU())) — sized so a
// repository's own read paths (a symbol-name lookup, C3's MCP server as a separate process, below)
// can proceed concurrently under WAL without waiting on the single background-sync writer
// goroutine every Sync uses (§8: writes are single-writer by construction regardless of how many
// connections the pool has open).
const maxOpenConns = 4

// DefaultPath is codeindex.db's own location under KIRA_HOME (§5.1) — one shared file for every
// repository this process indexes, `repo_id`-scoped on every table, never split per repository
// and never a table in kira.db. A second file at all follows review.db's own precedent
// (docs/ARCHITECTURE.md Storage) — a different lifecycle from settings/tab state — and kira.db's
// own SetMaxOpenConns(1) would serialise a reindex ahead of every debounced tab save; sharing one
// file across repositories, rather than one file per repository, needs no justification beyond
// that: nothing here needs a second file per repository once codeindex.db already has its own
// independent connection pool.
func DefaultPath() string {
	return filepath.Join(config.KiraHome(), "codeindex.db")
}

// buildDSN mirrors internal/storage/db.go's buildDSN verbatim (the same six pragmas gitreview/
// db.go also copies): same DSN shape, applied to this package's own file. WAL carries more weight
// here than anywhere else in the app: C3's MCP server is a separate process reading this same
// file while the studio app writes it, which is exactly what WAL plus a busy timeout is for.
func buildDSN(path string) string {
	q := url.Values{}
	q.Set("_busy_timeout", "5000")
	q.Set("_foreign_keys", "1")
	q.Set("_auto_vacuum", "INCREMENTAL")
	q.Set("_pragma", "journal_size_limit(4194304)")
	q.Set("_journal_mode", "WAL")
	q.Set("_synchronous", "NORMAL")
	return "file:" + path + "?" + q.Encode()
}

// Store is the shared codeindex.db handle — every repository's Index opens against the same
// Store, and therefore the same connection pool, rather than each owning a private file.
type Store struct {
	path string

	openMu sync.Mutex
	sqlDB  *sql.DB
}

// OpenStore returns a Store that will open (lazily) codeindex.db under $KIRA_HOME. Named OpenStore
// rather than Open — Index's own Open (index.go) is the constructor most callers reach for; this
// one exists to hand that constructor a shared Store, typically once per process.
func OpenStore() *Store { return OpenStoreAt(config.KiraHome()) }

// OpenStoreAt is OpenStore against an explicit home dir instead of $KIRA_HOME — a test's own
// t.TempDir() rather than KIRA_HOME (mirrors internal/storage.OpenAt's own reason: Go's testing
// package panics if t.Setenv runs in a test that called t.Parallel(), so isolation plus
// parallelism needs the dir threaded explicitly).
func OpenStoreAt(home string) *Store {
	return &Store{path: filepath.Join(home, "codeindex.db")}
}

// Path returns the file this Store opens (or would open) — codeindex.db under whichever home
// directory it was constructed with.
func (s *Store) Path() string { return s.path }

// ensureOpen is the lazy-open guard: a Store no repository ever queries never opens codeindex.db,
// never migrates it, and never starts the reaper. A failure here is returned to the caller and not
// memoised — the next request retries, since the common failure (a full or read-only home
// directory) is transient in a way a broken schema is not.
func (s *Store) ensureOpen() (*sql.DB, error) {
	s.openMu.Lock()
	defer s.openMu.Unlock()
	if s.sqlDB != nil {
		return s.sqlDB, nil
	}

	if err := config.EnsureLayoutAt(filepath.Dir(s.path)); err != nil {
		return nil, fmt.Errorf("codeindex: ensure layout: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", buildDSN(s.path))
	if err != nil {
		return nil, fmt.Errorf("codeindex: open %s: %w", s.path, err)
	}
	sqlDB.SetMaxOpenConns(maxOpenConns)

	// database/sql's Open is lazy — the file does not exist until the first real connection, so
	// Ping (which forces one, applying the DSN pragmas above) must run before the chmod below.
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("codeindex: open %s: %w", s.path, err)
	}
	if err := os.Chmod(s.path, 0o600); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("codeindex: chmod %s: %w", s.path, err)
	}

	if err := migrate(sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, err
	}

	if err := sweepIdleRepos(sqlDB); err != nil {
		_ = sqlDB.Close()
		return nil, fmt.Errorf("codeindex: startup sweep: %w", err)
	}

	s.sqlDB = sqlDB
	return s.sqlDB, nil
}

// conn resolves the store's connection, opening it lazily on first use.
func (s *Store) conn() (*sql.DB, error) { return s.ensureOpen() }

// Close closes the underlying connection pool, if it was ever opened. Idempotent.
func (s *Store) Close() error {
	s.openMu.Lock()
	defer s.openMu.Unlock()
	if s.sqlDB == nil {
		return nil
	}
	err := s.sqlDB.Close()
	s.sqlDB = nil
	return err
}
