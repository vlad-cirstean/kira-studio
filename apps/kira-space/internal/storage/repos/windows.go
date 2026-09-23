package repos

import (
	"database/sql"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/appstorage"
)

// WindowsRepo reads and writes the `windows` table (P8 D1/D4) — one row per workbench that is
// either open right now or was the last time the app quit. Kira Studio's own WindowsRepo also
// carries GetMode/SetMode (P22 D12's per-window app-mode persistence); Kira Space has no such
// concept (see model.WindowRecord's own doc comment) so both, and the `mode` column they read/
// write, are dropped here (P100 Part 1).
type WindowsRepo struct {
	DB *sql.DB
}

// shared is this repo's own row against repo-root internal/appstorage.WindowRepo, which owns
// every method below directly (P107 T2-10, I2-3) — this app's own WindowRecord/WindowBounds are
// plain aliases of appstorage's own (unlike Kira Studio's own WindowRecord, which keeps an extra
// `mode` column this app's schema has no room for), so nothing here needs its own query or
// conversion any more.
func (r *WindowsRepo) shared() *appstorage.WindowRepo { return &appstorage.WindowRepo{DB: r.DB} }

// List returns every window record in `order`. Not a hot boot path (read once at startup, per
// window record), so this has no prepared statement.
func (r *WindowsRepo) List() ([]model.WindowRecord, error) {
	return r.shared().List()
}

// Exists reports whether key names a live `windows` row.
func (r *WindowsRepo) Exists(key string) (bool, error) {
	return r.shared().Exists(key)
}

// Create inserts a new window record. The caller mints the key (D2: a UUID the shell owns).
func (r *WindowsRepo) Create(rec model.WindowRecord) error {
	if err := rec.Validate(); err != nil {
		return fmt.Errorf("repos: %w", err)
	}
	return r.shared().Create(rec)
}

// EnsureExists creates a `windows` row for key if one doesn't already exist, ordered after every
// row already present, with no stored bounds — idempotent, and a no-op when the row is already
// there. Runs inside one transaction so two concurrent Ensure calls for the same brand-new key
// can't both observe "absent" and then race each other's INSERT.
func (r *WindowsRepo) EnsureExists(key string) error {
	return r.shared().EnsureExists(key)
}

// SetBounds persists one window's rectangle.
func (r *WindowsRepo) SetBounds(key string, b model.WindowBounds) error {
	return r.shared().SetBounds(key, b)
}

// Delete removes one window's row. Kira Studio's own Delete relies on the same statement's
// `tabs.window_key ... ON DELETE CASCADE` to clean up that window's tabs too — a DB-level
// constraint, so this app's own tabs (0002_p100_tabs_layout.sql) cascade the same way regardless
// of which Go code issues the DELETE.
func (r *WindowsRepo) Delete(key string) error {
	return r.shared().Delete(key)
}
