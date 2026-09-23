package repos

import (
	"database/sql"
	"encoding/json"
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
// Exists/Create/EnsureExists/SetBounds (P107 T2-10) — everything below stays a thin delegate to
// it, since this app's own WindowRecord has no extra column (unlike Kira Studio's own `mode`).
func (r *WindowsRepo) shared() *appstorage.WindowRepo { return &appstorage.WindowRepo{DB: r.DB} }

// List returns every window record in `order`. Not a hot boot path (read once at startup, per
// window record), so this has no prepared statement.
func (r *WindowsRepo) List() ([]model.WindowRecord, error) {
	rows, err := r.DB.Query(`SELECT key, "order", bounds_json FROM windows ORDER BY "order" ASC`)
	if err != nil {
		return nil, fmt.Errorf("repos: query windows: %w", err)
	}
	defer rows.Close()

	out := []model.WindowRecord{}
	for rows.Next() {
		var (
			key        string
			order      int
			boundsJSON sql.NullString
		)
		if err := rows.Scan(&key, &order, &boundsJSON); err != nil {
			return nil, fmt.Errorf("repos: scan windows: %w", err)
		}
		rec := model.WindowRecord{Key: key, Order: order}
		if boundsJSON.Valid && boundsJSON.String != "" {
			var b model.WindowBounds
			if err := json.Unmarshal([]byte(boundsJSON.String), &b); err == nil {
				rec.Bounds = &b
			}
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: windows rows: %w", err)
	}
	return out, nil
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
	var bounds *appstorage.WindowBounds
	if rec.Bounds != nil {
		b := appstorage.WindowBounds(*rec.Bounds)
		bounds = &b
	}
	return r.shared().Create(rec.Key, rec.Order, bounds)
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
	return r.shared().SetBounds(key, appstorage.WindowBounds(b))
}

// Delete removes one window's row. Kira Studio's own Delete relies on `tabs.window_key ...
// ON DELETE CASCADE` to clean up that window's tabs too — Kira Space has no `tabs` table (this
// file's own package doc / migrations/0001_init.sql's header comment), so there is nothing else
// for this delete to cascade into.
func (r *WindowsRepo) Delete(key string) error {
	if _, err := r.DB.Exec(`DELETE FROM windows WHERE key = ?`, key); err != nil {
		return fmt.Errorf("repos: delete window %s: %w", key, err)
	}
	return nil
}
