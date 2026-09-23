package gitreview

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// DefaultPath is review.db's own location under KIRA_SPACE_HOME (P100 Part 1: this app's own
// home, not Kira Studio's) — a second SQLite file, never a table in kira.db (D2's own rejected
// alternative: SPEC's stated reason is that its lifecycle — bulk blob content, aggressive
// TTL/PR-close purges — is nothing like the rest of the app's data).
func DefaultPath() string {
	return filepath.Join(config.KiraSpaceHome(), "review.db")
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

	// sqlitex.Open applies the same six startup pragmas storage/db.go's own buildDSN does (D4:
	// same single-writer posture), pings to force the file into existence, and tightens it to
	// 0600 — the open/ping/chmod sequence this package used to hand-roll.
	sqlDB, err := sqlitex.Open(s.path)
	if err != nil {
		return fmt.Errorf("gitreview: %w", err)
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
