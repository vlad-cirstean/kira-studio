package gitreview

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// IdleTTL is SPEC's own number: a review session nobody has touched in this long is reclaimed
// (D11) — returning after the window starts clean, by design, not an error case.
const IdleTTL = 14 * 24 * time.Hour

// sweepPeriod is the reaper's own tick: one sweep at open (ensureOpen), then hourly.
const sweepPeriod = time.Hour

// sweepDB deletes every session whose last_used_at is older than now-IdleTTL (the file/range rows
// go with it through the FK cascade, D4) and, when anything was actually removed, runs an
// incremental vacuum to make the reclaim real (D11: "_auto_vacuum=INCREMENTAL is what makes the
// reclaim real"). A free function (not a Store method) so ensureOpen can call it directly against
// the connection it just opened, without re-entering the store's own locking.
func sweepDB(db *sql.DB, now time.Time) (removed int, err error) {
	cutoff := now.Add(-IdleTTL).UnixMilli()
	res, err := db.Exec(`DELETE FROM review_session WHERE last_used_at < ?`, cutoff)
	if err != nil {
		return 0, fmt.Errorf("gitreview: sweep: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("gitreview: sweep rows affected: %w", err)
	}
	if n > 0 {
		if _, err := db.Exec(`PRAGMA incremental_vacuum`); err != nil {
			return int(n), fmt.Errorf("gitreview: incremental_vacuum: %w", err)
		}
	}
	return int(n), nil
}

// sweep is sweepDB over the store's own (lazily opened) connection — the reaper ticker's own
// entry point, and store_test.go's.
func (s *Store) sweep(now time.Time) (int, error) {
	db, err := s.conn()
	if err != nil {
		return 0, err
	}
	return sweepDB(db, now)
}

// Purge is G16's own seam (D20): removes every row for (repoID, branch) immediately, regardless of
// idle time — the eager purge on PR closed/merged, once G16 exists to call it. The sweep calls this
// same statement in bulk; G16 calls it per (repoID, branch) from its own PR-closed handler.
func (s *Store) Purge(ctx context.Context, repoID, branch string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	res, err := db.ExecContext(ctx, `DELETE FROM review_session WHERE repo_id = ? AND branch = ?`, repoID, branch)
	if err != nil {
		return fmt.Errorf("gitreview: purge: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("gitreview: purge rows affected: %w", err)
	}
	if n > 0 {
		if _, err := db.ExecContext(ctx, `PRAGMA incremental_vacuum`); err != nil {
			return fmt.Errorf("gitreview: incremental_vacuum: %w", err)
		}
	}
	return nil
}

// startReaperLocked launches the hourly sweep ticker — one goroutine per store, stopped and joined
// by Close. Not AfterFunc-per-session (D11): there is no per-session object to hang a timer on, and
// a single ticker over one DELETE is cheaper than N timers regardless. Caller holds openMu (called
// only from ensureOpen).
func (s *Store) startReaperLocked() {
	stop := make(chan struct{})
	done := make(chan struct{})
	s.reapStop = stop
	s.reapDone = done
	go func() {
		defer close(done)
		ticker := time.NewTicker(sweepPeriod)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				// Best-effort: a failed periodic sweep is not surfaced anywhere (there is no
				// request in flight to return it to) — the next tick tries again.
				_, _ = s.sweep(time.Now())
			}
		}
	}()
}
