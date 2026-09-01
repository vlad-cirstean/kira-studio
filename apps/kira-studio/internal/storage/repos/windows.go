package repos

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// WindowsRepo reads and writes the `windows` table (P8 D1/D4) — one row per workbench that is
// either open right now or was the last time the app quit, and the table `tabs.window_key`
// scopes tab ownership against (F6's fix).
type WindowsRepo struct {
	DB *sql.DB
}

// List returns every window record in `order`. Not a hot boot path (read once at startup, per
// window record), so — unlike SettingsRepo/LayoutRepo/TabsRepo — this has no prepared statement.
func (r *WindowsRepo) List() ([]model.WindowRecord, error) {
	rows, err := r.DB.Query(`SELECT key, "order", bounds_json FROM windows ORDER BY "order" ASC`)
	if err != nil {
		return nil, fmt.Errorf("repos/windows: query: %w", err)
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
			return nil, fmt.Errorf("repos/windows: scan: %w", err)
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
		return nil, fmt.Errorf("repos/windows: rows: %w", err)
	}
	return out, nil
}

// Exists reports whether key names a live `windows` row — the check bridge.TabsService uses to
// reject an unrecognised window key with a real E_BAD_REQUEST rather than letting a bad key
// surface as a raw FOREIGN KEY constraint failure from TabsRepo.Save's insert.
func (r *WindowsRepo) Exists(key string) (bool, error) {
	var one int
	err := r.DB.QueryRow(`SELECT 1 FROM windows WHERE key = ?`, key).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("repos/windows: exists %s: %w", key, err)
	}
	return true, nil
}

// Create inserts a new window record. The caller mints the key (D2: a UUID the shell owns).
func (r *WindowsRepo) Create(rec model.WindowRecord) error {
	if err := rec.Validate(); err != nil {
		return fmt.Errorf("repos/windows: %w", err)
	}
	var boundsJSON any
	if rec.Bounds != nil {
		encoded, err := json.Marshal(rec.Bounds)
		if err != nil {
			return fmt.Errorf("repos/windows: encode bounds: %w", err)
		}
		boundsJSON = string(encoded)
	}
	if _, err := r.DB.Exec(
		`INSERT INTO windows (key, "order", bounds_json) VALUES (?, ?, ?)`,
		rec.Key, rec.Order, boundsJSON,
	); err != nil {
		return fmt.Errorf("repos/windows: insert %s: %w", rec.Key, err)
	}
	return nil
}

// SetBounds persists one window's rectangle — the per-window analogue of the single
// `window.bounds` leaf LayoutRepo used to own for every window there had ever been (F5).
func (r *WindowsRepo) SetBounds(key string, b model.WindowBounds) error {
	encoded, err := json.Marshal(b)
	if err != nil {
		return fmt.Errorf("repos/windows: encode bounds: %w", err)
	}
	res, err := r.DB.Exec(`UPDATE windows SET bounds_json = ? WHERE key = ?`, string(encoded), key)
	if err != nil {
		return fmt.Errorf("repos/windows: update %s: %w", key, err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("repos/windows: %s: no such window", key)
	}
	return nil
}

// Delete removes one window's row, cascading its tabs (`tabs.window_key ... ON DELETE CASCADE`,
// foreign_keys is on — storage/db.go). D5: the caller decides whether deleting is the right move
// (only when another window remains) — this method just does it.
func (r *WindowsRepo) Delete(key string) error {
	if _, err := r.DB.Exec(`DELETE FROM windows WHERE key = ?`, key); err != nil {
		return fmt.Errorf("repos/windows: delete %s: %w", key, err)
	}
	return nil
}
