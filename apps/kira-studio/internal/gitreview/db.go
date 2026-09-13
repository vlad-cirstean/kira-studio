package gitreview

import (
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	_ "modernc.org/sqlite"
)

// DefaultPath is review.db's own location under KIRA_HOME — a second SQLite file, never a table
// in kira.db (D2's own rejected alternative: SPEC's stated reason is that its lifecycle — bulk
// blob content, aggressive TTL/PR-close purges — is nothing like the rest of the app's data).
func DefaultPath() string {
	return filepath.Join(config.KiraHome(), "review.db")
}

// buildDSN mirrors internal/storage/db.go's buildDSN verbatim (D4): same six pragmas, same
// single-writer posture. Deliberately duplicated rather than exported and reused — see
// migrate.go's own doc comment on why this package does not import internal/storage.
func buildDSN(path string) string {
	q := url.Values{}
	q.Set("_busy_timeout", "5000")
	q.Set("_foreign_keys", "1") // review_range -> review_file -> review_session CASCADE (D4)
	q.Set("_auto_vacuum", "INCREMENTAL") // SPEC's "purges that want to reclaim space aggressively"
	q.Set("_pragma", "journal_size_limit(4194304)")
	q.Set("_journal_mode", "WAL")
	q.Set("_synchronous", "NORMAL")
	return "file:" + path + "?" + q.Encode()
}

// ensureOpen is the lazy-open guard (D3): a Store that never serves a review request never opens
// review.db, never migrates it, and never starts the reaper. A failure here is returned to the
// caller and NOT memoised — the next request retries, since the common failure (a full or
// read-only home directory) is transient in a way a broken git binary is not.
func (s *Store) ensureOpen() error {
	s.openMu.Lock()
	defer s.openMu.Unlock()
	if s.sqlDB != nil {
		return nil
	}

	if err := config.EnsureLayout(); err != nil {
		return fmt.Errorf("gitreview: ensure layout: %w", err)
	}

	sqlDB, err := sql.Open("sqlite", buildDSN(s.path))
	if err != nil {
		return fmt.Errorf("gitreview: open %s: %w", s.path, err)
	}
	sqlDB.SetMaxOpenConns(1)

	// database/sql's Open is lazy — the file does not exist until the first real connection, so
	// Ping (which forces one, applying the DSN pragmas above) must run before the chmod below, not
	// after (storage/db.go's own recorded ordering trap).
	if err := sqlDB.Ping(); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("gitreview: open %s: %w", s.path, err)
	}
	if err := os.Chmod(s.path, 0o600); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("gitreview: chmod %s: %w", s.path, err)
	}

	if err := migrate(sqlDB); err != nil {
		_ = sqlDB.Close()
		return err
	}

	// The startup sweep runs against the local sqlDB, not through Store.sweep (which resolves its
	// own connection via conn()) — ensureOpen already holds openMu, and sync.Mutex is not
	// reentrant, so calling back through conn()/ensureOpen here would deadlock.
	if _, err := sweepDB(sqlDB, time.Now()); err != nil {
		_ = sqlDB.Close()
		return fmt.Errorf("gitreview: startup sweep: %w", err)
	}

	s.sqlDB = sqlDB
	s.startReaperLocked()
	return nil
}

// conn resolves the store's connection, opening it lazily on first use, and returns a stable
// snapshot of the pointer taken under openMu — never a bare read of s.sqlDB after ensureOpen has
// already released the lock, which would race Close()'s own write to that field under -race. A
// query run against the returned *sql.DB after a concurrent Close() simply errors (database/sql's
// own documented behaviour), which is a correctness non-issue at process shutdown, not a data race.
func (s *Store) conn() (*sql.DB, error) {
	if err := s.ensureOpen(); err != nil {
		return nil, err
	}
	s.openMu.Lock()
	db := s.sqlDB
	s.openMu.Unlock()
	return db, nil
}
