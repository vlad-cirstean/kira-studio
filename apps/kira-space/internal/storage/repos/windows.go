package repos

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// WindowsRepo reads and writes the `windows` table (P8 D1/D4) — one row per workbench that is
// either open right now or was the last time the app quit. Kira Studio's own WindowsRepo also
// carries GetMode/SetMode (P22 D12's per-window app-mode persistence); Kira Space has no such
// concept (see model.WindowRecord's own doc comment) so both, and the `mode` column they read/
// write, are dropped here (P100 Part 1).
type WindowsRepo struct {
	DB *sql.DB
}

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
	var one int
	err := r.DB.QueryRow(`SELECT 1 FROM windows WHERE key = ?`, key).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("repos: windows exists %s: %w", key, err)
	}
	return true, nil
}

// Create inserts a new window record. The caller mints the key (D2: a UUID the shell owns).
func (r *WindowsRepo) Create(rec model.WindowRecord) error {
	if err := rec.Validate(); err != nil {
		return fmt.Errorf("repos: %w", err)
	}
	var boundsJSON any
	if rec.Bounds != nil {
		encoded, err := json.Marshal(rec.Bounds)
		if err != nil {
			return fmt.Errorf("repos: encode window bounds: %w", err)
		}
		boundsJSON = string(encoded)
	}
	if _, err := r.DB.Exec(
		`INSERT INTO windows (key, "order", bounds_json) VALUES (?, ?, ?)`,
		rec.Key, rec.Order, boundsJSON,
	); err != nil {
		return fmt.Errorf("repos: insert window %s: %w", rec.Key, err)
	}
	return nil
}

// EnsureExists creates a `windows` row for key if one doesn't already exist, ordered after every
// row already present, with no stored bounds — idempotent, and a no-op when the row is already
// there. Runs inside one transaction so two concurrent Ensure calls for the same brand-new key
// can't both observe "absent" and then race each other's INSERT.
func (r *WindowsRepo) EnsureExists(key string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: ensure window begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM windows WHERE key = ?)`, key).Scan(&exists); err != nil {
		return fmt.Errorf("repos: ensure window exists %s: %w", key, err)
	}
	if !exists {
		var maxOrder sql.NullInt64
		if err := tx.QueryRow(`SELECT MAX("order") FROM windows`).Scan(&maxOrder); err != nil {
			return fmt.Errorf("repos: ensure window max order: %w", err)
		}
		order := 0
		if maxOrder.Valid {
			order = int(maxOrder.Int64) + 1
		}
		if _, err := tx.Exec(
			`INSERT INTO windows (key, "order", bounds_json) VALUES (?, ?, NULL)`, key, order,
		); err != nil {
			return fmt.Errorf("repos: ensure insert window %s: %w", key, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: ensure window commit: %w", err)
	}
	return nil
}

// SetBounds persists one window's rectangle.
func (r *WindowsRepo) SetBounds(key string, b model.WindowBounds) error {
	encoded, err := json.Marshal(b)
	if err != nil {
		return fmt.Errorf("repos: encode window bounds: %w", err)
	}
	res, err := r.DB.Exec(`UPDATE windows SET bounds_json = ? WHERE key = ?`, string(encoded), key)
	if err != nil {
		return fmt.Errorf("repos: update window %s: %w", key, err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("repos: %s: no such window", key)
	}
	return nil
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
